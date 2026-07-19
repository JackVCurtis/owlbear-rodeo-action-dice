import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import type { ActorRefFrom } from 'xstate';
import type { characterMachine } from '../machines/characterMachine';
import type { Assignment, CombatantPublic, DieValue, SlotAssignment } from '../rules/types';
import { savePoolCap } from '../rules/pools';

export type CharActor = ActorRefFrom<typeof characterMachine>;

type SlotChoice = 'action' | 'bonus' | 'reaction' | 'save';

// One OWNED combatant's hidden-dice assignment tray. The pool values are visible
// only on this client (the owner). Slot choices are tracked by pool INDEX (values
// can repeat), then projected into an Assignment (values) pushed to the character
// actor. `locked` reflects this client's own commit, so the tray disables on lock
// without waiting for the GM's round-trip.
export function DiceTray({
  actor,
  pub,
  locked,
  onLock,
}: {
  actor: CharActor;
  pub: CombatantPublic;
  locked: boolean;
  onLock: (id: string) => void;
}) {
  const pool = useSelector(actor, (s) => s.context.pool);
  const cap = savePoolCap(pub.proficiencyBonus);

  // DISPLAY-ONLY view: show dice highest→lowest while preserving each die's real
  // pool index. All assignment bookkeeping (slotByIndex, the Assignment builder)
  // keys off the original `index`, so sorting the rendered list never reorders the
  // actor's `pool` array or changes which die a slot choice refers to.
  const sortedPool = useMemo(
    () =>
      pool
        .map((value, index) => ({ value, index }))
        .sort((a, b) => b.value - a.value || a.index - b.index),
    [pool],
  );

  const [slotByIndex, setSlotByIndex] = useState<Record<number, SlotChoice>>({});
  const [actionTokens, setActionTokens] = useState(0);
  const [bonusToken, setBonusToken] = useState(false);

  const saveCount = Object.values(slotByIndex).filter((c) => c === 'save').length;

  const setSlot = (index: number, choice: SlotChoice | '') => {
    setSlotByIndex((prev) => {
      const next = { ...prev };
      if (!choice) {
        delete next[index];
        return next;
      }
      // Bonus and Reaction are single slots: dislodge whatever held them.
      if (choice === 'bonus' || choice === 'reaction') {
        for (const k of Object.keys(next)) {
          if (next[Number(k)] === choice) delete next[Number(k)];
        }
      }
      next[index] = choice;
      return next;
    });
    if (choice === 'bonus') setBonusToken(false);
  };

  const toggleBonusToken = () => {
    const nb = !bonusToken;
    setBonusToken(nb);
    if (nb) {
      setSlotByIndex((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (next[Number(k)] === 'bonus') delete next[Number(k)];
        return next;
      });
    }
  };

  const assignment: Assignment = useMemo(() => {
    const actionDice: SlotAssignment[] = [];
    let bonus: SlotAssignment = bonusToken ? { kind: 'token' } : null;
    let reaction: SlotAssignment = null;
    const saves: DieValue[] = [];
    for (const [k, choice] of Object.entries(slotByIndex)) {
      const value = pool[Number(k)];
      if (value === undefined) continue;
      if (choice === 'action') actionDice.push({ kind: 'die', value });
      else if (choice === 'bonus') bonus = { kind: 'die', value };
      else if (choice === 'reaction') reaction = { kind: 'die', value };
      else if (choice === 'save') saves.push(value);
    }
    const action: SlotAssignment[] = [
      ...actionDice,
      ...Array.from({ length: actionTokens }, () => ({ kind: 'token' }) as SlotAssignment),
    ];
    saves.sort((a, b) => b - a);
    return { action, bonus, reaction, saves };
  }, [slotByIndex, actionTokens, bonusToken, pool]);

  // Push assignment to this combatant's hidden-state actor on every edit.
  useEffect(() => {
    actor.send({ type: 'assignment.updated', assignment });
  }, [assignment, actor]);

  return (
    <div className={`tray${locked ? ' tray--locked' : ''}`}>
      <div className="tray__head">
        <strong>{pub.name}</strong>
        <span className="tray__meta">
          {pub.isPC ? 'PC' : 'Monster'} · thr {pub.threshold} · {pool.length} dice
        </span>
        {locked && <span className="tray__lock">locked</span>}
      </div>

      <div className="tray__dice">
        {sortedPool.map(({ value, index }) => (
          <div key={index} className="die">
            <span className="die__value">{value}</span>
            <select
              value={slotByIndex[index] ?? ''}
              disabled={locked}
              onChange={(e) => setSlot(index, e.target.value as SlotChoice | '')}
              aria-label={`Assign die ${value}`}
            >
              <option value="">—</option>
              <option value="action">Action</option>
              <option value="bonus">Bonus</option>
              <option value="reaction">Reaction</option>
              <option value="save" disabled={saveCount >= cap && slotByIndex[index] !== 'save'}>
                Save
              </option>
            </select>
          </div>
        ))}
        {pool.length === 0 && <span className="tray__empty">No dice left.</span>}
      </div>

      <div className="tray__tokens">
        <span className="tray__tokens-label">No-roll tokens</span>
        <span className="stepper">
          Action
          <button disabled={locked || actionTokens === 0} onClick={() => setActionTokens((n) => Math.max(0, n - 1))}>
            −
          </button>
          <span className="stepper__n">{actionTokens}</span>
          <button disabled={locked} onClick={() => setActionTokens((n) => n + 1)}>
            +
          </button>
        </span>
        <label className="tray__bonustoken">
          <input type="checkbox" checked={bonusToken} disabled={locked} onChange={toggleBonusToken} />
          Bonus token
        </label>
      </div>

      <div className="tray__summary">{describeAssignment(assignment)}</div>

      <button className="tray__lockbtn" disabled={locked} onClick={() => onLock(pub.id)}>
        {locked ? 'Locked in' : 'Lock in'}
      </button>
    </div>
  );
}

function slotText(s: SlotAssignment): string {
  if (s?.kind === 'die') return String(s.value);
  if (s?.kind === 'token') return 'token';
  return '—';
}

// Rank a slot for display: dice by value, tokens sort last (treated as lowest).
function slotSortValue(s: SlotAssignment): number {
  return s?.kind === 'die' ? s.value : -Infinity;
}

// Shared one-line assignment summary, used in the tray and after reveal. Dice are
// presented highest→lowest (display only — a copy is sorted, never the Assignment).
export function describeAssignment(a: Assignment): string {
  const actionSlots = [...a.action].sort((x, y) => slotSortValue(y) - slotSortValue(x));
  const action =
    actionSlots.length === 0
      ? '—'
      : actionSlots.map((s) => (s?.kind === 'die' ? String(s.value) : 'token')).join(', ');
  const saves = [...a.saves].sort((x, y) => y - x);
  return `Action ${action} · Bonus ${slotText(a.bonus)} · Reaction ${slotText(a.reaction)} · Saves ${
    saves.length ? saves.join(', ') : '—'
  }`;
}
