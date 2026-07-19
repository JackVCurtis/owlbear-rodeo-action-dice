// Monster/NPC Action Dice sizing. Monsters use the same system as PCs, but
// derive proficiency bonus and pool size from Challenge Rating instead of level.
// PURE: no OBR SDK, no XState imports.

// Proficiency bonus by CR, per the 5e table. Fractional CRs (0, 1/8, 1/4, 1/2)
// all fall in the first band → PB 2.
export function pbFromCr(cr: number): number {
  if (cr <= 4) return 2;
  if (cr <= 8) return 3;
  if (cr <= 12) return 4;
  if (cr <= 16) return 5;
  if (cr <= 20) return 6;
  if (cr <= 24) return 7;
  if (cr <= 28) return 8;
  return 9;
}

// Monster Action Dice budget, the CR analogue of actionPoolSize(level, pb).
// At least 1 so any monster gets a die (fractional CRs would otherwise round to 0).
export function monsterPoolSize(cr: number): number {
  return Math.max(1, Math.ceil(cr * pbFromCr(cr)));
}
