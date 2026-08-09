import type { Assignment, DieValue } from './types';

export interface RoundOutcome {
  assignment: Assignment;
  // Did the assigned Reaction die get consumed this round (e.g. opportunity attack)?
  reactionUsed: boolean;
  // Save dice consumed by a SUCCESSFUL save this round (multiset drawn from
  // assignment.saves). A save die is consumed only on success — a die used on a
  // failed save, or left unused, is NOT listed here and carries over.
  savesSucceeded: readonly DieValue[];
}

export interface RoundSettlement {
  // Dice available again next round (carried Save + unused Reaction), descending. Save
  // dice carry unless consumed by a successful save — failed and unused saves both carry.
  carried: DieValue[];
  // Dice consumed this round and removed from the pool (Action, Bonus, used Reaction,
  // and Save dice consumed by a successful save).
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
// Spec: Action/Bonus dice are spent regardless of use; the Reaction die and Save
// dice carry unless consumed. A Save die is consumed ONLY by a successful save — a
// die used on a failed save, or left unused, carries over.
export function settleRound(outcome: RoundOutcome): RoundSettlement {
  const { assignment, reactionUsed, savesSucceeded } = outcome;
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

  // Save dice: only those consumed by a successful save leave the pool; failed and
  // unused save dice both carry.
  carried.push(...subtractMultiset(assignment.saves, savesSucceeded));
  spent.push(...savesSucceeded);

  return {
    carried: carried.sort(descending),
    spent: spent.sort(descending),
  };
}
