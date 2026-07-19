import { useState } from 'react';
import type { CombatEvent } from '../machines/combatMachine';
import type { CombatantId, CombatantPublic, PersistentEffect } from '../rules/types';
import type { PhaseName } from './phase';

// GM-only resolution controls. Walks the strict Damage → Movement → Saves order the
// combat machine enforces. Damage is sent to the machine as PUBLIC attrition (pool
// counts); each owning client mirrors that onto its own hidden pool via the public
// pool-count delta. Revealed assignments are shown separately by <RevealList>.
export function ResolutionPanel({
  phase,
  round,
  combatants,
  send,
}: {
  phase: PhaseName;
  round: number;
  combatants: Record<CombatantId, CombatantPublic>;
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
    send({ type: 'saves.resolved', effects });
    setEffectDesc('');
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
    return (
      <div className="phase">
        <h3 className="phase__title">Saves</h3>
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
