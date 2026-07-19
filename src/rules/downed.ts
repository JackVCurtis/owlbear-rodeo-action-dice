// DECIDED (CLAUDE.md "Ending combat"): a downed PC loses half their current HP,
// plus `extraHpLostPerPb` HP per point of proficiency bonus (confirmed 1). Kept
// in config so the multiplier stays a one-line change if it is ever retuned.
// "Downed" is DECIDED to mean out of Action Dice (0 dice) and is detected by the
// caller (combatMachine: isPC && outOfCombat).
export const DOWNED_CONFIG = {
  extraHpLostPerPb: 1,
} as const;

export interface DownedConfig {
  extraHpLostPerPb: number;
}

export function downedHpLoss(
  currentHp: number,
  proficiencyBonus: number,
  config: DownedConfig = DOWNED_CONFIG,
): number {
  return Math.floor(currentHp / 2) + proficiencyBonus * config.extraHpLostPerPb;
}

export function hpAfterDowned(
  currentHp: number,
  proficiencyBonus: number,
  config: DownedConfig = DOWNED_CONFIG,
): number {
  return Math.max(0, currentHp - downedHpLoss(currentHp, proficiencyBonus, config));
}
