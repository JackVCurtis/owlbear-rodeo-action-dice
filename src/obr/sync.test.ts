import { describe, expect, it } from 'vitest';
import type { Assignment } from '../rules/types';
import { computeCommitment, generateSalt, verifyCommitment } from './commit';
import {
  createFakeRoom,
  type Commitment,
  type MirroredCombat,
  type PlayerInfo,
  type RevealPayload,
} from './sync';

const GM: PlayerInfo = { id: 'gm', name: 'GM', role: 'GM' };
const PC: PlayerInfo = { id: 'pc', name: 'Alice', role: 'PLAYER' };

function assignment(): Assignment {
  return {
    action: [{ kind: 'die', value: 19 }],
    bonus: { kind: 'token' },
    reaction: null,
    saves: [14, 6],
  };
}

describe('FakeSync via a shared room', () => {
  it('lists connected players across clients', async () => {
    const room = createFakeRoom();
    const a = room.createClient(GM);
    const b = room.createClient(PC);

    expect(await a.getConnectedPlayers()).toEqual([GM, PC]);
    expect(await b.getSelf()).toEqual(PC);
    expect(await b.getRole()).toBe('PLAYER');
  });

  it('notifies existing clients when a new player joins', () => {
    const room = createFakeRoom();
    const a = room.createClient(GM);

    const seen: PlayerInfo[][] = [];
    a.onPlayersChange((players) => seen.push(players));

    room.createClient(PC);
    expect(seen.at(-1)).toEqual([GM, PC]);
  });

  it("delivers one client's commitment to another's subscription", async () => {
    const room = createFakeRoom();
    const a = room.createClient(PC);
    const b = room.createClient(GM);

    let latest: Commitment[] = [];
    b.subscribeCommitments((all) => (latest = all));

    await a.publishCommitment({ round: 1, combatantId: 'pc', commitment: 'abc123' });
    expect(latest).toEqual([{ round: 1, combatantId: 'pc', commitment: 'abc123' }]);
  });

  it('replays current commitments to a late subscriber', async () => {
    const room = createFakeRoom();
    const a = room.createClient(PC);
    await a.publishCommitment({ round: 1, combatantId: 'pc', commitment: 'zzz' });

    const b = room.createClient(GM);
    let latest: Commitment[] = [];
    b.subscribeCommitments((all) => (latest = all));
    expect(latest).toEqual([{ round: 1, combatantId: 'pc', commitment: 'zzz' }]);
  });

  it('broadcasts a reveal from one client to another', async () => {
    const room = createFakeRoom();
    const a = room.createClient(PC);
    const b = room.createClient(GM);

    let received: RevealPayload | null = null;
    b.onReveal((r) => (received = r));

    const reveal: RevealPayload = { round: 1, combatantId: 'pc', assignment: assignment(), salt: 'deadbeef' };
    await a.broadcastReveal(reveal);
    expect(received).toEqual(reveal);
  });

  it('mirrors GM-authoritative combat to other clients', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    const pc = room.createClient(PC);

    const snapshots: (unknown | null)[] = [];
    pc.subscribeCombat((s) => snapshots.push(s));
    expect(snapshots).toEqual([null]); // replayed initial state

    await gm.mirrorCombat({ sessionId: 1, round: 2, phase: 'reveal', combatants: {}, lastSavesSucceeded: null });
    expect(snapshots.at(-1)).toEqual({
      sessionId: 1,
      round: 2,
      phase: 'reveal',
      combatants: {},
      lastSavesSucceeded: null,
    });
  });

  it('clearCombat wipes commitments + mirror and re-emits [] / null to all clients', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    const pc = room.createClient(PC);

    // A second client observes the shared room; clearing on the GM reaches it.
    let commitments: Commitment[] = [];
    pc.subscribeCommitments((all) => (commitments = all));
    let combat: MirroredCombat | null = null;
    pc.subscribeCombat((s) => (combat = s));

    await pc.publishCommitment({ round: 1, combatantId: 'pc', commitment: 'abc123' });
    await gm.mirrorCombat({ sessionId: 1, round: 1, phase: 'assignment', combatants: {}, lastSavesSucceeded: null });
    expect(commitments).toHaveLength(1);
    expect(combat).not.toBeNull();

    await gm.clearCombat();
    expect(commitments).toEqual([]);
    expect(combat).toBeNull();
  });

  it('lets a receiver verify a reveal against the earlier commitment (commit–reveal end to end)', async () => {
    const room = createFakeRoom();
    const alice = room.createClient(PC);
    const gm = room.createClient(GM);

    // GM watches commitments and reveals.
    let commitments: Commitment[] = [];
    gm.subscribeCommitments((all) => (commitments = all));
    let reveal: RevealPayload | null = null;
    gm.onReveal((r) => (reveal = r));

    // Alice commits (hash only) at lock-in.
    const a = assignment();
    const salt = generateSalt();
    const commitment = await computeCommitment(a, salt);
    await alice.publishCommitment({ round: 1, combatantId: 'pc', commitment });

    // Later, Alice reveals plaintext + salt.
    await alice.broadcastReveal({ round: 1, combatantId: 'pc', assignment: a, salt });

    const stored = commitments.find((c) => c.combatantId === 'pc' && c.round === 1);
    expect(stored).toBeDefined();
    const seen = reveal as RevealPayload | null;
    expect(seen).not.toBeNull();

    // Honest reveal verifies true against the stored commitment.
    expect(await verifyCommitment(seen!.assignment, seen!.salt, stored!.commitment)).toBe(true);

    // A tampered assignment (swapped bonus die) verifies false.
    const tampered: Assignment = { ...seen!.assignment, bonus: { kind: 'die', value: 2 } };
    expect(await verifyCommitment(tampered, seen!.salt, stored!.commitment)).toBe(false);
  });
});

