import { describe, it, expect } from 'vitest';
import { downedHpLoss, hpAfterDowned } from './downed';

describe('downedHpLoss (default assumption)', () => {
  it('loses half current HP plus PB', () => {
    expect(downedHpLoss(20, 3)).toBe(13); // 10 + 3
    expect(downedHpLoss(21, 2)).toBe(12); // floor(10.5)=10, +2
  });

  it('honors a config override for HP lost per PB point', () => {
    expect(downedHpLoss(20, 3, { extraHpLostPerPb: 2 })).toBe(16); // 10 + 6
  });
});

describe('hpAfterDowned', () => {
  it('subtracts the loss from current HP', () => {
    expect(hpAfterDowned(20, 3)).toBe(7);
  });

  it('never goes below zero', () => {
    expect(hpAfterDowned(4, 5)).toBe(0); // loss 2 + 5 = 7 > 4
  });
});
