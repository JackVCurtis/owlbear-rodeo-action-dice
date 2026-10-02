import type { SnapshotFrom } from 'xstate';
import type { combatMachine } from '../machines/combatMachine';

// Machine-readable phase name. Extends the round's RoundPhase with the two
// combat-level states ('idle', 'combatEnded') so the GM can mirror ONE flat string
// that player clients (which don't run the machine) can categorize.
export type PhaseName =
  | 'idle'
  | 'assignment'
  | 'reveal'
  | 'resolveMovement'
  | 'resolveDamage'
  | 'resolveSaves'
  | 'carryover'
  | 'combatEnded';

const ROUND_PHASES = [
  'assignment',
  'reveal',
  'resolveMovement',
  'resolveDamage',
  'resolveSaves',
  'carryover',
] as const;

// Flatten the GM's combat snapshot into a single PhaseName for mirroring.
export function phaseName(snapshot: SnapshotFrom<typeof combatMachine>): PhaseName {
  if (snapshot.matches('idle')) return 'idle';
  if (snapshot.matches('combatEnded')) return 'combatEnded';
  for (const p of ROUND_PHASES) {
    if (snapshot.matches({ round: p })) return p;
  }
  return 'idle';
}

export const isSetup = (p: PhaseName): boolean => p === 'idle';
export const isAssignment = (p: PhaseName): boolean => p === 'assignment';
export const isEnded = (p: PhaseName): boolean => p === 'combatEnded';

// Every phase after assignment locks: values are revealed and resolution runs.
export function isResolving(p: PhaseName): boolean {
  return (
    p === 'reveal' ||
    p === 'resolveMovement' ||
    p === 'resolveDamage' ||
    p === 'resolveSaves' ||
    p === 'carryover'
  );
}

// Human label for the phase banner.
export function describePhase(p: PhaseName): string {
  switch (p) {
    case 'idle':
      return 'Setup';
    case 'assignment':
      return 'Assignment (hidden)';
    case 'reveal':
      return 'Reveal';
    case 'resolveMovement':
      return 'Resolving: Movement';
    case 'resolveDamage':
      return 'Resolving: Damage';
    case 'resolveSaves':
      return 'Resolving: Saves';
    case 'carryover':
      return 'Carryover';
    case 'combatEnded':
      return 'Combat ended';
  }
}
