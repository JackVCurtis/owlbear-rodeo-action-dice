// Domain types shared across the pure rules layer and the machines.
// PURE: no OBR SDK, no XState imports.

export type CombatantId = string;

// A rolled d20 value (1–20). Not branded, to stay ergonomic in tests.
export type DieValue = number;

// Standard 5e hit-die sizes.
export type HitDieSides = 6 | 8 | 10 | 12;

export type Slot = 'action' | 'bonus' | 'reaction';

// What occupies an Action/Bonus/Reaction slot: a rolled die, a no-roll token
// (e.g. Dash), or nothing yet.
export type SlotAssignment =
  | { kind: 'die'; value: DieValue }
  | { kind: 'token' }
  | null;

export interface Assignment {
  // One entry per attack the Action grants (Extra Attack / multiattack). Empty
  // means no Action this round. Bonus and Reaction stay single slots.
  action: SlotAssignment[];
  bonus: SlotAssignment;
  reaction: SlotAssignment;
  // Dice moved to the Save pool this round (up to PB). Carry over if unused.
  saves: DieValue[];
}

export function emptyAssignment(): Assignment {
  return { action: [], bonus: null, reaction: null, saves: [] };
}

// The ordered resolution phases within a round. Order is an invariant
// (Movement → Damage → Saves) enforced structurally by combatMachine.
export type RoundPhase =
  | 'assignment'
  | 'reveal'
  | 'resolveMovement'
  | 'resolveDamage'
  | 'resolveSaves'
  | 'carryover';

// A spell effect / condition that persists across rounds (tagged with the round
// it was applied). Direct/forced movement is the exception — applied immediately.
export interface PersistentEffect {
  id: string;
  source: CombatantId;
  target: CombatantId;
  description: string;
  appliedRound: number;
}

// Public, revealed state the GM-owned combatMachine tracks per combatant.
// Hidden dice VALUES never live here — only counts and post-reveal data.
export interface CombatantPublic {
  id: CombatantId;
  name: string;
  // OBR player id of the client that controls this combatant's hidden dice. Only
  // that client rolls, sees, and assigns them; everyone else sees counts/status.
  // Monsters/NPCs are owned by the GM.
  ownerId: string;
  // The hit die used for this combatant's damage threshold. For a multiclass PC
  // this is the highest of their hit dice; for a monster it is its single die.
  hitDie: HitDieSides;
  // PCs have a level; monsters derive everything from CR and omit it.
  level?: number;
  proficiencyBonus: number;
  threshold: number;
  poolCount: number;
  lockedIn: boolean;
  outOfCombat: boolean;
  revealedAssignment: Assignment | null;
  // Whether this combatant is a player character. Only PCs take the
  // end-of-combat downed HP loss; monsters have no tracked HP.
  isPC: boolean;
  // Current hit points — tracked for PCs only (undefined for monsters).
  currentHp?: number;
}
