import { useState } from 'react';
import type { AdvantagePools, RosterEntry } from '../machines/combatMachine';
import type { PlayerInfo } from '../obr/sync';
import type { HitDieSides } from '../rules/types';

const HIT_DICE: HitDieSides[] = [6, 8, 10, 12];

// One editable row carries every field for both kinds; toEntry() narrows it to
// the RosterEntry union on submit. Keeps the form simple (no per-kind row types).
export interface EditRow {
  id: string;
  kind: 'pc' | 'monster';
  name: string;
  // OBR player id that controls this combatant's hidden dice.
  ownerId: string;
  level: number;
  proficiencyBonus: number;
  hitDie: HitDieSides;
  currentHp: number;
  cr: number;
}

let rowSeq = 0;
function newRow(kind: 'pc' | 'monster', ownerId: string): EditRow {
  rowSeq += 1;
  return {
    id: `c${rowSeq}`,
    kind,
    name: kind === 'pc' ? 'New PC' : 'New Monster',
    ownerId,
    level: 3,
    proficiencyBonus: 2,
    hitDie: kind === 'pc' ? 8 : 6,
    currentHp: 24,
    cr: 0.25,
  };
}

export function toEntry(r: EditRow): RosterEntry {
  if (r.kind === 'pc') {
    return {
      kind: 'pc',
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      hitDice: [r.hitDie],
      level: r.level,
      proficiencyBonus: r.proficiencyBonus,
      currentHp: r.currentHp,
    };
  }
  // Monsters are always GM-run regardless of any stale row owner.
  return { kind: 'monster', id: r.id, name: r.name, ownerId: r.ownerId, hitDie: r.hitDie, cr: r.cr };
}

// Inverse of toEntry: widen a started RosterEntry back into a full EditRow so the
// next session's form pre-fills from it. Fields the entry's kind doesn't carry
// (monster-only `cr` on a PC; pc-only level/PB/HP on a monster) get sane defaults.
export function rowFromEntry(e: RosterEntry): EditRow {
  if (e.kind === 'pc') {
    return {
      id: e.id,
      kind: 'pc',
      name: e.name,
      ownerId: e.ownerId,
      level: e.level,
      proficiencyBonus: e.proficiencyBonus,
      hitDie: e.hitDice[0],
      currentHp: e.currentHp,
      cr: 0.25,
    };
  }
  return {
    id: e.id,
    kind: 'monster',
    name: e.name,
    ownerId: e.ownerId,
    level: 3,
    proficiencyBonus: 2,
    hitDie: e.hitDie,
    currentHp: 24,
    cr: e.cr,
  };
}

const DEMO_ROWS: Omit<EditRow, 'ownerId'>[] = [
  { id: 'pc-aria', kind: 'pc', name: 'Aria', level: 3, proficiencyBonus: 2, hitDie: 8, currentHp: 24, cr: 0.25 },
  { id: 'gm-goblin', kind: 'monster', name: 'Goblin', level: 3, proficiencyBonus: 2, hitDie: 6, currentHp: 24, cr: 0.25 },
];

