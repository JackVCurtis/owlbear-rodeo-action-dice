import type { Assignment, CombatantId, CombatantPublic } from '../rules/types';
import { computeCommitment, generateSalt, verifyCommitment } from './commit';
import type { CombatSync, Commitment, MirroredCombat, RevealPayload } from './sync';
import { getPluginId } from './ids';

// PURE / ASYNC protocol wiring for commit–reveal, extracted from React so it can
// be unit-tested headless with two FakeSync clients. Nothing here imports the OBR
// SDK — it only speaks the CombatSync seam and the SDK-free crypto in commit.ts.

// What the owning client stores locally at lock-in so it can reveal (and survive a
// refresh) without ever putting the plaintext on the wire before reveal.
export interface StoredReveal {
  round: number;
  combatantId: CombatantId;
  assignment: Assignment;
  salt: string;
}

// COMMIT-ON-LOCK: roll a salt, hash the assignment, publish ONLY the hash. Returns
// the plaintext+salt to persist and reveal later. No dice values cross the wire.
export async function commitOnLock(
  sync: Pick<CombatSync, 'publishCommitment'>,
  round: number,
  combatantId: CombatantId,
  assignment: Assignment,
): Promise<StoredReveal> {
  const salt = generateSalt();
  const commitment = await computeCommitment(assignment, salt);
  await sync.publishCommitment({ round, combatantId, commitment });
  return { round, combatantId, assignment, salt };
}

// REVEAL: broadcast a previously stored plaintext assignment + salt to every client.
export async function broadcastStoredReveal(
  sync: Pick<CombatSync, 'broadcastReveal'>,
  stored: StoredReveal,
): Promise<void> {
  await sync.broadcastReveal({
    round: stored.round,
    combatantId: stored.combatantId,
    assignment: stored.assignment,
    salt: stored.salt,
  });
}

// "ALL COMMITTED?" support: the set of combatant ids that have a commitment for a
// given round. The GM turns each of these into a `combatant.lockedIn` machine event.
export function committedIds(all: Commitment[], round: number): Set<CombatantId> {
  return new Set(all.filter((c) => c.round === round).map((c) => c.combatantId));
}

// Result of checking a received reveal against its earlier commitment.
export interface RevealVerification {
  // The stored commitment existed for this (round, combatant).
  found: boolean;
  // The plaintext + salt reproduce the committed hash.
  ok: boolean;
}

// REVEAL-AND-VERIFY: recompute the hash of the revealed assignment+salt and compare
// it to the commitment published at lock-in. A mismatch means the value was tampered.
export async function verifyReveal(
  reveal: RevealPayload,
  commitments: Commitment[],
): Promise<RevealVerification> {
  const stored = commitments.find(
    (c) => c.round === reveal.round && c.combatantId === reveal.combatantId,
  );
  if (!stored) return { found: false, ok: false };
  const ok = await verifyCommitment(reveal.assignment, reveal.salt, stored.commitment);
  return { found: true, ok };
}

// MIRROR MAPPING: the GM's authoritative combat snapshot → the public mirror other
// clients render. Kept trivial and pure so the mapping is one obvious place. The
// sessionId lets players remount onto a fresh combat when the GM resets.
export function toMirroredCombat(
  sessionId: number,
  round: number,
  phase: string,
  combatants: Record<CombatantId, CombatantPublic>,
): MirroredCombat {
  return { sessionId, round, phase, combatants };
}

// Which combatants a given client controls (owns the hidden dice of).
export function ownedIds(
  combatants: Record<CombatantId, CombatantPublic>,
  selfId: string,
): CombatantId[] {
  return Object.values(combatants)
    .filter((c) => c.ownerId === selfId)
    .map((c) => c.id);
}

// --- localStorage persistence (browser only; no-ops headless) ---------------
// Namespaced so a refresh mid-combat can still reveal. Guarded so the pure module
// stays importable under Node/Vitest where `localStorage` is undefined.

function storageKey(round: number, id: CombatantId): string {
  return getPluginId(`reveal/${round}/${id}`);
}

export function persistStoredReveal(stored: StoredReveal): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(stored.round, stored.combatantId), JSON.stringify(stored));
  } catch {
    // storage full / disabled — reveal still works this session from memory.
  }
}

export function loadStoredReveal(round: number, id: CombatantId): StoredReveal | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(round, id));
    return raw ? (JSON.parse(raw) as StoredReveal) : null;
  } catch {
    return null;
  }
}

// RESET cleanup: drop every persisted reveal for this extension so a new combat
// (which reuses combatant ids from round 1) can't load a prior combat's plaintext.
export function clearStoredReveals(): void {
  if (typeof localStorage === 'undefined') return;
  const prefix = getPluginId('reveal/');
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // storage disabled — nothing persisted to clear.
  }
}
