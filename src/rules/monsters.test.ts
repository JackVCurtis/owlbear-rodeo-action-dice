import { describe, it, expect } from 'vitest';
import { pbFromCr, monsterPoolSize } from './monsters';

describe('pbFromCr', () => {
  it('maps fractional CRs to the first band (PB 2)', () => {
    expect(pbFromCr(0)).toBe(2);
    expect(pbFromCr(0.125)).toBe(2);
    expect(pbFromCr(0.25)).toBe(2);
    expect(pbFromCr(0.5)).toBe(2);
  });

  it('follows the 5e table boundaries', () => {
    expect(pbFromCr(4)).toBe(2);
    expect(pbFromCr(5)).toBe(3);
    expect(pbFromCr(8)).toBe(3);
    expect(pbFromCr(12)).toBe(4);
    expect(pbFromCr(13)).toBe(5);
    expect(pbFromCr(16)).toBe(5);
    expect(pbFromCr(20)).toBe(6);
    expect(pbFromCr(24)).toBe(7);
    expect(pbFromCr(28)).toBe(8);
    expect(pbFromCr(30)).toBe(9);
  });
});

describe('monsterPoolSize', () => {
  it('floors at 1 for tiny/fractional CRs', () => {
    expect(monsterPoolSize(0)).toBe(1);
    expect(monsterPoolSize(0.25)).toBe(1); // ceil(0.25 × 2) = 1
    expect(monsterPoolSize(0.5)).toBe(1); // ceil(0.5 × 2) = 1
  });

  it('is ceil(cr × PB) for the mid range', () => {
    expect(monsterPoolSize(10)).toBe(40); // PB 4 → 10 × 4
    expect(monsterPoolSize(1)).toBe(2); // PB 2 → 1 × 2
    expect(monsterPoolSize(5)).toBe(15); // PB 3 → 5 × 3
  });
});
