import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { combatMachine, type RosterEntry } from './combatMachine';
import { hpAfterDowned } from '../rules/downed';

const roster: RosterEntry[] = [
  { kind: 'pc', id: 'a', name: 'Aria', ownerId: 'p1', hitDice: [8], level: 3, proficiencyBonus: 2, currentHp: 24 },
  { kind: 'pc', id: 'b', name: 'Borin', ownerId: 'p2', hitDice: [10], level: 3, proficiencyBonus: 2, currentHp: 24 },
];

describe('combatMachine', () => {
  it('runs a full round lifecycle and loops back to assignment', () => {
    const actor = createActor(combatMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'combat.started', roster });
    // setup is transient → round.assignment
    expect(actor.getSnapshot().matches({ round: 'assignment' })).toBe(true);
    expect(actor.getSnapshot().context.round).toBe(1);
    expect(actor.getSnapshot().context.combatants.a.threshold).toBe(10); // d8→5 × PB2
    expect(actor.getSnapshot().context.combatants.a.poolCount).toBe(6); // 3 × 2

    actor.send({ type: 'combatant.lockedIn', id: 'a' });
    expect(actor.getSnapshot().matches({ round: 'assignment' })).toBe(true); // b not locked yet

    actor.send({ type: 'combatant.lockedIn', id: 'b' });
    // all locked → reveal (transient) → resolveDamage
    expect(actor.getSnapshot().matches({ round: 'resolveDamage' })).toBe(true);

    // Ordering invariant: a later phase's event is ignored until its turn.
    actor.send({ type: 'saves.resolved', effects: [] });
    expect(actor.getSnapshot().matches({ round: 'resolveDamage' })).toBe(true);

    actor.send({ type: 'damage.resolved', damage: {}, healing: {} });
    expect(actor.getSnapshot().matches({ round: 'resolveMovement' })).toBe(true);

    actor.send({ type: 'movement.resolved' });
    expect(actor.getSnapshot().matches({ round: 'resolveSaves' })).toBe(true);

    const prone = { id: 'e1', source: 'b', target: 'a', description: 'prone', appliedRound: 1 };
    actor.send({ type: 'saves.resolved', effects: [prone] });
    // carryover → back to assignment, round incremented, locks cleared, effect persisted
    expect(actor.getSnapshot().matches({ round: 'assignment' })).toBe(true);
    expect(actor.getSnapshot().context.round).toBe(2);
    expect(actor.getSnapshot().context.combatants.a.lockedIn).toBe(false);
    expect(actor.getSnapshot().context.persistentEffects).toHaveLength(1);
  });

  it('seeds a mixed roster: monster from CR, multiclass PC from highest hit die', () => {
    const mixed: RosterEntry[] = [
      { kind: 'monster', id: 'g', name: 'Goblin', ownerId: 'gm', hitDie: 6, cr: 0.25 },
      { kind: 'pc', id: 'm', name: 'Mira', ownerId: 'p1', hitDice: [8, 10], level: 3, proficiencyBonus: 2, currentHp: 24 },
    ];
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster: mixed });
    const { combatants } = actor.getSnapshot().context;

    // Goblin: PB from CR 0.25 → 2, threshold d6→4 × 2 = 8, pool max(1, ceil(0.25×2)) = 1.
    expect(combatants.g.proficiencyBonus).toBe(2);
    expect(combatants.g.threshold).toBe(8);
    expect(combatants.g.poolCount).toBe(1);
    expect(combatants.g.hitDie).toBe(6);

    // Mira: multiclass uses highest die (d10) → threshold 6 × 2 = 12, pool 3 × 2 = 6.
    expect(combatants.m.hitDie).toBe(10);
    expect(combatants.m.threshold).toBe(12);
    expect(combatants.m.poolCount).toBe(6);
  });

  it('applies a threshold break: exceeding the threshold removes PB dice', () => {
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster });
    actor.send({ type: 'combatant.lockedIn', id: 'a' });
    actor.send({ type: 'combatant.lockedIn', id: 'b' });

    // a: threshold 10, pool 6, PB 2. 11 damage exceeds → lose 2 dice → pool 4.
    actor.send({ type: 'damage.resolved', damage: { a: 11 }, healing: {} });
    const a = actor.getSnapshot().context.combatants.a;
    expect(a.poolCount).toBe(4);
    expect(a.outOfCombat).toBe(false);
    // b took no damage.
    expect(actor.getSnapshot().context.combatants.b.poolCount).toBe(6);
  });

  it('ends combat when only one combatant remains active', () => {
    const fragile: RosterEntry[] = [
      { kind: 'pc', id: 'a', name: 'Aria', ownerId: 'p1', hitDice: [8], level: 1, proficiencyBonus: 2, currentHp: 10 }, // pool 2
      { kind: 'pc', id: 'b', name: 'Borin', ownerId: 'p2', hitDice: [10], level: 3, proficiencyBonus: 2, currentHp: 24 },
    ];
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster: fragile });
    actor.send({ type: 'combatant.lockedIn', id: 'a' });
    actor.send({ type: 'combatant.lockedIn', id: 'b' });

    // 11 damage breaks a's threshold (10) → lose PB(2) → pool 0 → out of combat.
    actor.send({ type: 'damage.resolved', damage: { a: 11 }, healing: {} });
    expect(actor.getSnapshot().context.combatants.a.outOfCombat).toBe(true);

    actor.send({ type: 'movement.resolved' });
    actor.send({ type: 'saves.resolved', effects: [] });
    // carryover: only b active → combatShouldEnd → combatEnded (final).
    expect(actor.getSnapshot().value).toBe('combatEnded');
    expect(actor.getSnapshot().status).toBe('done');
  });

  it('reconciles downed-PC HP on combatEnded, leaving survivors untouched', () => {
    const fragile: RosterEntry[] = [
      { kind: 'pc', id: 'a', name: 'Aria', ownerId: 'p1', hitDice: [8], level: 1, proficiencyBonus: 2, currentHp: 10 }, // pool 2
      { kind: 'pc', id: 'b', name: 'Borin', ownerId: 'p2', hitDice: [10], level: 3, proficiencyBonus: 2, currentHp: 24 },
    ];
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster: fragile });
    actor.send({ type: 'combatant.lockedIn', id: 'a' });
    actor.send({ type: 'combatant.lockedIn', id: 'b' });

    // 11 damage breaks a's threshold (10) → lose PB(2) → pool 0 → out of combat (downed).
    actor.send({ type: 'damage.resolved', damage: { a: 11 }, healing: {} });
    actor.send({ type: 'movement.resolved' });
    actor.send({ type: 'saves.resolved', effects: [] });

    // carryover → only b active → combatEnded (final) → reconcileDownedHp fires.
    expect(actor.getSnapshot().value).toBe('combatEnded');
    const { combatants } = actor.getSnapshot().context;
    // Downed PC a: 10 → hpAfterDowned(10, 2) = 10 - (5 + 2) = 3.
    expect(combatants.a.currentHp).toBe(hpAfterDowned(10, 2));
    expect(combatants.a.currentHp).toBe(3);
    // Survivor b never went out of combat → HP unchanged.
    expect(combatants.b.currentHp).toBe(24);
  });

  it('spends per-side advantage dice, clamping each pool at zero', () => {
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster, advantagePools: { party: 2, monsters: 1 } });
    expect(actor.getSnapshot().context.advantagePools).toEqual({ party: 2, monsters: 1 });

    actor.send({ type: 'advantage.spent', side: 'party' });
    expect(actor.getSnapshot().context.advantagePools).toEqual({ party: 1, monsters: 1 });

    actor.send({ type: 'advantage.spent', side: 'party' });
    expect(actor.getSnapshot().context.advantagePools).toEqual({ party: 0, monsters: 1 });

    // Already empty → clamped, never negative; the monster pool is untouched.
    actor.send({ type: 'advantage.spent', side: 'party' });
    expect(actor.getSnapshot().context.advantagePools).toEqual({ party: 0, monsters: 1 });
  });

  it('defaults advantage pools to zero when combat.started omits them', () => {
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster });
    expect(actor.getSnapshot().context.advantagePools).toEqual({ party: 0, monsters: 0 });
  });

  it('can be ended manually mid-round via combat.ended', () => {
    const actor = createActor(combatMachine);
    actor.start();
    actor.send({ type: 'combat.started', roster });
    actor.send({ type: 'combat.ended' });
    expect(actor.getSnapshot().value).toBe('combatEnded');
  });
});
