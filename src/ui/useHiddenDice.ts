import { useEffect, useMemo, useRef, useState } from 'react';
import { createActor } from 'xstate';
import { characterMachine } from '../machines/characterMachine';
import type { CombatSync, Commitment, PlayerInfo, RevealedRound, RevealPayload } from '../obr/sync';
import {
  broadcastStoredReveal,
  commitOnLock,
  committedIds,
  loadStoredReveal,
  persistStoredReveal,
  revealStatus,
  ownedIds,
  type RevealStatus,
  type StoredReveal,
} from '../obr/protocol';
import type { Assignment, CombatantId, CombatantPublic, DieValue } from '../rules/types';
import type { RoundOutcome } from '../rules/carryover';
import { rollDice, lowestDiceIndices } from './dice';
import { isAssignment, isResolving, type PhaseName } from './phase';
import type { CharActor } from './DiceTray';

// Settle one owned combatant for the round just resolved. Opportunity attacks aren't
// tracked yet, so the Reaction die always carries; Action/Bonus dice are always spent.
// The GM marks which Save dice succeeded, so `savesSucceeded` are consumed (leave the
// pool) while failed/unused Save dice carry. Mirrors the rules-layer settleRound spec.
function buildOutcome(assignment: Assignment, savesSucceeded: DieValue[]): RoundOutcome {
  return { assignment, reactionUsed: false, savesSucceeded };
}

// A revealed assignment as seen by this client, plus whether its plaintext+salt
// reproduced the committer's hash. Only 'mismatch' flags tampering.
export interface RevealRecord {
  assignment: Assignment;
  status: RevealStatus;
}

export interface HiddenDice {
  // Character actors for THIS client's owned combatants only (its hidden dice).
  charActors: Record<CombatantId, CharActor>;
  // Combatant ids that have published a commitment for the current round.
  committed: Set<CombatantId>;
  // Revealed assignments for the current round (owned recorded locally at reveal;
  // others received + verified over the wire), keyed by combatant id.
  reveals: Record<CombatantId, RevealRecord>;
  // Combatants whose public pool dropped this round (threshold broken).
  broken: Set<CombatantId>;
  // Commit-on-lock for one owned combatant.
  lock: (id: CombatantId) => void;
}

// Drive one owned combatant's private character actor to drop `count` of its lowest
// dice — mirroring the GM's authoritative public attrition onto this client's hidden
// pool. Routed through the existing damage→threshold events (the actor only attrites
// when damage exceeds its threshold, so we assert a breaking amount).
function dropLowestDice(actor: CharActor, count: number): void {
  const snap = actor.getSnapshot();
  if (count <= 0 || !snap.matches('revealed')) return;
  const indices = lowestDiceIndices(snap.context.pool, count);
  actor.send({ type: 'damage.applied', amount: snap.context.threshold + 1 });
  actor.send({ type: 'threshold.resolved', removeIndices: indices });
}

