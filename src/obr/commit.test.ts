import { describe, expect, it } from 'vitest';
import type { Assignment } from '../rules/types';
import {
  canonicalAssignment,
  computeCommitment,
  generateSalt,
  verifyCommitment,
} from './commit';

function sample(): Assignment {
  return {
    action: [{ kind: 'die', value: 17 }, { kind: 'token' }],
    bonus: { kind: 'die', value: 4 },
    reaction: null,
    saves: [20, 11, 3],
  };
}

describe('canonicalAssignment', () => {
  it('is stable when the object is rebuilt with keys in a different order', () => {
    const a: Assignment = {
      action: [{ kind: 'die', value: 12 }],
      bonus: { kind: 'token' },
      reaction: { kind: 'die', value: 8 },
      saves: [15, 2],
    };
    // Same values, properties inserted in a different order.
    const reordered: Assignment = {
      saves: [15, 2],
      reaction: { kind: 'die', value: 8 },
      bonus: { kind: 'token' },
      action: [{ kind: 'die', value: 12 }],
    };
    expect(canonicalAssignment(reordered)).toBe(canonicalAssignment(a));
  });

  it('encodes null, token, and die slots distinctly', () => {
    const a: Assignment = { action: [null], bonus: { kind: 'token' }, reaction: { kind: 'die', value: 5 }, saves: [] };
    expect(canonicalAssignment(a)).toBe(
      JSON.stringify({ action: ['n'], bonus: 't', reaction: 'd5', saves: [] }),
    );
  });
});

describe('generateSalt', () => {
  it('is 32 lowercase hex chars (16 bytes)', () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is unique across calls', () => {
    const salts = new Set(Array.from({ length: 100 }, () => generateSalt()));
    expect(salts.size).toBe(100);
  });
});

describe('computeCommitment / verifyCommitment', () => {
  it('is deterministic: same (assignment, salt) yields the same hash', async () => {
    const a = sample();
    const salt = generateSalt();
    expect(await computeCommitment(a, salt)).toBe(await computeCommitment(a, salt));
  });

  it('is a 64-char hex SHA-256 digest', async () => {
    const hash = await computeCommitment(sample(), generateSalt());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any slot changes', async () => {
    const salt = generateSalt();
    const base = await computeCommitment(sample(), salt);

    const changedAction: Assignment = { ...sample(), action: [{ kind: 'die', value: 18 }, { kind: 'token' }] };
    const changedBonus: Assignment = { ...sample(), bonus: { kind: 'token' } };
    const changedReaction: Assignment = { ...sample(), reaction: { kind: 'die', value: 1 } };
    const changedSaves: Assignment = { ...sample(), saves: [20, 11, 4] };

    for (const variant of [changedAction, changedBonus, changedReaction, changedSaves]) {
      expect(await computeCommitment(variant, salt)).not.toBe(base);
    }
  });

  it('changes when the salt changes', async () => {
    const a = sample();
    expect(await computeCommitment(a, generateSalt())).not.toBe(
      await computeCommitment(a, generateSalt()),
    );
  });

  it('verifies true for the committed (assignment, salt) and false otherwise', async () => {
    const a = sample();
    const salt = generateSalt();
    const commitment = await computeCommitment(a, salt);

    expect(await verifyCommitment(a, salt, commitment)).toBe(true);

    const tampered: Assignment = { ...a, saves: [20, 11, 2] };
    expect(await verifyCommitment(tampered, salt, commitment)).toBe(false);
    expect(await verifyCommitment(a, generateSalt(), commitment)).toBe(false);
  });
});
