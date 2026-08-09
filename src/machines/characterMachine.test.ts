import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { characterMachine, type CharacterInput } from './characterMachine';
import { emptyAssignment } from '../rules/types';

const input: CharacterInput = { id: 'a', level: 3, proficiencyBonus: 2, hitDie: 8 };
const fullPool = [20, 18, 15, 12, 9, 3]; // level 3 × PB 2 = 6 dice

function started(over: Partial<CharacterInput> = {}, rolls: number[] = fullPool) {
  const actor = createActor(characterMachine, { input: { ...input, ...over } });
  actor.start();
  actor.send({ type: 'combat.started', rolls });
  return actor;
}

describe('characterMachine', () => {
  it('seeds threshold on start and the hidden pool on combat start', () => {
    const actor = createActor(characterMachine, { input });
    actor.start();
    expect(actor.getSnapshot().context.threshold).toBe(10); // d8→5 × PB2
    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'combat.started', rolls: fullPool });
    expect(actor.getSnapshot().matches('assigning')).toBe(true);
    expect(actor.getSnapshot().context.pool).toEqual(fullPool);
    expect(actor.getSnapshot().hasTag('hidden')).toBe(true);
  });

  it('moves through assign → lock → reveal', () => {
    const actor = started();
    actor.send({
      type: 'assignment.updated',
      assignment: { ...emptyAssignment(), action: [{ kind: 'die', value: 20 }] },
    });
    expect(actor.getSnapshot().context.assignment.action).toEqual([{ kind: 'die', value: 20 }]);

    actor.send({ type: 'assignment.lockedIn' });
    expect(actor.getSnapshot().matches('lockedIn')).toBe(true);

    actor.send({ type: 'reveal' });
    expect(actor.getSnapshot().matches('revealed')).toBe(true);
    expect(actor.getSnapshot().hasTag('revealed')).toBe(true);
  });

  it('does not remove dice when damage only meets the threshold', () => {
    const actor = started();
    actor.send({ type: 'assignment.lockedIn' });
    actor.send({ type: 'reveal' });
    actor.send({ type: 'damage.applied', amount: 10 }); // == threshold, no break
    actor.send({ type: 'threshold.resolved', removeIndices: [0, 1] });
    expect(actor.getSnapshot().context.pool).toHaveLength(6);
  });

  it('removes PB dice on a break and goes out of combat when the pool empties', () => {
    const actor = started({ level: 1 }, [12, 5]); // pool of 2
    actor.send({ type: 'assignment.lockedIn' });
    actor.send({ type: 'reveal' });
    actor.send({ type: 'damage.applied', amount: 11 }); // threshold 10 → break
    actor.send({ type: 'threshold.resolved', removeIndices: [0, 1] }); // drop PB(2) dice
    expect(actor.getSnapshot().context.pool).toEqual([]);
    expect(actor.getSnapshot().matches('outOfCombat')).toBe(true);
    expect(actor.getSnapshot().status).toBe('done');
  });

  it('settles a round: spends action/bonus and successful-save dice, carries the rest', () => {
    const actor = started();
    actor.send({ type: 'assignment.lockedIn' });
    actor.send({ type: 'reveal' });
    actor.send({
      type: 'round.next',
      outcome: {
        assignment: {
          action: [{ kind: 'die', value: 20 }],
          bonus: { kind: 'die', value: 18 },
          reaction: { kind: 'die', value: 3 },
          saves: [15, 9],
        },
        reactionUsed: false,
        savesSucceeded: [15],
      },
    });
    // spent {20,18,15} leave the pool (save 15 succeeded); unused save 9 + reaction 3 carry.
    expect(actor.getSnapshot().matches('assigning')).toBe(true);
    expect(actor.getSnapshot().context.pool).toEqual([12, 9, 3]);
    expect(actor.getSnapshot().context.carriedDice).toEqual([9, 3]);
  });
});