describe('FakeSync.pruneCommitments', () => {
  const commit = (round: number, combatantId: string): Commitment => ({
    round,
    combatantId,
    commitment: `h${round}${combatantId}`,
  });

  it('removes commitments from earlier rounds for every client, keeping the current round', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    const player = room.createClient(PC);
    await player.publishCommitment(commit(1, 'pc'));
    await gm.publishCommitment(commit(1, 'orc'));
    await player.publishCommitment(commit(2, 'pc'));
    await gm.publishCommitment(commit(2, 'orc'));

    let seen: Commitment[] = [];
    player.subscribeCommitments((all) => (seen = all));
    await gm.pruneCommitments(2);

    expect(seen.map((c) => c.round)).toEqual([2, 2]);
    let late: Commitment[] = [];
    room.createClient({ id: 'late', name: 'Late', role: 'PLAYER' }).subscribeCommitments((all) => (late = all));
    expect(late).toHaveLength(2);
    expect(late.every((c) => c.round === 2)).toBe(true);
  });
});

describe('FakeSync.subscribeRevealedRound', () => {
  const reveal = (round: number): RevealPayload => ({
    round,
    combatantId: 'pc',
    assignment: assignment(),
    salt: 's',
  });

  it('replays the mirrored revealed round to a client that joins afterwards', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    await gm.mirrorRevealedRound(2, [reveal(2)]);

    let seen: unknown = 'never';
    room.createClient(PC).subscribeRevealedRound((r) => (seen = r));

    expect(seen).toEqual({ round: 2, reveals: [reveal(2)] });
  });

  it('delivers later mirrors and null after the combat is cleared', async () => {
    const room = createFakeRoom();
    const gm = room.createClient(GM);
    const seen: unknown[] = [];
    room.createClient(PC).subscribeRevealedRound((r) => seen.push(r));

    await gm.mirrorRevealedRound(1, [reveal(1)]);
    await gm.clearCombat();

    expect(seen).toEqual([null, { round: 1, reveals: [reveal(1)] }, null]);
  });
});
