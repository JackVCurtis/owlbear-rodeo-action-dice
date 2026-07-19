import type { DieValue, HitDieSides } from './types';

// Average roll of an N-sided die, rounded up: ceil((N+1)/2).
// d6 → 4, d8 → 5, d10 → 6, d12 → 7.
export function dieAverageCeil(sides: number): number {
  return Math.ceil((sides + 1) / 2);
}

// Total Action Dice budget for the whole combat: level × proficiency bonus.
export function actionPoolSize(level: number, proficiencyBonus: number): number {
  return level * proficiencyBonus;
}

// Damage threshold = ceil(average hit-die roll) × PB.
// e.g. d8 → 5×PB, d10 → 6×PB.
export function damageThreshold(hitDieSides: number, proficiencyBonus: number): number {
  return dieAverageCeil(hitDieSides) * proficiencyBonus;
}

// Multiclass: the damage threshold uses the HIGHEST hit die among the mix.
export function thresholdForHitDice(hitDice: HitDieSides[], proficiencyBonus: number): number {
  return damageThreshold(Math.max(...hitDice), proficiencyBonus);
}

// Healing received this round raises the threshold for this round only.
export function effectiveThreshold(baseThreshold: number, healingThisRound: number): number {
  return baseThreshold + healingThisRound;
}

// Strict: damage must EXCEED the threshold to force attrition (== does not break).
export function exceedsThreshold(damageThisRound: number, threshold: number): boolean {
  return damageThisRound > threshold;
}

// On a threshold break, a character removes PB Action Dice (of their choice).
export function diceRemovedOnBreak(proficiencyBonus: number): number {
  return proficiencyBonus;
}

// Up to PB dice may be assigned to the Save pool each round.
export function savePoolCap(proficiencyBonus: number): number {
  return proficiencyBonus;
}

// A character with zero Action Dice is out of combat.
export function isOutOfCombat(poolCount: number): boolean {
  return poolCount <= 0;
}

// Remove dice at the given indices from a pool, returning a new array. Used for
// threshold attrition ("remove PB dice of their choice") and save spending.
export function removeDiceAt(pool: readonly DieValue[], indices: readonly number[]): DieValue[] {
  const drop = new Set(indices);
  return pool.filter((_, i) => !drop.has(i));
}
