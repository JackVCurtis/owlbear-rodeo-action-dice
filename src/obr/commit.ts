import type { Assignment, SlotAssignment } from '../rules/types';

// PURE: no OBR SDK. Commit–reveal crypto so a hidden assignment can be committed
// (as a hash) before reveal and later verified against its plaintext — with no
// trusted party (not even the GM) able to learn or forge values pre-reveal.
// Runs headless: uses the Web Crypto global available in both Node and browsers.

// Compact, order-stable tag for a single Action/Bonus/Reaction slot.
function encodeSlot(slot: SlotAssignment): string {
  if (slot === null) return 'n';
  if (slot.kind === 'token') return 't';
  return `d${slot.value}`;
}

// Deterministic serialization independent of object key order: rebuilds the
// assignment with a fixed key order and compact slot tags so equal assignments
// always serialize identically regardless of how the object was constructed.
export function canonicalAssignment(a: Assignment): string {
  return JSON.stringify({
    action: a.action.map(encodeSlot),
    bonus: encodeSlot(a.bonus),
    reaction: encodeSlot(a.reaction),
    saves: a.saves,
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// 16 random bytes as 32-char lowercase hex.
export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// Hex SHA-256 of `canonicalAssignment(a) + '|' + salt`.
export async function computeCommitment(a: Assignment, salt: string): Promise<string> {
  const input = `${canonicalAssignment(a)}|${salt}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

// True iff (a, salt) reproduces the committed hash.
export async function verifyCommitment(
  a: Assignment,
  salt: string,
  commitment: string,
): Promise<boolean> {
  const recomputed = await computeCommitment(a, salt);
  return recomputed === commitment;
}
