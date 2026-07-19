import OBR from '@owlbear-rodeo/sdk';
import { useEffect, useState, type ReactNode } from 'react';
import { createFakeRoom, type CombatSync, type PlayerInfo } from './sync';
import { ObrSync } from './obrSync';

// Renders `children` only once the OBR iframe handshake completes. Outside OBR
// (e.g. plain `npm run dev` in a browser tab) it renders `fallback` so there is
// still something to see.
export function PluginGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!OBR.isAvailable) return;
    OBR.onReady(() => setReady(true));
  }, []);

  if (!OBR.isAvailable) return <>{fallback ?? null}</>;
  return ready ? <>{children}</> : null;
}

export function isInOwlbear(): boolean {
  return OBR.isAvailable;
}

// One shared fake room for non-OBR preview, so repeated createCombatSync() calls
// return clients that share state (mirroring a real single-room session).
const previewRoom = createFakeRoom();

// Outside OBR there is no real GM, so the lone preview client IS the GM. Setup then
// defaults every combatant's owner to this id, so one browser tab drives the whole
// commit→reveal loop. Stable id so repeated createCombatSync() calls reuse it.
const PREVIEW_GM: PlayerInfo = { id: 'preview-gm', name: 'You (GM)', role: 'GM' };

// Single entry point to the sync seam: the real transport inside OBR, an in-memory
// fake client elsewhere so preview still works. Machines never call this — the UI
// wires it to them.
export function createCombatSync(): CombatSync {
  return OBR.isAvailable ? new ObrSync() : previewRoom.createClient(PREVIEW_GM);
}
