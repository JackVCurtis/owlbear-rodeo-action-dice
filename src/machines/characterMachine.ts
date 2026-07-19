import { setup, assign } from 'xstate';
import type { Assignment, CombatantId, DieValue, HitDieSides } from '../rules/types';
import { emptyAssignment } from '../rules/types';
import { damageThreshold, effectiveThreshold, exceedsThreshold, removeDiceAt } from '../rules/pools';
import { settleRound, subtractMultiset, type RoundOutcome } from '../rules/carryover';

// Per-client actor holding ONE combatant's hidden state. Lives on the owning
// client only; the CombatSync seam carries lock flags and reveals across clients.
export interface CharacterContext {
  id: CombatantId;
  level: number;
  proficiencyBonus: number;
  hitDie: HitDieSides;
  threshold: number;
  // Hidden Action Dice values — visible only on this client until reveal.
  pool: DieValue[];
  assignment: Assignment;
  // Unused Save + Reaction dice available again next round.
  carriedDice: DieValue[];
  damageThisRound: number;
  healingThisRound: number;
  // OPEN (CLAUDE.md): unbounded-roll spells pre-roll dice, expended descending.
  spellQueues: Record<string, DieValue[]>;
}

export type CharacterEvent =
  | { type: 'combat.started'; rolls: DieValue[] }
  | { type: 'assignment.updated'; assignment: Assignment }
  | { type: 'assignment.lockedIn' }
  | { type: 'reveal' }
  | { type: 'damage.applied'; amount: number }
  | { type: 'healing.applied'; amount: number }
  | { type: 'threshold.resolved'; removeIndices: number[] }
  | { type: 'round.next'; outcome: RoundOutcome };

export interface CharacterInput {
  id: CombatantId;
  level: number;
  proficiencyBonus: number;
  hitDie: HitDieSides;
}

export const characterMachine = setup({
  types: {} as {
    context: CharacterContext;
    events: CharacterEvent;
    input: CharacterInput;
  },
  guards: {
    poolEmpty: ({ context }) => context.pool.length === 0,
  },
  actions: {
    // rng is injected via the event payload (never Math.random inline) so rolls are
    // deterministic under test.
    seedPool: assign((_, params: { rolls: DieValue[] }) => ({
      pool: [...params.rolls],
      assignment: emptyAssignment(),
      damageThisRound: 0,
      healingThisRound: 0,
    })),
    setAssignment: assign((_, params: { assignment: Assignment }) => ({
      assignment: params.assignment,
    })),
    addDamage: assign(({ context }, params: { amount: number }) => ({
      damageThisRound: context.damageThisRound + params.amount,
    })),
    addHealing: assign(({ context }, params: { amount: number }) => ({
      healingThisRound: context.healingThisRound + params.amount,
    })),
    // Remove the player's chosen dice, but only if the round's damage actually broke
    // the (healing-adjusted) threshold.
    applyAttrition: assign(({ context }, params: { removeIndices: number[] }) => {
      const eff = effectiveThreshold(context.threshold, context.healingThisRound);
      if (!exceedsThreshold(context.damageThisRound, eff)) return {};
      return { pool: removeDiceAt(context.pool, params.removeIndices) };
    }),
    // Spend Action/Bonus/used-Reaction/spent-Save dice; carry the rest.
    settleAndCarry: assign(({ context }, params: { outcome: RoundOutcome }) => {
      const settlement = settleRound(params.outcome);
      return {
        pool: subtractMultiset(context.pool, settlement.spent),
        carriedDice: settlement.carried,
        assignment: emptyAssignment(),
        damageThisRound: 0,
        healingThisRound: 0,
      };
    }),
  },
}).createMachine({
  id: 'character',
  context: ({ input }) => ({
    id: input.id,
    level: input.level,
    proficiencyBonus: input.proficiencyBonus,
    hitDie: input.hitDie,
    threshold: damageThreshold(input.hitDie, input.proficiencyBonus),
    pool: [],
    assignment: emptyAssignment(),
    carriedDice: [],
    damageThisRound: 0,
    healingThisRound: 0,
    spellQueues: {},
  }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        'combat.started': {
          target: 'assigning',
          actions: [{ type: 'seedPool', params: ({ event }) => ({ rolls: event.rolls }) }],
        },
      },
    },
    assigning: {
      tags: ['hidden'],
      on: {
        'assignment.updated': {
          actions: [{ type: 'setAssignment', params: ({ event }) => ({ assignment: event.assignment }) }],
        },
        'assignment.lockedIn': { target: 'lockedIn' },
      },
    },
    lockedIn: {
      tags: ['hidden'],
      on: {
        reveal: { target: 'revealed' },
      },
    },
    revealed: {
      tags: ['revealed'],
      // Attrition may empty the pool → out of combat immediately.
      always: { guard: 'poolEmpty', target: 'outOfCombat' },
      on: {
        'damage.applied': {
          actions: [{ type: 'addDamage', params: ({ event }) => ({ amount: event.amount }) }],
        },
        'healing.applied': {
          actions: [{ type: 'addHealing', params: ({ event }) => ({ amount: event.amount }) }],
        },
        'threshold.resolved': {
          actions: [{ type: 'applyAttrition', params: ({ event }) => ({ removeIndices: event.removeIndices }) }],
        },
        'round.next': {
          target: 'assigning',
          actions: [{ type: 'settleAndCarry', params: ({ event }) => ({ outcome: event.outcome }) }],
        },
      },
    },
    outOfCombat: {
      type: 'final',
      tags: ['out'],
    },
  },
});
