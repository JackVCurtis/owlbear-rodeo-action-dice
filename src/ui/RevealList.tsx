import type { CombatantId, CombatantPublic } from '../rules/types';
import { describeAssignment } from './DiceTray';
import type { RevealRecord } from './useHiddenDice';

// Read-only revealed board shared by the GM resolution view and player clients.
// Hidden dice never live here — assignments come from the verified reveal map, and
// counts/status from the public combat snapshot.
export function RevealList({
  combatants,
  reveals,
  broken,
}: {
  combatants: Record<CombatantId, CombatantPublic>;
  reveals: Record<CombatantId, RevealRecord>;
  broken: Set<CombatantId>;
}) {
  return (
    <div className="resolve__reveals">
      {Object.values(combatants).map((c) => (
        <RevealCard key={c.id} pub={c} record={reveals[c.id]} broke={broken.has(c.id)} />
      ))}
    </div>
  );
}

function RevealCard({
  pub,
  record,
  broke,
}: {
  pub: CombatantPublic;
  record: RevealRecord | undefined;
  broke: boolean;
}) {
  return (
    <div className="reveal">
      <div className="reveal__head">
        <strong>{pub.name}</strong>
        <span className="reveal__meta">
          {pub.poolCount} dice{pub.outOfCombat ? ' · out of combat' : ''}
        </span>
      </div>
      <div className="reveal__body">
        {record ? describeAssignment(record.assignment) : 'revealing…'}
      </div>
      {record?.status === 'pending' && <div className="reveal__pending">verifying…</div>}
      {record?.status === 'mismatch' && (
        <div className="reveal__mismatch">⚠ commitment mismatch — value could not be verified</div>
      )}
      {broke && <div className="reveal__dropped">threshold broken — lost {pub.proficiencyBonus} dice</div>}
    </div>
  );
}
