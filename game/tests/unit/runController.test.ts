import { describe, expect, it, vi } from 'vitest';
import type { Screen } from '../../src/app/flow';
import { createRunController, type RunControllerDeps } from '../../src/app/runController';
import type { RunOverrides } from '../../src/app/seed';
import type { StorageEvents } from '../../src/app/saveStore';
import { setRankRun } from '../../src/meta/progress';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { RingLog } from '../../src/platform/log';
import { memoryStorage } from '../helpers/memoryStorage';

const FIELD = { width: 1280, height: 720 };
const NO_EVENTS: StorageEvents = { addEventListener: () => undefined, removeEventListener: () => undefined };
const NONE: RunOverrides = { seed: undefined, startLives: undefined, quality: undefined, galaxy: undefined };


function setup(overrides: Partial<RunOverrides> = {}, field: RunControllerDeps['field'] = () => FIELD, save?: SaveData) {
  const storage = memoryStorage(save);
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
    notify: () => undefined,
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

  it('stands the run total on the Rank score carried in plus the galaxy score, and on the clear total after it', () => {
    const saved = { ...startRank('2026-10-26'), score: 4000 };
    const { run } = setup({ seed: 2 }, () => FIELD, setRankRun(defaultSave(), saved));
    run.command({ kind: 'resumeRank' });
    const world = run.world;
    if (world === null) throw new Error('Resume must start a run');
    expect(run.runTotal).toBe(4000);
    // Seed 2 keeps the idle ship alive to the warp, so the clear bonus is the galaxy's only score.
    while (run.flow.screen === 'playing') run.handle(world.step(STEP_SECONDS, NO_CONTROLS));
    expect(run.flow.screen).toBe('results');
    expect(run.runTotal).toBe(run.flow.result?.total);
    expect(run.runTotal).toBe(4000 + world.score);
  });

  it('is the galaxy score in Free play', () => {
    const { run } = setup({ galaxy: '1-1', seed: 2 });
    run.command({ kind: 'start' });
    expect(run.runTotal).toBe(run.world?.score);
  });

  it('forfeits a galaxy left unfinished as it boots, before the title shows', () => {
    const { run } = setup({}, () => FIELD, setRankRun(defaultSave(), { ...startRank('2026-10-26'), inGalaxy: true }));
    expect(run.save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
  });

  it('refuses to start without a field, saying what to do', () => {
    const { run } = setup({ galaxy: '1-1' }, () => null);
    expect(() => {
      run.command({ kind: 'start' });
    }).toThrow(/give #app a visible size/);
  });
});
