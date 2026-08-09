import { useState } from 'react';
import type { CombatEvent } from '../machines/combatMachine';
import type { CombatantId, CombatantPublic, DieValue, PersistentEffect } from '../rules/types';
import type { PhaseName } from './phase';
import type { RevealRecord } from './useHiddenDice';

// GM-only resolution controls. Walks the strict Damage → Movement → Saves order the
// combat machine enforces. Damage is sent to the machine as PUBLIC attrition (pool
// counts); each owning client mirrors that onto its own hidden pool via the public
// pool-count delta. Revealed assignments are shown separately by <RevealList>.
export function ResolutionPanel({
  phase,
  round,
  combatants,
  reveals,
  send,
}: {
  phase: PhaseName;
  round: number;
  combatants: Record<CombatantId, CombatantPublic>;
  reveals: Record<CombatantId, RevealRecord>;
  send: (event: CombatEvent) => void;
}) {
  const all = Object.values(combatants);
  const active = all.filter((c) => !c.outOfCombat);

  const isDamage = phase === 'resolveDamage';
  const isMovement = phase === 'resolveMovement';
  const isSaves = phase === 'resolveSaves';

  const [dmg, setDmg] = useState<Record<string, string>>({});
  const [heal, setHeal] = useState<Record<string, string>>({});
  const [effectDesc, setEffectDesc] = useState('');
  const [effectTarget, setEffectTarget] = useState('');
  // Which revealed Save dice the GM marked as SUCCESSFUL (→ consumed). Keyed by
  // combatant id + the die's index in its `saves` array so duplicate values toggle
  // independently.
  const [saveMarks, setSaveMarks] = useState<Set<string>>(new Set());

  const saveKey = (id: CombatantId, index: number): string => `${id}#${index}`;
  const toggleSave = (key: string) =>
    setSaveMarks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const resolveDamage = () => {
    const damage: Record<CombatantId, number> = {};
    const healing: Record<CombatantId, number> = {};
    for (const c of active) {
      damage[c.id] = Math.max(0, Math.floor(Number(dmg[c.id]) || 0));
      const h = Math.max(0, Math.floor(Number(heal[c.id]) || 0));
      if (h > 0) healing[c.id] = h;
    }
    send({ type: 'damage.resolved', damage, healing });
    setDmg({});
    setHeal({});
  };

  const resolveSaves = () => {
    const effects: PersistentEffect[] = [];
    const desc = effectDesc.trim();
    if (desc) {
      const target = effectTarget || active[0]?.id || '';
      effects.push({ id: `fx-${round}-${Date.now()}`, source: 'gm', target, description: desc, appliedRound: round });
    }
    // Marked (successful) Save dice are consumed; unmarked ones (failed or unused) carry.
    const savesSucceeded: Record<CombatantId, DieValue[]> = {};
    for (const c of active) {
      const saves = reveals[c.id]?.assignment.saves ?? [];
      const consumed: DieValue[] = [];
      saves.forEach((value, index) => {
        if (saveMarks.has(saveKey(c.id, index))) consumed.push(value);
      });
      if (consumed.length > 0) savesSucceeded[c.id] = consumed;
    }
    send({ type: 'saves.resolved', effects, savesSucceeded });
    setEffectDesc('');
    setSaveMarks(new Set());
  };

  if (isDamage) {
    return (
      <div className="phase">
        <h3 className="phase__title">Damage</h3>
        {active.map((c) => (
          <div key={c.id} className="dmgrow">
            <span className="dmgrow__name">{c.name}</span>
            <label className="dmgrow__field">
              dmg
              <input
                type="number"
                min={0}
                value={dmg[c.id] ?? ''}
                onChange={(e) => setDmg((s) => ({ ...s, [c.id]: e.target.value }))}
              />
            </label>
            <label className="dmgrow__field">
              heal
              <input
                type="number"
                min={0}
                value={heal[c.id] ?? ''}
                onChange={(e) => setHeal((s) => ({ ...s, [c.id]: e.target.value }))}
              />
            </label>
            <span className="dmgrow__thr">thr {c.threshold}</span>
          </div>
        ))}
        <button className="phase__go" onClick={resolveDamage}>
          Resolve Damage
        </button>
      </div>
    );
  }

  if (isMovement) {
    return (
      <div className="phase">
        <h3 className="phase__title">Movement</h3>
        <p className="phase__hint">Simultaneous movement; opportunity attacks resolve only if a Reaction die was assigned.</p>
        <button className="phase__go" onClick={() => send({ type: 'movement.resolved' })}>
          Resolve Movement
        </button>
      </div>
    );
  }

  if (isSaves) {
    // Active combatants that revealed at least one Save die, each with its dice ordered
    // highest→lowest (Save dice are spent descending) while preserving the real index.
    const savers = active
      .map((c) => ({
        combatant: c,
        dice: (reveals[c.id]?.assignment.saves ?? [])
          .map((value, index) => ({ value, index }))
          .sort((x, y) => y.value - x.value || x.index - y.index),
      }))
      .filter((s) => s.dice.length > 0);

    return (
      <div className="phase">
        <h3 className="phase__title">Saves</h3>
        <p className="phase__hint">
          Mark each Save die that SUCCEEDED (it is consumed). Unmarked Save dice — failed or unused — carry over.
        </p>
        {savers.length === 0 ? (
          <p className="phase__hint">No Save dice assigned this round.</p>
        ) : (
          savers.map(({ combatant, dice }) => (
            <div key={combatant.id} className="saveresolve">
              <span className="saveresolve__name">{combatant.name}</span>
              <div className="saveresolve__dice">
                {dice.map(({ value, index }) => {
                  const key = saveKey(combatant.id, index);
                  const marked = saveMarks.has(key);
                  return (
                    <label key={index} className={`savemark${marked ? ' savemark--on' : ''}`}>
                      <input type="checkbox" checked={marked} onChange={() => toggleSave(key)} />
                      <span className="savemark__value">{value}</span>
                      <span className="savemark__label">succeeded</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <p className="phase__hint">Optionally record a persistent effect (carries into next round).</p>
        <div className="saverow">
          <input
            className="saverow__desc"
            placeholder="effect, e.g. prone"
            value={effectDesc}
            onChange={(e) => setEffectDesc(e.target.value)}
          />
          <select value={effectTarget} onChange={(e) => setEffectTarget(e.target.value)} aria-label="Effect target">
            <option value="">on…</option>
            {all.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="phase__go" onClick={resolveSaves}>
          Resolve Saves
        </button>
      </div>
    );
  }

  // reveal / carryover: transient GM phases with no manual control.
  return null;
}
