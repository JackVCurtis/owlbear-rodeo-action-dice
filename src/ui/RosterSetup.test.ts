import { describe, it, expect } from 'vitest';
import type { RosterEntry } from '../machines/combatMachine';
import { rowFromEntry, toEntry, type EditRow } from './RosterSetup';

describe('rowFromEntry', () => {
  it('widens a PC entry, filling monster-only fields with defaults', () => {
    const pc: RosterEntry = {
      kind: 'pc',
      id: 'pc-aria',
      name: 'Aria',
      ownerId: 'gm-1',
      hitDice: [8],
      level: 3,
      proficiencyBonus: 2,
      currentHp: 24,
    };
    expect(rowFromEntry(pc)).toEqual<EditRow>({
      id: 'pc-aria',
      kind: 'pc',
      name: 'Aria',
      ownerId: 'gm-1',
      level: 3,
      proficiencyBonus: 2,
      hitDie: 8,
      currentHp: 24,
      cr: 0.25,
    });
  });

  it('widens a monster entry, filling pc-only fields with defaults', () => {
    const monster: RosterEntry = {
      kind: 'monster',
      id: 'gm-goblin',
      name: 'Goblin',
      ownerId: 'gm-1',
      hitDie: 6,
      cr: 0.25,
    };
    expect(rowFromEntry(monster)).toEqual<EditRow>({
      id: 'gm-goblin',
      kind: 'monster',
      name: 'Goblin',
      ownerId: 'gm-1',
      level: 3,
      proficiencyBonus: 2,
      hitDie: 6,
      currentHp: 24,
      cr: 0.25,
    });
  });

  it('round-trips the demo roster back to identical entries', () => {
    const roster: RosterEntry[] = [
      {
        kind: 'pc',
        id: 'pc-aria',
        name: 'Aria',
        ownerId: 'gm-1',
        hitDice: [8],
        level: 3,
        proficiencyBonus: 2,
        currentHp: 24,
      },
      { kind: 'monster', id: 'gm-goblin', name: 'Goblin', ownerId: 'gm-1', hitDie: 6, cr: 0.25 },
    ];
    expect(roster.map(rowFromEntry).map(toEntry)).toEqual(roster);
  });
});
