import { describe, it, expect } from 'vitest';
import {
  dieAverageCeil,
  actionPoolSize,
  damageThreshold,
  thresholdForHitDice,
  effectiveThreshold,
  exceedsThreshold,
  diceRemovedOnBreak,
  savePoolCap,
  isOutOfCombat,
  removeDiceAt,
} from './pools';

describe('dieAverageCeil', () => {
  it('rounds the average roll up for each hit-die size', () => {
    expect(dieAverageCeil(6)).toBe(4);
    expect(dieAverageCeil(8)).toBe(5);
    expect(dieAverageCeil(10)).toBe(6);
    expect(dieAverageCeil(12)).toBe(7);
  });
});

describe('actionPoolSize', () => {
  it('is level × proficiency bonus', () => {
    expect(actionPoolSize(5, 3)).toBe(15);
    expect(actionPoolSize(1, 2)).toBe(2);
  });
});

describe('damageThreshold', () => {
  it('matches the spec examples (d8 → 5×PB, d10 → 6×PB)', () => {
    expect(damageThreshold(8, 1)).toBe(5);
    expect(damageThreshold(10, 1)).toBe(6);
    expect(damageThreshold(8, 3)).toBe(15);
    expect(damageThreshold(10, 3)).toBe(18);
  });
});

describe('thresholdForHitDice', () => {
  it('uses the highest hit die in a multiclass mix', () => {
    expect(thresholdForHitDice([8, 10, 6], 2)).toBe(12); // d10 → 6 × PB2
    expect(thresholdForHitDice([6], 3)).toBe(12); // single d6 → 4 × PB3
    expect(thresholdForHitDice([12, 8], 2)).toBe(14); // d12 → 7 × PB2
  });
});

describe('effectiveThreshold', () => {
  it('raises the threshold by healing received this round', () => {
    expect(effectiveThreshold(15, 0)).toBe(15);
    expect(effectiveThreshold(15, 4)).toBe(19);
  });
});

describe('exceedsThreshold', () => {
  it('is strict — equal damage does NOT break the threshold', () => {
    expect(exceedsThreshold(15, 15)).toBe(false);
    expect(exceedsThreshold(14, 15)).toBe(false);
    expect(exceedsThreshold(16, 15)).toBe(true);
  });
});

describe('attrition and caps', () => {
  it('removes PB dice on break and caps the save pool at PB', () => {
    expect(diceRemovedOnBreak(3)).toBe(3);
    expect(savePoolCap(3)).toBe(3);
  });
});

describe('isOutOfCombat', () => {
  it('is true only when the pool is empty (or somehow negative)', () => {
    expect(isOutOfCombat(0)).toBe(true);
    expect(isOutOfCombat(-1)).toBe(true);
    expect(isOutOfCombat(1)).toBe(false);
  });
});

describe('removeDiceAt', () => {
  it('drops the chosen indices without mutating the input', () => {
    const pool = [20, 15, 8, 3];
    expect(removeDiceAt(pool, [1, 3])).toEqual([20, 8]);
    expect(pool).toEqual([20, 15, 8, 3]);
  });

  it('returns a copy when no indices are given', () => {
    expect(removeDiceAt([5, 6], [])).toEqual([5, 6]);
  });
});
