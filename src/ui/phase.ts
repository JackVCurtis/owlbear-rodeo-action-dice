import type { SnapshotFrom } from 'xstate';
import type { combatMachine } from '../machines/combatMachine';

// Machine-readable phase name. Extends the round's RoundPhase with the two
// combat-level states ('idle', 'combatEnded') so the GM can mirror ONE flat string
// that player clients (which don't run the machine) can categorize.
export type PhaseName =
  | 'idle'
  | 'assignment'
  | 'reveal'
  | 'resolveDamage'
  | 'resolveSaves'
  | 'resolveMovementNpcs'
  | 'resolveMovementPlayers'
  | 'carryover'
  | 'combatEnded';

const FLAT_ROUND_PHASES = ['assignment', 'reveal', 'resolveDamage', 'resolveSaves', 'carryover'] as const;

// Flatten the GM's combat snapshot into a single PhaseName for mirroring. The
// movement phase is a compound state (npcs → players), so its two sub-states map
// to two flat names.
export function phaseName(snapshot: SnapshotFrom<typeof combatMachine>): PhaseName {
  if (snapshot.matches('idle')) return 'idle';
  if (snapshot.matches('combatEnded')) return 'combatEnded';
  if (snapshot.matches({ round: { resolveMovement: 'npcs' } })) return 'resolveMovementNpcs';
  if (snapshot.matches({ round: { resolveMovement: 'players' } })) return 'resolveMovementPlayers';
  for (const p of FLAT_ROUND_PHASES) {
    if (snapshot.matches({ round: p })) return p;
  }
  return 'idle';
}

export const isSetup = (p: PhaseName): boolean => p === 'idle';
export const isAssignment = (p: PhaseName): boolean => p === 'assignment';
export const isEnded = (p: PhaseName): boolean => p === 'combatEnded';
export const isNpcMovement = (p: PhaseName): boolean => p === 'resolveMovementNpcs';
export const isPlayerMovement = (p: PhaseName): boolean => p === 'resolveMovementPlayers';

// Every phase after assignment locks: values are revealed and resolution runs.
export function isResolving(p: PhaseName): boolean {
  return (
    p === 'reveal' ||
    p === 'resolveDamage' ||
    p === 'resolveSaves' ||
    p === 'resolveMovementNpcs' ||
    p === 'resolveMovementPlayers' ||
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
    case 'resolveDamage':
      return 'Resolving: Damage';
    case 'resolveSaves':
      return 'Resolving: Saves';
    case 'resolveMovementNpcs':
      return 'Resolving: Movement (GM moves NPCs)';
    case 'resolveMovementPlayers':
      return 'Resolving: Movement (players move)';
    case 'carryover':
      return 'Carryover';
    case 'combatEnded':
      return 'Combat ended';
  }
}
