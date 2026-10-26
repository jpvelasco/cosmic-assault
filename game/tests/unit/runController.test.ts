import { describe, expect, it, vi } from 'vitest';
import type { Screen } from '../../src/app/flow';
import { createRunController, type RunControllerDeps } from '../../src/app/runController';
import type { RunOverrides } from '../../src/app/seed';
import type { StorageEvents } from '../../src/app/saveStore';
import { SAVE_KEY } from '../../src/meta/save';
import { RingLog } from '../../src/platform/log';

const FIELD = { width: 1280, height: 720 };
const NO_EVENTS: StorageEvents = { addEventListener: () => undefined, removeEventListener: () => undefined };
const NONE: RunOverrides = { seed: undefined, startLives: undefined, quality: undefined, galaxy: undefined };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

function setup(overrides: Partial<RunOverrides> = {}, field: RunControllerDeps['field'] = () => FIELD) {
  const storage = memoryStorage();
  const screens: Screen[] = [];
  const onRunStarted = vi.fn();
  const run = createRunController({
    storage,
    overrides: { ...NONE, ...overrides },
    log: new RingLog(),
    events: NO_EVENTS,
    field,
    showScreen: (screen) => screens.push(screen),
    onRunStarted,
  });
  return { run, storage, screens, onRunStarted };
}

describe('createRunController', () => {
  it('loads the save and imports the classic score once, writing only outside debug runs', () => {
    const real = setup();
    expect(real.run.save.classicImported).toBe(true);
    expect(real.storage.items.has(SAVE_KEY)).toBe(true);
    const debug = setup({ seed: 3 });
    expect(debug.run.save.classicImported).toBe(true);
    expect(debug.storage.items.has(SAVE_KEY)).toBe(false);
  });

  it('builds the World for the galaxy and mode the flow starts, then lets the app reset for it', () => {
    const { run, onRunStarted } = setup({ galaxy: '2-3', seed: 9 });
    expect(run.world).toBeNull();
    run.command({ kind: 'start' });
    expect(run.world?.galaxy?.id).toBe('2-3');
    expect(run.world?.lives).toBe(3);
    expect(onRunStarted).toHaveBeenCalledTimes(1);
  });

  it('gives a Rank run its lives', () => {
    const { run } = setup({ galaxy: '1-1', startLives: 5 });
    run.command({ kind: 'start' });
    expect(run.world?.lives).toBe(5);
  });

  it('drops the run when the flow reaches a menu screen, before it shows it', () => {
    const { run, screens } = setup({ galaxy: '1-1' });
    run.command({ kind: 'start' });
    const world = run.world;
    run.pause();
    run.quit();
    expect(screens).toEqual(['playing', 'paused', 'title']);
    expect(run.world).toBeNull();
    expect(world?.status).toBe('gameOver');
  });

  it('stands the run total on the Rank score so far plus the galaxy score', () => {
    const { run } = setup({ galaxy: '1-1', startLives: 3 });
    expect(run.runTotal).toBe(0);
    run.command({ kind: 'start' });
    expect(run.runTotal).toBe(0);
    run.handle([{ type: 'gameOver', score: 0 }]);
    expect(run.flow.screen).toBe('gameOver');
  });

  it('refuses to start without a field, saying what to do', () => {
    const { run } = setup({ galaxy: '1-1' }, () => null);
    expect(() => {
      run.command({ kind: 'start' });
    }).toThrow(/give #app a visible size/);
  });
});
