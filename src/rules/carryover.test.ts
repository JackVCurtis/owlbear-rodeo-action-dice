import { describe, it, expect } from 'vitest';
import { settleRound } from './carryover';
import { emptyAssignment } from './types';

describe('settleRound', () => {
  it('carries unused save and reaction dice; spends action and bonus even when unused', () => {
    const settlement = settleRound({
      assignment: {
        action: [{ kind: 'die', value: 18 }],
        bonus: { kind: 'die', value: 11 },
        reaction: { kind: 'die', value: 7 },
        saves: [15, 9],
      },
      reactionUsed: false,
      savesSpent: [],
    });
    // Action(18) + Bonus(11) are spent regardless of use; only unused Save + Reaction carry.
    expect(settlement.carried).toEqual([15, 9, 7]);
    expect(settlement.spent).toEqual([18, 11]);
  });

  it('spends every die in a multi-attack Action list', () => {
    const settlement = settleRound({
      assignment: {
        action: [
          { kind: 'die', value: 20 },
          { kind: 'die', value: 14 },
        ],
        bonus: null,
        reaction: null,
        saves: [],
      },
      reactionUsed: false,
      savesSpent: [],
    });
    expect(settlement.spent).toEqual([20, 14]);
    expect(settlement.carried).toEqual([]);
  });

  it('spends the reaction die when it was used', () => {
    const settlement = settleRound({
      assignment: { ...emptyAssignment(), reaction: { kind: 'die', value: 12 } },
      reactionUsed: true,
      savesSpent: [],
    });
    expect(settlement.carried).toEqual([]);
    expect(settlement.spent).toEqual([12]);
  });

  it('spends only the saves that were used, carrying the rest (multiset-aware)', () => {
    const settlement = settleRound({
      assignment: { ...emptyAssignment(), saves: [12, 12, 8] },
      reactionUsed: false,
      savesSpent: [12],
    });
    expect(settlement.carried).toEqual([12, 8]);
    expect(settlement.spent).toEqual([12]);
  });

  it('ignores token slots (in the Action list) and an empty assignment', () => {
    const settlement = settleRound({
      assignment: { ...emptyAssignment(), action: [{ kind: 'token' }] },
      reactionUsed: false,
      savesSpent: [],
    });
    expect(settlement.carried).toEqual([]);
    expect(settlement.spent).toEqual([]);
  });
});
