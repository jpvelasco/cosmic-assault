import { describe, expect, it, vi } from 'vitest';
import type { FlowState, Screen } from '../../src/app/flow';
import { createFlowController, STALE_RUN_NOTICE, type FlowControllerDeps } from '../../src/app/flowController';
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

type Backing = Pick<Storage, 'getItem' | 'setItem'>;

function memoryStorage(initial?: SaveData): Backing {
  const items = new Map<string, string>(initial === undefined ? [] : [[SAVE_KEY, JSON.stringify(initial)]]);
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

/** A tab: its own store over `storage` (shared between tabs to model two), and its flow. */
function setup(options: { save?: SaveData; storage?: Backing; galaxy?: GalaxyId; startLives?: number } = {}) {
  const store = createSaveStore({ storage: options.storage ?? memoryStorage(options.save), events: NO_EVENTS });
  store.load();
  const started: FlowState[] = [];
  const screens: Screen[] = [];
  const notify = vi.fn<(text: string) => void>();
  const deps: FlowControllerDeps = {
    store,
    overrides: { galaxy: options.galaxy, startLives: options.startLives },
    today: () => TODAY,
    startRun: (flow) => started.push(flow),
    showScreen: (screen) => screens.push(screen),
    notify,
  };
  return { flow: createFlowController(deps), store, started, screens, notify };
}

/** Steps a World of `id` idle, feeding `flow`, until the flow leaves play; the seed keeps the idle ship alive. */
function playUntilEnd(flow: ReturnType<typeof setup>['flow'], id: GalaxyId, mode: 'free' | 'rank' = 'free'): World {
  const world = new World({ seed: 2, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById(id), mode } });
  while (flow.state.screen === 'playing' && world.status !== 'gameOver') flow.handle(world.step(STEP_SECONDS, NO_CONTROLS), world);
  return world;
}

/** Plays a new Rank run in `tab` from the title. */
function startRankRun(tab: ReturnType<typeof setup>): void {
  tab.flow.command({ kind: 'start' });
  tab.flow.command({ kind: 'chooseMode', mode: 'rank' });
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

  it('a new Rank run starts at 1-1 dated today, with ?lives= if given, and is saved as in its galaxy', () => {
    const tab = setup({ startLives: 5 });
    startRankRun(tab);
    const run = { ...startRank(TODAY), lives: 5, inGalaxy: true };
    expect(tab.flow.state).toMatchObject({ screen: 'playing', mode: 'rank', galaxy: '1-1', rankRun: run });
    expect(tab.store.save).toMatchObject({ rankRun: run, rankSeq: 1 });
  });

  it('with a run saved, Rank asks first; the confirm card abandons the saved run, posting it, for a new one', () => {
    const saved = { ...startRank('2026-10-01'), next: '2-1' as const, score: 7000 };
    const tab = setup({ save: setRankRun(defaultSave(), saved) });
    startRankRun(tab);
    expect(tab.flow.state.screen).toBe('confirmNewRank');
    expect(tab.store.save.rankRun).toEqual(saved);
    tab.flow.command({ kind: 'chooseMode', mode: 'rank' });
    expect(tab.flow.state).toMatchObject({ screen: 'playing', galaxy: '1-1' });
    expect(tab.store.save.rankBoard).toEqual([{ score: 7000, reached: 'D2 · G1', date: TODAY, continued: false }]);
  });

  it('Resume Rank picks up the saved run, and does nothing without one', () => {
    const run = { ...startRank(TODAY), next: '1-4' as const, score: 4000, lives: 2 };
    const resumable = setup({ save: setRankRun(defaultSave(), run) });
    resumable.flow.command({ kind: 'resumeRank' });
    expect(resumable.flow.state).toMatchObject({ screen: 'playing', galaxy: '1-4', rankRun: { ...run, inGalaxy: true } });
    expect(resumable.store.save).toMatchObject({ rankRun: { ...run, inGalaxy: true }, rankSeq: 2 });
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
    expect(flow.state).toMatchObject({ mode: 'rank', galaxy: '2-2', rankRun: { ...startRank(TODAY), next: '2-2', lives: 1, inGalaxy: true } });
  });
});

