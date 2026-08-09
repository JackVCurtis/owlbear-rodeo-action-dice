import type { AdvantagePools, CombatEvent, RosterEntry } from '../machines/combatMachine';
import type { CombatSync, PlayerInfo } from '../obr/sync';
import type { CombatantId, CombatantPublic, DieValue } from '../rules/types';
import { DiceTray } from './DiceTray';
import { ResolutionPanel } from './ResolutionPanel';
import { RevealList } from './RevealList';
import { RosterSetup } from './RosterSetup';
import { describePhase, isAssignment, isEnded, isResolving, isSetup, type PhaseName } from './phase';
import { useHiddenDice } from './useHiddenDice';

// Shared combat surface for both roles. The GM feeds it live machine state (and the
// resolution `send`/`onStart` hooks); a player feeds it the mirrored snapshot and
// no controls. All hidden-dice behavior (owned trays, commit, reveal, verify,
// attrition) lives in useHiddenDice so both roles behave identically.
export function CombatBoard({
  self,
  sync,
  isGM,
  round,
  phase,
  combatants,
  lastSavesSucceeded,
  players,
  send,
  onStart,
  onReset,
  initialRoster,
}: {
  self: PlayerInfo;
  sync: CombatSync;
  isGM: boolean;
  round: number;
  phase: PhaseName;
  combatants: Record<CombatantId, CombatantPublic>;
  lastSavesSucceeded: { round: number; byCombatant: Record<CombatantId, DieValue[]> } | null;
  players?: PlayerInfo[];
  send?: (event: CombatEvent) => void;
  onStart?: (roster: RosterEntry[], advantagePools: AdvantagePools) => void;
  onReset?: () => void;
  initialRoster?: RosterEntry[];
}) {
  const { charActors, committed, reveals, broken, lock } = useHiddenDice({
    self,
    sync,
    isGM,
    round,
    phase,
    combatants,
    lastSavesSucceeded,
  });

  const all = Object.values(combatants);
  const active = all.filter((c) => !c.outOfCombat);
  const lockedCount = active.filter((c) => committed.has(c.id)).length;
  const inProgress = !isSetup(phase) && !isEnded(phase);

  return (
    <>
      <section className="app__phase">
        <span className="app__phase-label">
          {isSetup(phase) || isEnded(phase) ? 'Phase' : `Round ${round} · Phase`}
        </span>
        <strong>{describePhase(phase)}</strong>
      </section>

      {isSetup(phase) &&
        (isGM ? (
          <RosterSetup players={players ?? [self]} gmId={self.id} onStart={onStart!} initialRoster={initialRoster} />
        ) : (
          <p className="app__hint">Waiting for the GM to start combat…</p>
        ))}

      {isAssignment(phase) && (
        <section className="assign">
          <div className="assign__status">
            {lockedCount} / {active.length} locked in
          </div>
          {all.map((c) => {
            const actor = charActors[c.id];
            return c.ownerId === self.id && actor ? (
              <DiceTray key={`${c.id}-${round}`} actor={actor} pub={c} locked={committed.has(c.id)} onLock={lock} />
            ) : (
              <StatusRow key={c.id} pub={c} locked={committed.has(c.id)} />
            );
          })}
        </section>
      )}

      {isResolving(phase) && (
        <section className="resolve">
          <RevealList combatants={combatants} reveals={reveals} broken={broken} />
          {isGM && send && (
            <ResolutionPanel phase={phase} round={round} combatants={combatants} reveals={reveals} send={send} />
          )}
        </section>
      )}

      {isEnded(phase) && <EndView combatants={combatants} onReset={isGM ? onReset : undefined} />}

      {isGM && inProgress && send && (
        <button className="app__danger" onClick={() => send({ type: 'combat.ended' })}>
          End Combat
        </button>
      )}
    </>
  );
}

// A non-owned combatant during assignment: no hidden dice shown, only public
// identity and whether they have committed (locked in).
function StatusRow({ pub, locked }: { pub: CombatantPublic; locked: boolean }) {
  return (
    <div className={`statusrow${locked ? ' statusrow--locked' : ''}`}>
      <strong>{pub.name}</strong>
      <span className="statusrow__meta">
        {pub.isPC ? 'PC' : 'Monster'} · {pub.poolCount} dice
      </span>
      <span className="statusrow__lock">{pub.outOfCombat ? 'out' : locked ? 'locked in' : 'assigning…'}</span>
    </div>
  );
}

// GM-only `onReset` starts a fresh combat; players see the reconciliation only.
function EndView({
  combatants,
  onReset,
}: {
  combatants: Record<CombatantId, CombatantPublic>;
  onReset?: () => void;
}) {
  const pcs = Object.values(combatants).filter((c) => c.isPC);
  return (
    <section className="ended">
      <h2 className="ended__title">Combat ended</h2>
      {pcs.length === 0 && <p className="app__hint">No player characters to reconcile.</p>}
      {pcs.map((c) => (
        <div key={c.id} className="ended__row">
          <strong>{c.name}</strong>
          <span>
            {c.outOfCombat ? 'downed → ' : 'standing · '}HP {c.currentHp}
          </span>
        </div>
      ))}
      {onReset && (
        <button className="app__primary" onClick={onReset}>
          New Combat
        </button>
      )}
    </section>
  );
}
