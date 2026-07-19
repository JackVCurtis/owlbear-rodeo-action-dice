import type { DieValue } from '../rules/types';

// Local d20 rolls. In the hot-seat MVP every combatant's pool is rolled on this
// one client (the values are visible here); real cross-client hidden rolls live
// behind the src/obr sync seam and are out of scope.
export function rollDie(): DieValue {
  return Math.floor(Math.random() * 20) + 1;
}

export function rollDice(count: number): DieValue[] {
  return Array.from({ length: Math.max(0, count) }, rollDie);
}

// Indices of the `count` lowest-value dice in `pool`. Threshold attrition removes
// PB dice "of the character's choice"; this tool auto-picks the weakest. Ties
// break by original index so the result is deterministic.
export function lowestDiceIndices(pool: readonly DieValue[], count: number): number[] {
  return pool
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index)
    .slice(0, Math.max(0, count))
    .map((d) => d.index);
}