export function RosterSetup({
  players,
  gmId,
  onStart,
  initialRoster,
}: {
  players: PlayerInfo[];
  gmId: string;
  onStart: (roster: RosterEntry[], advantagePools: AdvantagePools) => void;
  // Previous session's roster to pre-fill from; absent on the first-ever session.
  initialRoster?: RosterEntry[];
}) {
  // Every combatant defaults to GM ownership; the GM reassigns PCs to their players.
  // Solo (preview) this means the GM owns all and can drive the whole loop alone.
  // Later sessions seed from the prior roster (owner assignments included); the
  // first session falls back to the demo roster.
  const [rows, setRows] = useState<EditRow[]>(() =>
    initialRoster && initialRoster.length > 0
      ? initialRoster.map(rowFromEntry)
      : DEMO_ROWS.map((r) => ({ ...r, ownerId: gmId })),
  );
  const [party, setParty] = useState(0);
  const [monsters, setMonsters] = useState(0);

  const patch = (id: string, changes: Partial<EditRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const canStart = rows.length > 0 && rows.every((r) => r.name.trim().length > 0);

  return (
    <section className="setup">
      <h2 className="setup__title">Roster</h2>

      <div className="setup__rows">
        {rows.map((r) => (
          <div key={r.id} className="row">
            <div className="row__head">
              <input
                className="row__name"
                value={r.name}
                onChange={(e) => patch(r.id, { name: e.target.value })}
                aria-label="Name"
              />
              <select
                value={r.kind}
                onChange={(e) => {
                  const kind = e.target.value as EditRow['kind'];
                  // Monsters revert to GM ownership.
                  patch(r.id, kind === 'monster' ? { kind, ownerId: gmId } : { kind });
                }}
                aria-label="Type"
              >
                <option value="pc">PC</option>
                <option value="monster">Monster</option>
              </select>
              <button className="row__remove" onClick={() => remove(r.id)} aria-label="Remove" title="Remove">
                ×
              </button>
            </div>

            <div className="row__fields">
              <Field label="Owner">
                <select
                  value={r.ownerId}
                  disabled={r.kind === 'monster'}
                  onChange={(e) => patch(r.id, { ownerId: e.target.value })}
                  aria-label="Owner"
                >
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === gmId ? ' (GM)' : ''}
                    </option>
                  ))}
                  {/* Keep a stale owner visible if that player has since left. */}
                  {!players.some((p) => p.id === r.ownerId) && (
                    <option value={r.ownerId}>unknown ({r.ownerId})</option>
                  )}
                </select>
              </Field>
              {r.kind === 'pc' ? (
                <>
                  <Field label="Level">
                    <input
                      type="number"
                      min={1}
                      value={r.level}
                      onChange={(e) => patch(r.id, { level: clampInt(e.target.value, 1) })}
                    />
                  </Field>
                  <Field label="PB">
                    <input
                      type="number"
                      min={1}
                      value={r.proficiencyBonus}
                      onChange={(e) => patch(r.id, { proficiencyBonus: clampInt(e.target.value, 1) })}
                    />
                  </Field>
                  <Field label="Hit die">
                    <HitDieSelect value={r.hitDie} onChange={(v) => patch(r.id, { hitDie: v })} />
                  </Field>
                  <Field label="HP">
                    <input
                      type="number"
                      min={0}
                      value={r.currentHp}
                      onChange={(e) => patch(r.id, { currentHp: clampInt(e.target.value, 0) })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="CR">
                    <input
                      type="number"
                      min={0}
                      step={0.125}
                      value={r.cr}
                      onChange={(e) => patch(r.id, { cr: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </Field>
                  <Field label="Hit die">
                    <HitDieSelect value={r.hitDie} onChange={(v) => patch(r.id, { hitDie: v })} />
                  </Field>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="setup__add">
        <button onClick={() => setRows((rs) => [...rs, newRow('pc', gmId)])}>+ PC</button>
        <button onClick={() => setRows((rs) => [...rs, newRow('monster', gmId)])}>+ Monster</button>
      </div>

      <div className="setup__adv">
        <span className="setup__adv-label">Advantage pool</span>
        <Field label="Party">
          <input type="number" min={0} value={party} onChange={(e) => setParty(clampInt(e.target.value, 0))} />
        </Field>
        <Field label="Monsters">
          <input type="number" min={0} value={monsters} onChange={(e) => setMonsters(clampInt(e.target.value, 0))} />
        </Field>
      </div>

      <button
        className="setup__start"
        disabled={!canStart}
        onClick={() => onStart(rows.map(toEntry), { party, monsters })}
      >
        Start Combat
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function HitDieSelect({ value, onChange }: { value: HitDieSides; onChange: (v: HitDieSides) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value) as HitDieSides)}>
      {HIT_DICE.map((d) => (
        <option key={d} value={d}>
          d{d}
        </option>
      ))}
    </select>
  );
}

function clampInt(raw: string, min: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.max(min, n) : min;
}
