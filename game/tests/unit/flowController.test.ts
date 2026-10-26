import { describe, expect, it, vi } from 'vitest';
import type { FlowState, Screen } from '../../src/app/flow';
import { createFlowController, type FlowControllerDeps } from '../../src/app/flowController';
import { createSaveStore, type StorageEvents } from '../../src/app/saveStore';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { setRankRun } from '../../src/meta/progress';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { World } from '../../src/sim/world';

const TODAY = '2026-10-26';
const FIELD = { width: 1280, height: 720 };
const NO_EVENTS: StorageEvents = { addEventListener: () => undefined, removeEventListener: () => undefined };

function memoryStorage(initial?: SaveData): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>(initial === undefined ? [] : [[SAVE_KEY, JSON.stringify(initial)]]);
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

function setup(options: { save?: SaveData; galaxy?: GalaxyId; startLives?: number } = {}) {
  const store = createSaveStore({ storage: memoryStorage(options.save), events: NO_EVENTS });
  store.load();
  const started: FlowState[] = [];
  const screens: Screen[] = [];
  const deps: FlowControllerDeps = {
    store,
    overrides: { galaxy: options.galaxy, startLives: options.startLives },
    today: () => TODAY,
    startRun: (flow) => started.push(flow),
    showScreen: (screen) => screens.push(screen),
  };
  return { flow: createFlowController(deps), store, started, screens };
}

/** A World of `id` stepped idle until it warps out; the seed and 3 lives keep the idle ship alive that long. */
function warpingWorld(id: GalaxyId, mode: 'free' | 'rank' = 'free'): World {
  const world = new World({ seed: 2, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById(id), mode } });
  while (world.status === 'playing') world.step(STEP_SECONDS, NO_CONTROLS);
  if (world.status !== 'warping') throw new Error(`seed 2 no longer survives ${id} idle; pick another seed`);
  return world;
}

describe('createFlowController: commands', () => {
  it('Play opens mode select, and Free play goes through the map and galaxy select into a run', () => {
    const { flow, started, screens } = setup();
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'free' });
    flow.command({ kind: 'openDimension', dimension: 1 });
    flow.command({ kind: 'openGalaxy', id: '1-1' });
    expect(screens).toEqual(['modeSelect', 'map', 'galaxySelect', 'playing']);
    expect(started).toEqual([flow.state]);
    expect(flow.state).toMatchObject({ mode: 'free', galaxy: '1-1', runs: 1 });
  });

  it('ignores a locked Dimension or galaxy', () => {
    const { flow, screens } = setup();
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'free' });
    flow.command({ kind: 'openDimension', dimension: 2 });
    expect(flow.state.screen).toBe('map');
    flow.command({ kind: 'openDimension', dimension: 1 });
    flow.command({ kind: 'openGalaxy', id: '1-2' });
    expect(flow.state.screen).toBe('galaxySelect');
    expect(screens).toEqual(['modeSelect', 'map', 'galaxySelect']);
  });

  it('a new Rank run starts at 1-1 dated today, with ?lives= if given, and is saved', () => {
    const { flow, store } = setup({ startLives: 5 });
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'rank' });
    const run = { ...startRank(TODAY), lives: 5 };
    expect(flow.state).toMatchObject({ screen: 'playing', mode: 'rank', galaxy: '1-1', rankRun: run });
    expect(store.save).toMatchObject({ rankRun: run, rankSeq: 1 });
  });

  it('Resume Rank picks up the saved run, and does nothing without one', () => {
    const run = { ...startRank(TODAY), next: '1-4' as const, score: 4000, lives: 2 };
    const resumable = setup({ save: setRankRun(defaultSave(), run) });
    resumable.flow.command({ kind: 'resumeRank' });
    expect(resumable.flow.state).toMatchObject({ screen: 'playing', galaxy: '1-4', rankRun: run });
    expect(resumable.store.save.rankSeq).toBe(1);
    const none = setup();
    none.flow.command({ kind: 'resumeRank' });
    expect(none.flow.state.screen).toBe('title');
  });

  it('?galaxy= makes Play jump straight into that galaxy in Free play, locked or not', () => {
    const { flow, screens } = setup({ galaxy: '3-5' });
    flow.command({ kind: 'start' });
    expect(screens).toEqual(['playing']);
    expect(flow.state).toMatchObject({ mode: 'free', galaxy: '3-5', rankRun: null });
  });

  it('?galaxy= with ?lives= plays that galaxy as a Rank run with those lives', () => {
    const { flow } = setup({ galaxy: '2-2', startLives: 1 });
    flow.command({ kind: 'start' });
    expect(flow.state).toMatchObject({ mode: 'rank', galaxy: '2-2', rankRun: { ...startRank(TODAY), next: '2-2', lives: 1 } });
  });
});

describe('createFlowController: events', () => {
  it('records a clear the moment galaxyCleared arrives, then shows the results', () => {
    const { flow, store, screens } = setup({ galaxy: '1-1' });
    flow.command({ kind: 'start' });
    const world = warpingWorld('1-1');
    let steps = 0;
    while (flow.state.screen === 'playing') {
      flow.handle(world.step(STEP_SECONDS, NO_CONTROLS), world);
      steps++;
    }
    expect(steps).toBeLessThan(200);
    expect(screens.at(-1)).toBe('results');
    expect(store.save.frontier).toBe('1-2');
    expect(store.save.galaxies['1-1']?.stars).toBe(flow.state.result?.report.stars);
  });

  it('moves to game over on gameOver, with the galaxy score for the Rank board', () => {
    const { flow, store } = setup({ galaxy: '1-1', startLives: 1 });
    flow.command({ kind: 'start' });
    flow.handle([{ type: 'gameOver', score: 321 }], { lives: 0 });
    expect(flow.state.screen).toBe('gameOver');
    expect(store.save.rankBoard).toEqual([{ score: 321, reached: 'D1 · G1', date: TODAY, continued: false }]);
  });

  it('ignores the other events', () => {
    const { flow, screens } = setup({ galaxy: '1-1' });
    flow.command({ kind: 'start' });
    flow.handle([{ type: 'shot', x: 0, y: 0 }, { type: 'warpOut' }], { lives: 3 });
    expect(screens).toEqual(['playing']);
  });
});

describe('createFlowController: quit', () => {
  it('a quit during the warp-out keeps the win: the clear is recorded before the title', () => {
    const { flow, store, screens } = setup({ galaxy: '1-1' });
    flow.command({ kind: 'start' });
    flow.dispatch({ kind: 'pause' });
    flow.quit(warpingWorld('1-1'));
    expect(flow.state.screen).toBe('title');
    expect(screens.slice(-2)).toEqual(['results', 'title']);
    expect(store.save.frontier).toBe('1-2');
  });

  it('a Rank quit during the warp-out saves the run at the next galaxy', () => {
    const { flow, store } = setup();
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'rank' });
    flow.dispatch({ kind: 'pause' });
    flow.quit(warpingWorld('1-1', 'rank'));
    expect(flow.state.screen).toBe('title');
    expect(store.save.rankRun?.next).toBe('1-2');
  });

  it('a quit mid-galaxy writes nothing and goes to the title', () => {
    const { flow, store } = setup({ galaxy: '1-1' });
    flow.command({ kind: 'start' });
    flow.dispatch({ kind: 'pause' });
    const update = vi.spyOn(store, 'update');
    flow.quit(new World({ seed: 2, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById('1-1'), mode: 'free' } }));
    expect(flow.state.screen).toBe('title');
    expect(update).not.toHaveBeenCalled();
  });
});
