import { setup, assign } from 'xstate';
import type {
  CombatantId,
  CombatantPublic,
  DieValue,
  HitDieSides,
  PersistentEffect,
} from '../rules/types';
import {
  actionPoolSize,
  damageThreshold,
  thresholdForHitDice,
  diceRemovedOnBreak,
  effectiveThreshold,
  exceedsThreshold,
  isOutOfCombat,
} from '../rules/pools';
import { pbFromCr, monsterPoolSize } from '../rules/monsters';
import { hpAfterDowned } from '../rules/downed';

// A combatant's public identity at combat start. Hidden dice values are never
// part of this — the GM-owned combatMachine only ever holds public/revealed data.
// A roster can mix player characters (sized by level × PB) and monsters (sized
// by CR), so RosterEntry is a discriminated union on `kind`.
export type RosterEntry =
  | {
      kind: 'pc';
      id: CombatantId;
      name: string;
      // OBR player id of the controlling client (the owning player, or the GM).
      ownerId: string;
      hitDice: HitDieSides[];
      level: number;
      proficiencyBonus: number;
      currentHp: number;
    }
  | {
      kind: 'monster';
      id: CombatantId;
      name: string;
      // Monsters/NPCs are GM-owned: this is the GM's player id.
      ownerId: string;
      hitDie: HitDieSides;
      cr: number;
    };

// Map a roster entry to its public, revealed seed. Pure orchestration over the
// rules layer — PCs use level/PB and their highest hit die; monsters derive PB
// and pool size from CR.
function seedCombatant(e: RosterEntry): CombatantPublic {
  const base = {
    id: e.id,
    name: e.name,
    ownerId: e.ownerId,
    lockedIn: false,
    outOfCombat: false,
    revealedAssignment: null,
  } as const;
  if (e.kind === 'pc') {
    const hitDie = Math.max(...e.hitDice) as HitDieSides;
    return {
      ...base,
      hitDie,
      level: e.level,
      proficiencyBonus: e.proficiencyBonus,
      threshold: thresholdForHitDice(e.hitDice, e.proficiencyBonus),
      poolCount: actionPoolSize(e.level, e.proficiencyBonus),
      isPC: true,
      currentHp: e.currentHp,
    };
  }
  const proficiencyBonus = pbFromCr(e.cr);
  return {
    ...base,
    hitDie: e.hitDie,
    proficiencyBonus,
    threshold: damageThreshold(e.hitDie, proficiencyBonus),
    poolCount: monsterPoolSize(e.cr),
    isPC: false,
  };
}

// DECIDED (CLAUDE.md): the Advantage/Disadvantage pool is shared per SIDE — one
// for the party, one for the GM's monsters. The machine holds only public COUNTS;
// the hidden die values live client-side and resolve via src/rules/advantage.ts.
export interface AdvantagePools {
  party: number;
  monsters: number;
}

export interface CombatContext {
  combatants: Record<CombatantId, CombatantPublic>;
  round: number;
  persistentEffects: PersistentEffect[];
  advantagePools: AdvantagePools;
  // The Save dice each combatant consumed on a SUCCESSFUL save in the most
  // recently resolved round, tagged with THAT round. Set on `saves.resolved` and
  // deliberately NOT cleared by the round increment, so it survives into the next
  // round's assignment for each owning client to settle against (a die listed here
  // leaves its pool; unlisted save dice carry). Reset only by the next
  // `saves.resolved` or a fresh machine.
  lastSavesSucceeded: { round: number; byCombatant: Record<CombatantId, DieValue[]> } | null;
}

export type CombatEvent =
  | { type: 'combat.started'; roster: RosterEntry[]; advantagePools?: AdvantagePools }
  | { type: 'combatant.lockedIn'; id: CombatantId }
  | { type: 'damage.resolved'; damage: Record<CombatantId, number>; healing?: Record<CombatantId, number> }
  | { type: 'movement.resolved' }
  | { type: 'saves.resolved'; effects: PersistentEffect[]; savesSucceeded: Record<CombatantId, DieValue[]> }
  | { type: 'advantage.spent'; side: keyof AdvantagePools }
  | { type: 'combat.ended' };

