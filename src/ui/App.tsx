import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMachine } from '@xstate/react';
import { combatMachine, type AdvantagePools, type RosterEntry } from '../machines/combatMachine';
import { createCombatSync } from '../obr/client';
import { clearStoredReveals, committedIds, toMirroredCombat } from '../obr/protocol';
import type { CombatSync, MirroredCombat, PlayerInfo } from '../obr/sync';
import type { CombatantId, CombatantPublic } from '../rules/types';
import { CombatBoard } from './CombatBoard';
import { phaseName, type PhaseName } from './phase';
import { RulesView } from './rules';

// Top level: resolve this client's OBR identity, then route by role. The GM runs the
// single authoritative combatMachine; players never run it — they render the GM's
// mirrored snapshot. Each client only ever sees/sets the hidden dice it owns.
export function App({ outsideOwlbear = false }: { outsideOwlbear?: boolean }) {
  const sync = useMemo<CombatSync>(() => createCombatSync(), []);
  const [self, setSelf] = useState<PlayerInfo | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  // Bumping the session remounts the GM subtree (fresh combatMachine + actors).
  const [sessionId, setSessionId] = useState(1);
  // Roster the GM last started combat with. Held here (App survives the session-id
  // remount) so the next session's RosterSetup can pre-fill from it. Null on the
  // first-ever session → RosterSetup falls back to its demo roster.
  const [lastRoster, setLastRoster] = useState<RosterEntry[] | null>(null);
  // Rules overlay: available in every phase and for both roles.
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    let live = true;
    sync.getSelf().then((s) => live && setSelf(s));
    sync.getConnectedPlayers().then((p) => live && setPlayers(p));
    const unsub = sync.onPlayersChange((p) => setPlayers(p));
    return () => {
      live = false;
      unsub();
    };
  }, [sync]);

  // Reset for a fresh combat: wipe shared room state and this client's persisted
  // reveals, then bump the session so both the GM subtree and (via the mirror's
  // sessionId) player boards remount with no stale machine/actor/localStorage state.
  const reset = useCallback(async () => {
    await sync.clearCombat();
    clearStoredReveals();
    setSessionId((s) => s + 1);
  }, [sync]);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Action Dice Combat</h1>
        <div className="app__headmeta">
          <button className="app__rules" onClick={() => setShowRules(true)}>
            Rules
          </button>
          <span className="app__role">{outsideOwlbear ? 'Preview · GM' : (self?.role ?? '…')}</span>
        </div>
      </header>

      {showRules ? (
        <RulesView onClose={() => setShowRules(false)} />
      ) : !self ? (
        <p className="app__hint">Connecting…</p>
      ) : self.role === 'GM' ? (
        <GmSession
          key={sessionId}
          sessionId={sessionId}
          sync={sync}
          self={self}
          players={players}
          onReset={reset}
          initialRoster={lastRoster ?? undefined}
          onRosterStarted={setLastRoster}
        />
      ) : (
        <PlayerSession sync={sync} self={self} />
      )}
    </main>
  );
}

// GM client: owns the authoritative machine, mirrors it on every transition, and
// turns each current-round commitment into a `combatant.lockedIn` machine event.
function GmSession({
  sync,
  self,
  players,
  sessionId,
  onReset,
  initialRoster,
  onRosterStarted,
}: {
  sync: CombatSync;
  self: PlayerInfo;
  players: PlayerInfo[];
  sessionId: number;
  onReset: () => void;
  initialRoster?: RosterEntry[];
  onRosterStarted?: (roster: RosterEntry[]) => void;
}) {
  const [snapshot, send, actorRef] = useMachine(combatMachine);
  const phase = phaseName(snapshot);
  const round = snapshot.context.round;
  const combatants = snapshot.context.combatants;

  // Mirror the public snapshot to room metadata on every transition. The sessionId
  // rides along so players remount their board when the GM starts a new combat.
  useEffect(() => {
    void sync.mirrorCombat(toMirroredCombat(sessionId, round, phase, combatants));
  }, [sync, sessionId, round, phase, combatants]);

  // Forward commitments → locks. Read fresh machine state per delivery so we only
  // lock active, still-unlocked combatants for the current round.
  useEffect(() => {
    return sync.subscribeCommitments((all) => {
      const snap = actorRef.getSnapshot();
      const ids = committedIds(all, snap.context.round);
      for (const id of ids) {
        const c = snap.context.combatants[id];
        if (c && !c.outOfCombat && !c.lockedIn) {
          actorRef.send({ type: 'combatant.lockedIn', id });
        }
      }
    });
  }, [sync, actorRef]);

  const handleStart = (roster: RosterEntry[], advantagePools: AdvantagePools) => {
    // Remember this roster so the next session pre-fills from it, then start combat.
    onRosterStarted?.(roster);
    send({ type: 'combat.started', roster, advantagePools });
  };

  return (
    <CombatBoard
      self={self}
      sync={sync}
      isGM
      round={round}
      phase={phase}
      combatants={combatants}
      players={players}
      send={send}
      onStart={handleStart}
      onReset={onReset}
      initialRoster={initialRoster}
    />
  );
}

// Player client: no machine. Render whatever the GM mirrors; run character actors
// (in CombatBoard/useHiddenDice) only for owned combatants.
function PlayerSession({ sync, self }: { sync: CombatSync; self: PlayerInfo }) {
  const [mirror, setMirror] = useState<MirroredCombat | null>(null);

  useEffect(() => {
    return sync.subscribeCombat((snap) => setMirror(snap));
  }, [sync]);

  const round = mirror?.round ?? 1;
  const phase = (mirror?.phase as PhaseName | undefined) ?? 'idle';
  const combatants: Record<CombatantId, CombatantPublic> = mirror?.combatants ?? {};

  // Key by sessionId so a new (or cleared→new) session remounts the board, hook,
  // and owned actors — no stale dice pools carry into the next combat.
  return (
    <CombatBoard
      key={mirror?.sessionId ?? 0}
      self={self}
      sync={sync}
      isGM={false}
      round={round}
      phase={phase}
      combatants={combatants}
    />
  );
}
