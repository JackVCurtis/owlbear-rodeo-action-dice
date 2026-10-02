import { describe, expect, it } from 'vitest';
import type { Assignment, CombatantPublic } from '../rules/types';
import { canonicalAssignment, computeCommitment } from './commit';
import {
  broadcastStoredReveal,
  commitOnLock,
  committedIds,
  ownedIds,
  revealStatus,
  toMirroredCombat,
  verifyReveal,
} from './protocol';
import { createFakeRoom, type Commitment, type PlayerInfo, type RevealPayload } from './sync';

const GM: PlayerInfo = { id: 'gm', name: 'GM', role: 'GM' };
const ALICE: PlayerInfo = { id: 'alice', name: 'Alice', role: 'PLAYER' };

function assignment(): Assignment {
  return {
    action: [{ kind: 'die', value: 17 }, { kind: 'token' }],
    bonus: { kind: 'die', value: 11 },
    reaction: null,
    saves: [20, 4],
  };
}

describe('commit–reveal protocol across two clients', () => {
  it('commits a hash, reveals plaintext+salt, and lets the GM verify — leaking no plaintext pre-reveal', async () => {
    const room = createFakeRoom();
    const player = room.createClient(ALICE);
    const gm = room.createClient(GM);

    // GM watches commitments (metadata) and reveals (broadcast).
    let commitments: Commitment[] = [];
    gm.subscribeCommitments((all) => (commitments = all));
    let received: RevealPayload | null = null;
    gm.onReveal((r) => (received = r));

    // COMMIT-ON-LOCK: the player commits; only the hash crosses the wire.
    const a = assignment();
    const stored = await commitOnLock(player, 1, 'alice-pc', a);

    // The GM observes exactly one committed combatant for round 1.
    expect(committedIds(commitments, 1)).toEqual(new Set(['alice-pc']));

    // The shared commitment carries ONLY {round, combatantId, commitment-hash} — no
    // assignment, no salt. (Substring checks use the long salt / canonical strings,
    // which a 64-char hash cannot coincidentally contain.)
    const crossed = commitments.find((c) => c.combatantId === 'alice-pc')!;
    expect(Object.keys(crossed).sort()).toEqual(['combatantId', 'commitment', 'round']);
    expect(crossed.commitment).toMatch(/^[0-9a-f]{64}$/);
    const wire = JSON.stringify(crossed);
    expect(wire).not.toContain(stored.salt);
    expect(wire).not.toContain(canonicalAssignment(a));
    // The commitment is salted: the assignment hashed with a different salt differs.
    expect(await computeCommitment(a, 'not-the-salt')).not.toBe(crossed.commitment);

    // REVEAL: broadcast the stored plaintext + salt to all clients.
    await broadcastStoredReveal(player, stored);
    const seen = received as RevealPayload | null;
    expect(seen).not.toBeNull();
    expect(seen!.assignment).toEqual(a);
    expect(seen!.salt).toBe(stored.salt);

    // VERIFY: the honest reveal reproduces the committed hash.
    expect(await verifyReveal(seen!, commitments)).toEqual({ found: true, ok: true });

    // A tampered reveal (swapped bonus die) fails verification.
    const tampered: RevealPayload = {
      ...seen!,
      assignment: { ...seen!.assignment, bonus: { kind: 'die', value: 2 } },
    };
    expect(await verifyReveal(tampered, commitments)).toEqual({ found: true, ok: false });

    // A reveal with no matching commitment is reported not-found.
    const orphan: RevealPayload = { round: 9, combatantId: 'ghost', assignment: a, salt: stored.salt };
    expect(await verifyReveal(orphan, commitments)).toEqual({ found: false, ok: false });
  });

  it('scopes committedIds to a round and derives ownership + the public mirror', () => {
    const commitments: Commitment[] = [
      { round: 1, combatantId: 'a', commitment: 'h1' },
      { round: 1, combatantId: 'b', commitment: 'h2' },
      { round: 2, combatantId: 'a', commitment: 'h3' },
    ];
    expect(committedIds(commitments, 1)).toEqual(new Set(['a', 'b']));
    expect(committedIds(commitments, 2)).toEqual(new Set(['a']));
    expect(committedIds(commitments, 3)).toEqual(new Set());

    const combatants: Record<string, CombatantPublic> = {
      a: pub('a', 'alice'),
      b: pub('b', 'gm'),
      c: pub('c', 'alice'),
    };
    expect(ownedIds(combatants, 'alice').sort()).toEqual(['a', 'c']);
    expect(ownedIds(combatants, 'gm')).toEqual(['b']);

    const mirror = toMirroredCombat(3, 2, 'assignment', combatants, { round: 1, byCombatant: { a: [15] } });
    expect(mirror).toEqual({
      sessionId: 3,
      round: 2,
      phase: 'assignment',
      combatants,
      lastSavesSucceeded: { round: 1, byCombatant: { a: [15] } },
    });
  });
});

