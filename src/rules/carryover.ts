import type { Assignment, DieValue } from './types';

export interface RoundOutcome {
  assignment: Assignment;
  // Did the assigned Reaction die get consumed this round (e.g. opportunity attack)?
  reactionUsed: boolean;
  // Which Save dice were spent during the Saves phase (multiset drawn from assignment.saves).
  savesSpent: readonly DieValue[];
}

export interface RoundSettlement {
  // Dice that remain available for the next round (unused Save + unused Reaction), descending.
  carried: DieValue[];
  // Dice consumed this round and removed from the pool (Action, Bonus, used Reaction, spent Saves).
  spent: DieValue[];
}

// Remove one occurrence of each value in `toRemove` from `from` (multiset subtraction).
export function subtractMultiset(from: readonly DieValue[], toRemove: readonly DieValue[]): DieValue[] {
  const remaining = [...from];
  for (const value of toRemove) {
    const idx = remaining.indexOf(value);
    if (idx !== -1) remaining.splice(idx, 1);
  }
  return remaining;
}

const descending = (a: number, b: number): number => b - a;

// Partition this round's assigned dice into what carries over vs. what is spent.
// Spec: only unused Save and Reaction dice carry; assigned Action/Bonus dice are
// spent regardless of use.
export function settleRound(outcome: RoundOutcome): RoundSettlement {
  const { assignment, reactionUsed, savesSpent } = outcome;
  const spent: DieValue[] = [];
  const carried: DieValue[] = [];

  // Action & Bonus dice are spent whether or not they were used. The Action slot
  // holds a list (one entry per attack); each die entry is spent, tokens contribute nothing.
  for (const entry of assignment.action) {
    if (entry?.kind === 'die') spent.push(entry.value);
  }
  if (assignment.bonus?.kind === 'die') spent.push(assignment.bonus.value);

  // Reaction die carries if unused, otherwise it is spent.
  if (assignment.reaction?.kind === 'die') {
    if (reactionUsed) spent.push(assignment.reaction.value);
    else carried.push(assignment.reaction.value);
  }

  // Save dice: spent ones leave, the rest carry.
  carried.push(...subtractMultiset(assignment.saves, savesSpent));
  spent.push(...savesSpent);

  return {
    carried: carried.sort(descending),
    spent: spent.sort(descending),
  };
}