describe('createFlowController: events', () => {
  it('records a clear as the warp starts, and shows the results while the World is still warping', () => {
    const { flow, store, screens } = setup({ galaxy: '1-1' });
    flow.command({ kind: 'start' });
    const world = playUntilEnd(flow, '1-1');
    expect(world.status).toBe('warping');
    expect(screens.at(-1)).toBe('results');
    expect(store.save.frontier).toBe('1-2');
    expect(store.save.galaxies['1-1']?.stars).toBe(flow.state.result?.report.stars);
  });

  it('moves to game over on gameOver, posting the galaxy score and keeping the run, lost, for a Continue', () => {
    const { flow, store } = setup({ galaxy: '1-1', startLives: 1 });
    flow.command({ kind: 'start' });
    flow.handle([{ type: 'gameOver', score: 321 }], { lives: 0 });
    expect(flow.state.screen).toBe('gameOver');
    expect(store.save.rankBoard).toEqual([{ score: 321, reached: 'D1 · G1', date: TODAY, continued: false }]);
    expect(store.save.rankRun).toMatchObject({ lives: 0, inGalaxy: false });
  });

  it('Resume on a lost run is a Continue: 3 lives, the score reset and the run marked', () => {
    const lost = { ...startRank(TODAY), next: '2-2' as const, score: 5000, lives: 0 };
    const tab = setup({ save: setRankRun(defaultSave(), lost) });
    tab.flow.command({ kind: 'resumeRank' });
    expect(tab.flow.state.rankRun).toMatchObject({ next: '2-2', score: 0, lives: 3, continued: true, inGalaxy: true });
  });

  it('ignores the other events', () => {
    const { flow, screens } = setup({ galaxy: '1-1' });
    flow.command({ kind: 'start' });
    flow.handle([{ type: 'shot', x: 0, y: 0 }, { type: 'warpOut' }], { lives: 3 });
    expect(screens).toEqual(['playing']);
  });
});

describe('createFlowController: a Rank galaxy left unfinished', () => {
  it('Quit forfeits it: the title, and the saved run one life down at the score it carried in', () => {
    const tab = setup();
    startRankRun(tab);
    tab.flow.dispatch({ kind: 'pause' });
    tab.flow.dispatch({ kind: 'quit' });
    expect(tab.flow.state.screen).toBe('title');
    expect(tab.store.save.rankRun).toMatchObject({ next: '1-1', score: 0, lives: 2, inGalaxy: false });
  });

  it('a Free play quit writes nothing', () => {
    const tab = setup({ galaxy: '1-1' });
    tab.flow.command({ kind: 'start' });
    tab.flow.dispatch({ kind: 'pause' });
    const update = vi.spyOn(tab.store, 'update');
    tab.flow.dispatch({ kind: 'quit' });
    expect(tab.flow.state.screen).toBe('title');
    expect(update).not.toHaveBeenCalled();
  });

  it('a tab closed mid-galaxy forfeits it on the next boot', () => {
    const storage = memoryStorage();
    startRankRun(setup({ storage }));
    const next = setup({ storage });
    expect(next.store.save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
    expect(next.flow.state.screen).toBe('title');
  });

  it('on the last life the forfeit loses the run, and the board gets its entry', () => {
    const last = { ...startRank(TODAY), next: '1-2' as const, score: 800, lives: 1, inGalaxy: true };
    const tab = setup({ save: setRankRun(defaultSave(), last) });
    expect(tab.store.save.rankRun).toMatchObject({ lives: 0, score: 800 });
    expect(tab.store.save.rankBoard).toEqual([{ score: 800, reached: 'D1 · G2', date: TODAY, continued: false }]);
  });
});

describe('createFlowController: another tab moved the Rank run on', () => {
  it('drops this tab Rank write, tells the player, and goes to the title', () => {
    const storage = memoryStorage();
    const a = setup({ storage });
    startRankRun(a);
    // Tab B opens while A plays: A's galaxy was left unfinished as far as B can tell, so B forfeits it.
    const b = setup({ storage });
    expect(b.store.save.rankRun).toMatchObject({ lives: 2 });
    a.flow.dispatch({ kind: 'pause' });
    a.flow.dispatch({ kind: 'quit' });
    expect(a.notify).toHaveBeenCalledWith(STALE_RUN_NOTICE);
    expect(a.flow.state.screen).toBe('title');
    // A's own forfeit was not applied on top of B's: one life lost, not two.
    expect(a.store.save.rankRun).toMatchObject({ lives: 2 });
    expect(b.store.load().rankRun).toMatchObject({ lives: 2 });
  });

  it('keeps the clear itself even when the Rank part is dropped', () => {
    const storage = memoryStorage();
    const a = setup({ storage });
    startRankRun(a);
    setup({ storage });
    playUntilEnd(a.flow, '1-1', 'rank');
    expect(a.notify).toHaveBeenCalledWith(STALE_RUN_NOTICE);
    expect(a.flow.state.screen).toBe('title');
    expect(a.store.save).toMatchObject({ frontier: '1-2', rankRun: { next: '1-1', lives: 2 } });
  });

  it('from the title a tab sees the run as stored now, so it can resume the other tab run', () => {
    const storage = memoryStorage();
    const a = setup({ storage });
    startRankRun(a);
    a.flow.dispatch({ kind: 'pause' });
    a.flow.dispatch({ kind: 'quit' });
    const b = setup({ storage });
    b.flow.command({ kind: 'resumeRank' });
    a.store.load();
    a.flow.command({ kind: 'resumeRank' });
    expect(a.notify).not.toHaveBeenCalled();
    expect(a.flow.state.screen).toBe('playing');
  });
});
