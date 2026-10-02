import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from '@owlbear-rodeo/sdk';
import { getPluginId } from './ids';
import type { MirroredCombat } from './sync';

// Minimal in-memory stand-in for OBR.room metadata. Change listeners fire only when
// a test calls `emitChange`, so a test can observe what a subscriber receives from
// the initial read alone.
const fakeRoom = vi.hoisted(() => {
  const state = {
    metadata: {} as Record<string, unknown>,
    listeners: new Set<(m: Record<string, unknown>) => void>(),
  };
  return {
    state,
    reset(metadata: Record<string, unknown> = {}) {
      state.metadata = metadata;
      state.listeners.clear();
    },
    emitChange() {
      const snapshot = { ...state.metadata };
      state.listeners.forEach((l) => l(snapshot));
    },
  };
});

vi.mock('@owlbear-rodeo/sdk', () => ({
  default: {
    room: {
      getMetadata: vi.fn(async () => ({ ...fakeRoom.state.metadata })),
      setMetadata: vi.fn(async (update: Record<string, unknown>) => {
        fakeRoom.state.metadata = { ...fakeRoom.state.metadata, ...update };
      }),
      onMetadataChange: vi.fn((listener: (m: Record<string, unknown>) => void) => {
        fakeRoom.state.listeners.add(listener);
        return () => fakeRoom.state.listeners.delete(listener);
      }),
    },
  },
}));

const { ObrSync } = await import('./obrSync');

const COMBAT_KEY = getPluginId('combat');

const mirror: MirroredCombat = {
  sessionId: 3,
  round: 2,
  phase: 'assignment',
  combatants: {},
  lastSavesSucceeded: null,
};

// Let the subscriber's initial async metadata read settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ObrSync.subscribeCombat', () => {
  beforeEach(() => fakeRoom.reset());

  it('replays the existing combat mirror on subscribe (late joiner / refresh)', async () => {
    fakeRoom.reset({ [COMBAT_KEY]: mirror } as Metadata);
    const handler = vi.fn();

    new ObrSync().subscribeCombat(handler);
    await flush();

    expect(handler).toHaveBeenCalledWith(mirror);
  });

  it('replays null when no combat is mirrored', async () => {
    const handler = vi.fn();

    new ObrSync().subscribeCombat(handler);
    await flush();

    expect(handler).toHaveBeenCalledWith(null);
  });

  it('replays null when the combat key was cleared to null', async () => {
    fakeRoom.reset({ [COMBAT_KEY]: null } as Metadata);
    const handler = vi.fn();

    new ObrSync().subscribeCombat(handler);
    await flush();

    expect(handler).toHaveBeenCalledWith(null);
  });

  it('still delivers later metadata changes', async () => {
    const handler = vi.fn();

    new ObrSync().subscribeCombat(handler);
    await flush();
    fakeRoom.state.metadata[COMBAT_KEY] = mirror;
    fakeRoom.emitChange();

    expect(handler).toHaveBeenLastCalledWith(mirror);
  });

  it('drops the initial read if a newer change arrives before it resolves', async () => {
    const handler = vi.fn();

    new ObrSync().subscribeCombat(handler);
    fakeRoom.state.metadata[COMBAT_KEY] = mirror;
    fakeRoom.emitChange();
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(mirror);
  });

  it('does not deliver the initial read after unsubscribe', async () => {
    fakeRoom.reset({ [COMBAT_KEY]: mirror } as Metadata);
    const handler = vi.fn();

    const unsubscribe = new ObrSync().subscribeCombat(handler);
    unsubscribe();
    await flush();

    expect(handler).not.toHaveBeenCalled();
  });
});