function pub(id: string, ownerId: string): CombatantPublic {
  return {
    id,
    name: id,
    ownerId,
    hitDie: 8,
    proficiencyBonus: 2,
    threshold: 10,
    poolCount: 6,
    lockedIn: false,
    outOfCombat: false,
    revealedAssignment: null,
    isPC: true,
    currentHp: 24,
  };
}

describe('commitment pruning across rounds', () => {
  it('leaves only the current round committed after rounds 1→3', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    const player = room.createClient(ALICE);
    let seen: Commitment[] = [];
    gm.subscribeCommitments((all) => (seen = all));

    for (const round of [1, 2, 3]) {
      // The GM prunes as each new round's assignment begins.
      if (round > 1) await gm.pruneCommitments(round);
      await commitOnLock(player, round, 'alice', assignment());
      await commitOnLock(gm, round, 'orc', assignment());
    }

    expect(seen).toHaveLength(2);
    expect(committedIds(seen, 3)).toEqual(new Set(['alice', 'orc']));
  });
});

describe('late joiner catching up on a revealed round', () => {
  it('recovers and verifies reveals it missed the broadcast of', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    const player = room.createClient(ALICE);
    const aliceStored = await commitOnLock(player, 1, 'alice', assignment());
    const orcStored = await commitOnLock(gm, 1, 'orc', assignment());
    const reveals: RevealPayload[] = [aliceStored, orcStored].map(({ round, combatantId, assignment, salt }) => ({
      round,
      combatantId,
      assignment,
      salt,
    }));
    await gm.mirrorRevealedRound(1, reveals);

    const late = room.createClient({ id: 'bob', name: 'Bob', role: 'PLAYER' });
    let commitments: Commitment[] = [];
    late.subscribeCommitments((all) => (commitments = all));
    let recovered: RevealPayload[] = [];
    late.subscribeRevealedRound((r) => (recovered = r?.round === 1 ? r.reveals : []));

    expect(recovered.map((r) => r.combatantId).sort()).toEqual(['alice', 'orc']);
    for (const r of recovered) {
      expect(await verifyReveal(r, commitments)).toEqual({ found: true, ok: true });
    }
  });
});

describe('revealStatus when broadcast and commitment race', () => {
  async function lockedReveal(): Promise<{ reveal: RevealPayload; commitments: Commitment[] }> {
    const room = createFakeRoom();
    const player = room.createClient(ALICE);
    let commitments: Commitment[] = [];
    room.createClient(GM).subscribeCommitments((all) => (commitments = all));
    const { round, combatantId, assignment: a, salt } = await commitOnLock(player, 1, 'alice', assignment());
    return { reveal: { round, combatantId, assignment: a, salt }, commitments };
  }

  it('is pending, not a mismatch, while the commitment has not arrived', async () => {
    const { reveal } = await lockedReveal();
    expect(await revealStatus(reveal, [])).toBe('pending');
  });

  it('becomes verified once the commitment arrives', async () => {
    const { reveal, commitments } = await lockedReveal();
    expect(await revealStatus(reveal, [])).toBe('pending');
    expect(await revealStatus(reveal, commitments)).toBe('verified');
  });

  it('is a mismatch when the plaintext does not reproduce the commitment', async () => {
    const { reveal, commitments } = await lockedReveal();
    const tampered = { ...reveal, assignment: { ...reveal.assignment, saves: [20, 20] } };
    expect(await revealStatus(tampered, commitments)).toBe('mismatch');
  });
});