// Owns everything a client does with hidden dice, uniformly for GM and players:
// seed owned character actors, commit on lock, broadcast + verify reveals, and keep
// the owned hidden pools consistent with the GM's authoritative public counts.
export function useHiddenDice({
  self,
  sync,
  isGM,
  round,
  phase,
  combatants,
  lastSavesSucceeded,
}: {
  self: PlayerInfo;
  sync: CombatSync;
  isGM: boolean;
  round: number;
  phase: PhaseName;
  combatants: Record<CombatantId, CombatantPublic>;
  lastSavesSucceeded: { round: number; byCombatant: Record<CombatantId, DieValue[]> } | null;
}): HiddenDice {
  const [charActors, setCharActors] = useState<Record<CombatantId, CharActor>>({});
  const [allCommitments, setAllCommitments] = useState<Commitment[]>([]);
  // Plaintext reveals received for the current round, from any source. `reveals` is
  // derived from these by re-verifying whenever they or the commitments change.
  const [received, setReceived] = useState<Record<CombatantId, RevealPayload>>({});
  const [reveals, setReveals] = useState<Record<CombatantId, RevealRecord>>({});
  const [broken, setBroken] = useState<Set<CombatantId>>(new Set());
  const [mirroredReveals, setMirroredReveals] = useState<RevealedRound | null>(null);

  const charActorsRef = useRef(charActors);
  charActorsRef.current = charActors;
  const roundRef = useRef(round);
  roundRef.current = round;

  // Salt+plaintext captured at lock, needed to reveal (and to survive a refresh).
  const storedReveals = useRef<Map<string, StoredReveal>>(new Map());
  // Last public pool count seen per owned combatant, to detect attrition deltas.
  const lastPoolCount = useRef<Map<CombatantId, number>>(new Map());
  // Per-round guards so reveal-broadcast and settle each happen once.
  const broadcastedRounds = useRef<Set<number>>(new Set());
  const settledRounds = useRef<Set<number>>(new Set());
  // GM re-mirrors the growing set of revealed assignments for late joiners.
  const revealAccum = useRef<RevealPayload[]>([]);

  const owned = useMemo(() => new Set(ownedIds(combatants, self.id)), [combatants, self.id]);
  const committed = useMemo(() => committedIds(allCommitments, round), [allCommitments, round]);

  // Seed a character actor (local hidden pool) for each newly-appearing owned
  // combatant, rolling its dice on this client.
  useEffect(() => {
    const missing = [...owned].filter((id) => !charActorsRef.current[id]);
    if (missing.length === 0) return;
    const next = { ...charActorsRef.current };
    for (const id of missing) {
      const pub = combatants[id];
      const actor = createActor(characterMachine, {
        input: {
          id,
          level: pub.level ?? 0,
          proficiencyBonus: pub.proficiencyBonus,
          hitDie: pub.hitDie,
        },
      }).start();
      actor.send({ type: 'combat.started', rolls: rollDice(pub.poolCount) });
      next[id] = actor;
      lastPoolCount.current.set(id, pub.poolCount);
    }
    setCharActors(next);
  }, [owned, combatants]);

  // Stop actors on unmount so a replaced/ended combat doesn't leak running actors.
  useEffect(() => () => Object.values(charActorsRef.current).forEach((a) => a.stop()), []);

  // Subscribe to commitments (for "who has locked in" + reveal verification).
  useEffect(() => {
    return sync.subscribeCommitments(setAllCommitments);
  }, [sync]);

  // Receive reveals from other clients. The GM re-mirrors the accumulating set.
  useEffect(() => {
    return sync.onReveal((reveal) => {
      if (reveal.round !== roundRef.current) return;
      setReceived((prev) => ({ ...prev, [reveal.combatantId]: reveal }));
      if (isGM) {
        revealAccum.current = [
          ...revealAccum.current.filter((r) => r.combatantId !== reveal.combatantId),
          reveal,
        ];
        void sync.mirrorRevealedRound(roundRef.current, revealAccum.current);
      }
    });
  }, [sync, isGM]);

  // Catch up on reveals whose broadcast this client missed (late join / refresh) from
  // the GM's revealed-round mirror: current round only, never overwriting a reveal
  // already received.
  useEffect(() => sync.subscribeRevealedRound(setMirroredReveals), [sync]);
  useEffect(() => {
    if (!mirroredReveals || mirroredReveals.round !== round) return;
    setReceived((prev) => {
      const missing = mirroredReveals.reveals.filter((r) => !prev[r.combatantId]);
      if (missing.length === 0) return prev;
      return { ...prev, ...Object.fromEntries(missing.map((r) => [r.combatantId, r])) };
    });
  }, [mirroredReveals, round]);

  // Re-verify every received reveal whenever reveals or commitments change, so one
  // that arrived before its commitment moves from 'pending' to its real status.
  useEffect(() => {
    let live = true;
    const entries = Object.entries(received);
    void Promise.all(
      entries.map(async ([id, reveal]) => {
        const status = await revealStatus(reveal, allCommitments);
        return [id, { assignment: reveal.assignment, status }] as const;
      }),
    ).then((records) => {
      if (live) setReveals(Object.fromEntries(records));
    });
    return () => {
      live = false;
    };
  }, [received, allCommitments]);

  // Leaving assignment: flip owned actors to revealed and broadcast their stored
  // plaintext+salt. Once per round.
  useEffect(() => {
    if (!isResolving(phase) || broadcastedRounds.current.has(round)) return;
    broadcastedRounds.current.add(round);
    for (const id of owned) {
      const actor = charActorsRef.current[id];
      if (actor?.getSnapshot().matches('lockedIn')) actor.send({ type: 'reveal' });
      const stored =
        storedReveals.current.get(`${round}:${id}`) ?? loadStoredReveal(round, id);
      if (!stored) continue;
      void broadcastStoredReveal(sync, stored);
      // Record our own reveal locally (broadcast may not echo to sender).
      const payload: RevealPayload = {
        round,
        combatantId: id,
        assignment: stored.assignment,
        salt: stored.salt,
      };
      setReceived((prev) => ({ ...prev, [id]: payload }));
      if (isGM) {
        revealAccum.current = [...revealAccum.current.filter((r) => r.combatantId !== id), payload];
      }
    }
    if (isGM) void sync.mirrorRevealedRound(round, revealAccum.current);
  }, [phase, round, owned, sync, isGM]);

  // Reconcile owned hidden pools with the GM's authoritative public counts: any
  // decrease is a threshold break, so drop that many of the owner's lowest dice.
  // Side effects run OUTSIDE setState (StrictMode may double-invoke updaters); the
  // lastPoolCount ref makes a re-run idempotent regardless.
  useEffect(() => {
    const newlyBroken: CombatantId[] = [];
    for (const id of owned) {
      const pub = combatants[id];
      if (!pub) continue;
      const before = lastPoolCount.current.get(id) ?? pub.poolCount;
      if (pub.poolCount < before) {
        dropLowestDice(charActorsRef.current[id], before - pub.poolCount);
        newlyBroken.push(id);
      }
      lastPoolCount.current.set(id, pub.poolCount);
    }
    if (newlyBroken.length > 0) setBroken((prev) => new Set([...prev, ...newlyBroken]));
  }, [combatants, owned]);

  // New round back in assignment: settle owned actors (carry unused save/reaction),
  // and clear this round's reveal/break display. Once per round.
  useEffect(() => {
    if (!isAssignment(phase) || round <= 1 || settledRounds.current.has(round)) return;
    settledRounds.current.add(round);
    for (const id of owned) {
      const actor = charActorsRef.current[id];
      const snap = actor?.getSnapshot();
      if (snap?.matches('revealed')) {
        // The settle at round R's assignment resolves the round just ended (R-1), so
        // match lastSavesSucceeded to R-1; unmatched/absent → nothing consumed (all carry).
        const succeeded =
          lastSavesSucceeded && lastSavesSucceeded.round === round - 1
            ? (lastSavesSucceeded.byCombatant[id] ?? [])
            : [];
        actor.send({ type: 'round.next', outcome: buildOutcome(snap.context.assignment, succeeded) });
      }
    }
    revealAccum.current = [];
    setReceived({});
    setBroken(new Set());
  }, [phase, round, owned, lastSavesSucceeded]);

  const lock = (id: CombatantId): void => {
    const actor = charActorsRef.current[id];
    if (!actor) return;
    const assignment = actor.getSnapshot().context.assignment;
    actor.send({ type: 'assignment.lockedIn' });
    void commitOnLock(sync, round, id, assignment).then((stored) => {
      storedReveals.current.set(`${round}:${id}`, stored);
      persistStoredReveal(stored);
    });
  };

  return { charActors, committed, reveals, broken, lock };
}
