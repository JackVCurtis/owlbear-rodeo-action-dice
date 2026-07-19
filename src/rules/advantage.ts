import type { DieValue } from './types';
import { removeDiceAt } from './pools';

// The Advantage/Disadvantage pool is shared per SIDE (party vs. the GM's
// monsters), rolled separately from Action Dice, sized by a GM-set count at
// setup. combatMachine tracks only the public COUNTS; this module resolves the
// hidden die VALUES on the acting client. One pool die is consumed per instance.

export type AdvantageMode = 'advantage' | 'disadvantage';

// Resolve a roll under advantage/disadvantage: advantage keeps the better of the
// acting die and the drawn pool die, disadvantage keeps the worse.
export function resolveAdvantage(
  actingDie: DieValue,
  poolDie: DieValue,
  mode: AdvantageMode,
): DieValue {
  return mode === 'advantage' ? Math.max(actingDie, poolDie) : Math.min(actingDie, poolDie);
}

// Draw one die from a side's shared pool by index, returning the drawn die and
// the remaining pool. Reuses removeDiceAt so pool spending stays consistent with
// Action Dice attrition/save spending.
export function spendPoolDie(
  pool: readonly DieValue[],
  index: number,
): { die: DieValue; pool: DieValue[] } {
  return { die: pool[index], pool: removeDiceAt(pool, [index]) };
}
