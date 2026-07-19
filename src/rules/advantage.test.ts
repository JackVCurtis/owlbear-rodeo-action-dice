import { describe, it, expect } from 'vitest';
import { resolveAdvantage, spendPoolDie } from './advantage';

describe('resolveAdvantage', () => {
  it('advantage keeps the higher die regardless of which is the acting die', () => {
    expect(resolveAdvantage(8, 15, 'advantage')).toBe(15);
    expect(resolveAdvantage(15, 8, 'advantage')).toBe(15);
  });

  it('disadvantage keeps the lower die regardless of which is the acting die', () => {
    expect(resolveAdvantage(8, 15, 'disadvantage')).toBe(8);
    expect(resolveAdvantage(15, 8, 'disadvantage')).toBe(8);
  });

  it('ties resolve to the shared value under either mode', () => {
    expect(resolveAdvantage(12, 12, 'advantage')).toBe(12);
    expect(resolveAdvantage(12, 12, 'disadvantage')).toBe(12);
  });
});

describe('spendPoolDie', () => {
  it('returns the chosen die and removes exactly it from the pool', () => {
    const pool = [20, 14, 7];
    const { die, pool: rest } = spendPoolDie(pool, 1);
    expect(die).toBe(14);
    expect(rest).toEqual([20, 7]);
  });

  it('does not mutate the input pool', () => {
    const pool = [20, 14, 7];
    spendPoolDie(pool, 0);
    expect(pool).toEqual([20, 14, 7]);
  });

  it('handles the first and last index', () => {
    expect(spendPoolDie([5, 9, 3], 0)).toEqual({ die: 5, pool: [9, 3] });
    expect(spendPoolDie([5, 9, 3], 2)).toEqual({ die: 3, pool: [5, 9] });
  });
});