export const combatMachine = setup({
  types: {} as {
    context: CombatContext;
    events: CombatEvent;
  },
  guards: {
    // Every active (still-in) combatant has locked in, and there is at least one.
    allLockedIn: ({ context }) => {
      const active = Object.values(context.combatants).filter((c) => !c.outOfCombat);
      return active.length > 0 && active.every((c) => c.lockedIn);
    },
    // Stub pending faction rules: end when at most one combatant is still active.
    combatShouldEnd: ({ context }) => {
      const active = Object.values(context.combatants).filter((c) => !c.outOfCombat);
      return active.length <= 1;
    },
  },
  actions: {
    seedRoster: assign((_, params: { roster: RosterEntry[]; advantagePools: AdvantagePools }) => {
      const combatants: Record<CombatantId, CombatantPublic> = {};
      for (const e of params.roster) {
        combatants[e.id] = seedCombatant(e);
      }
      return {
        combatants,
        round: 1,
        persistentEffects: [],
        advantagePools: params.advantagePools,
        lastSavesSucceeded: null,
      };
    }),
    // Consume one die from a side's shared adv/disadv pool. The count is public;
    // which value was drawn is resolved client-side (src/rules/advantage.ts).
    spendAdvantageDie: assign(({ context }, params: { side: keyof AdvantagePools }) => ({
      advantagePools: {
        ...context.advantagePools,
        [params.side]: Math.max(0, context.advantagePools[params.side] - 1),
      },
    })),
    registerLock: assign(({ context }, params: { id: CombatantId }) => {
      const c = context.combatants[params.id];
      if (!c) return {};
      return { combatants: { ...context.combatants, [params.id]: { ...c, lockedIn: true } } };
    }),
    clearLocks: assign(({ context }) => {
      const combatants: Record<CombatantId, CombatantPublic> = {};
      for (const [id, c] of Object.entries(context.combatants)) {
        combatants[id] = { ...c, lockedIn: false, revealedAssignment: null };
      }
      return { combatants };
    }),
    // Damage → attrition. The COUNT removed (PB) and resulting pool count are public
    // and deterministic; WHICH dice are dropped is each client's characterMachine choice.
    applyThresholdBreaks: assign(
      ({ context }, params: { damage: Record<CombatantId, number>; healing: Record<CombatantId, number> }) => {
        const combatants: Record<CombatantId, CombatantPublic> = {};
        for (const [id, c] of Object.entries(context.combatants)) {
          const eff = effectiveThreshold(c.threshold, params.healing[id] ?? 0);
          let poolCount = c.poolCount;
          if (exceedsThreshold(params.damage[id] ?? 0, eff)) {
            poolCount = Math.max(0, poolCount - diceRemovedOnBreak(c.proficiencyBonus));
          }
          combatants[id] = { ...c, poolCount, outOfCombat: isOutOfCombat(poolCount) };
        }
        return { combatants };
      },
    ),
    addEffects: assign(({ context }, params: { effects: PersistentEffect[] }) => ({
      persistentEffects: [...context.persistentEffects, ...params.effects],
    })),
    // Record which Save dice succeeded this round, tagged with the CURRENT round
    // (before the carryover increment). Persists across the round increment so the
    // next round's assignment can route each combatant's consumed save dice to its
    // owning client's settle.
    recordSavesSucceeded: assign(
      ({ context }, params: { savesSucceeded: Record<CombatantId, DieValue[]> }) => ({
        lastSavesSucceeded: { round: context.round, byCombatant: params.savesSucceeded },
      }),
    ),
    incrementRound: assign(({ context }) => ({ round: context.round + 1 })),
    // End-of-combat: every downed PC (isPC && out of Action Dice) loses HP per
    // src/rules/downed.ts. Non-PCs and PCs still standing are left untouched.
    reconcileDownedHp: assign(({ context }) => {
      const combatants: Record<CombatantId, CombatantPublic> = {};
      for (const [id, c] of Object.entries(context.combatants)) {
        if (c.isPC && c.outOfCombat && c.currentHp !== undefined) {
          combatants[id] = { ...c, currentHp: hpAfterDowned(c.currentHp, c.proficiencyBonus) };
        } else {
          combatants[id] = c;
        }
      }
      return { combatants };
    }),
  },
}).createMachine({
  id: 'combat',
  context: {
    combatants: {},
    round: 0,
    persistentEffects: [],
    advantagePools: { party: 0, monsters: 0 },
    lastSavesSucceeded: null,
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        'combat.started': {
          target: 'setup',
          actions: [
            {
              type: 'seedRoster',
              params: ({ event }) => ({
                roster: event.roster,
                advantagePools: event.advantagePools ?? { party: 0, monsters: 0 },
              }),
            },
          ],
        },
      },
    },
    // Transient: pools are rolled on each client; the public seed happened in seedRoster.
    setup: {
      always: { target: 'round' },
    },
    round: {
      initial: 'assignment',
      on: {
        'combat.ended': { target: '#combat.combatEnded' },
        // Available in any phase: a side draws from its shared adv/disadv pool.
        'advantage.spent': {
          actions: [{ type: 'spendAdvantageDie', params: ({ event }) => ({ side: event.side }) }],
        },
      },
      states: {
        assignment: {
          tags: ['hidden'],
          on: {
            'combatant.lockedIn': {
              actions: [{ type: 'registerLock', params: ({ event }) => ({ id: event.id }) }],
            },
          },
          always: { guard: 'allLockedIn', target: 'reveal' },
        },
        // Simultaneous reveal (transient) → resolution begins.
        reveal: {
          tags: ['revealed'],
          always: { target: 'resolveMovement' },
        },
        // Resolution order Movement → Damage → Saves is enforced STRUCTURALLY: each
        // phase can only reach the next, so Saves is unreachable without the prior two.
        resolveMovement: {
          tags: ['resolving'],
          on: {
            'movement.resolved': { target: 'resolveDamage' },
          },
        },
        resolveDamage: {
          tags: ['resolving'],
          on: {
            'damage.resolved': {
              target: 'resolveSaves',
              actions: [
                {
                  type: 'applyThresholdBreaks',
                  params: ({ event }) => ({ damage: event.damage, healing: event.healing ?? {} }),
                },
              ],
            },
          },
        },
        resolveSaves: {
          tags: ['resolving'],
          on: {
            'saves.resolved': {
              target: 'carryover',
              actions: [
                { type: 'addEffects', params: ({ event }) => ({ effects: event.effects }) },
                {
                  type: 'recordSavesSucceeded',
                  params: ({ event }) => ({ savesSucceeded: event.savesSucceeded }),
                },
              ],
            },
          },
        },
        carryover: {
          entry: [{ type: 'clearLocks' }],
          always: [
            { guard: 'combatShouldEnd', target: '#combat.combatEnded' },
            { target: 'assignment', actions: [{ type: 'incrementRound' }] },
          ],
        },
      },
    },
    combatEnded: {
      type: 'final',
      entry: [{ type: 'reconcileDownedHp' }],
    },
  },
});
