import { describe, expect, it, vi } from 'vitest';
import { applySaveChange, INITIAL_FLOW, runDef, saveChange, transition, type FlowAction, type FlowState, type SaveChange, type Screen } from '../../src/app/flow';
import { createFlowController } from '../../src/app/flowController';
import { createSaveStore, type StorageEvents } from '../../src/app/saveStore';
import { galaxyById } from '../../src/content/galaxies';
import { bestsBefore, NO_BESTS, type BestsBefore } from '../../src/meta/bests';
import { totalStars } from '../../src/meta/cosmetics';
import { recordDailyClear } from '../../src/meta/daily';
import { dailyGalaxy } from '../../src/meta/dailyGalaxy';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';
import type { ClearReport } from '../../src/sim/scoring';
import { memoryStorage } from '../helpers/memoryStorage';

const DATE = '2026-10-26';
const NEXT_DAY = '2026-10-27';
const ANCHOR = dailyGalaxy(DATE).def.id;
const REPORT: ClearReport = { score: 4200, bonus: 750, deaths: 1, stars: 2 };
const NO_EVENTS: StorageEvents = { addEventListener: () => undefined, removeEventListener: () => undefined };

const at = (screen: Screen, extra: Partial<FlowState> = {}): FlowState => ({ ...INITIAL_FLOW, screen, ...extra });
/** A Daily run of DATE on `screen`, as reached from mode select. */
const dailyOn = (screen: Screen, extra: Partial<FlowState> = {}): FlowState => at(screen, { mode: 'daily', galaxy: ANCHOR, daily: DATE, runs: 1, ...extra });
const clear = (bests: BestsBefore = NO_BESTS): FlowAction => ({ kind: 'clear', report: REPORT, livesLeft: 2, weaponTier: 1, bests });
const DIE: FlowAction = { kind: 'die', score: 900, weaponTier: 0, bests: NO_BESTS };
const QUIT: FlowAction = { kind: 'quit', livesLeft: 2, weaponTier: 1 };

/** A save holding progress of every other kind: galaxies, the frontier, a Rank run and board, the classic best, seen pickups. */
const FULL_SAVE: SaveData = {
  ...defaultSave(),
  frontier: '2-3',
  galaxies: { '1-1': { bestScore: 1800, stars: 3 }, [ANCHOR]: { bestScore: 10, stars: 1 } },
  rankRun: { ...startRank(DATE), next: '1-4', score: 2100, lives: 2 },
  rankSeq: 6,
  rankBoard: [{ score: 9000, reached: 'D2 · G1', date: '2026-10-01', continued: false }],
  classicBest: 4321,
  seenPickups: ['shield'],
  daily: { lastCleared: '2026-10-25', streak: 3, bestStreak: 5, best: { date: '2026-10-25', score: 7000 } },
};

/** Every field of `save` but `daily`, as stored text: the part a Daily must never touch. */
const outsideDaily = (save: SaveData): string => JSON.stringify({ ...save, daily: null });

describe('transition: into the Daily', () => {
  it("the Daily on mode select plays the date's anchor galaxy in Daily mode, the date pinned to the run", () => {
    const playing = transition(at('modeSelect'), { kind: 'playDaily', date: DATE });
    expect(playing).toEqual(dailyOn('playing'));
  });

  it('is offered on mode select only', () => {
    for (const screen of ['title', 'map', 'galaxySelect', 'confirmNewRank'] as const) {
      const state = at(screen, { mode: screen === 'title' ? null : 'free' });
      expect(transition(state, { kind: 'playDaily', date: DATE })).toBe(state);
    }
  });

  it('a Free play or Rank run pins no date', () => {
    expect(transition(at('galaxySelect', { mode: 'free' }), { kind: 'playGalaxy', id: '1-2' }).daily).toBeNull();
    expect(transition(at('modeSelect'), { kind: 'startRank', run: startRank(DATE) }).daily).toBeNull();
    expect(INITIAL_FLOW.daily).toBeNull();
  });
});

describe('transition: the Daily end cards', () => {
  it('a clear shows results with the score as the total, and a game over the game over card', () => {
    expect(transition(dailyOn('playing'), clear())).toEqual(dailyOn('results', { result: { report: REPORT, total: REPORT.score } }));
    expect(transition(dailyOn('playing'), DIE)).toEqual(dailyOn('gameOver'));
  });

  it.each(['results', 'gameOver'] as const)('on %s, Enter, R and pad A play the same date again', (screen) => {
    const end = transition(dailyOn('playing'), screen === 'results' ? clear() : DIE);
    for (const kind of ['confirm', 'retry'] as const) expect(transition(end, { kind })).toEqual(dailyOn('playing', { runs: 2 }));
  });

  it.each(['results', 'gameOver'] as const)('on %s, Title and Back go to the title, and there is no Next, Map or Continue', (screen) => {
    const end = transition(dailyOn('playing'), screen === 'results' ? clear() : DIE);
    for (const kind of ['title', 'back'] as const) expect(transition(end, { kind })).toEqual({ ...INITIAL_FLOW, runs: 1 });
    for (const kind of ['next', 'map', 'continue'] as const) expect(transition(end, { kind })).toBe(end);
  });

  it('Quit from the pause card goes to the title, dropping the date', () => {
    expect(transition(dailyOn('paused'), QUIT)).toEqual({ ...INITIAL_FLOW, runs: 1 });
  });
});

describe('transition: New best in the Daily', () => {
  it("is judged against the date's earlier best, never the anchor galaxy's", () => {
    const beat = transition(dailyOn('playing'), clear({ galaxy: 1, rankTop: 1, daily: REPORT.score - 1 }));
    expect(beat.newBest).toEqual({ kind: 'daily', score: REPORT.score });
    expect(transition(dailyOn('playing'), clear({ galaxy: 1, rankTop: 1, daily: null })).newBest).toBeNull();
    expect(transition(dailyOn('playing'), clear({ ...NO_BESTS, daily: REPORT.score })).newBest).toBeNull();
  });

  it('a Daily game over beats nothing', () => {
    expect(transition(dailyOn('playing'), { ...DIE, bests: { galaxy: 0, rankTop: 0, daily: 0 } }).newBest).toBeNull();
  });

  it("bestsBefore reads the pinned date's best and no galaxy best for a Daily", () => {
    const save: SaveData = { ...FULL_SAVE, daily: { ...FULL_SAVE.daily, best: { date: DATE, score: 3000 } } };
    expect(bestsBefore(save, dailyOn('playing'))).toEqual({ galaxy: null, rankTop: 9000, daily: 3000 });
    expect(bestsBefore(save, { galaxy: ANCHOR, daily: null })).toEqual({ galaxy: 10, rankTop: 9000, daily: null });
    expect(bestsBefore(FULL_SAVE, dailyOn('playing')).daily).toBeNull();
  });
});

describe('runDef', () => {
  it("resolves the Daily to its date's generated galaxy, and any other run to its own galaxy", () => {
    expect(runDef(dailyOn('playing'))).toEqual(dailyGalaxy(DATE).def);
    expect(runDef(at('playing', { mode: 'free', galaxy: '2-2' }))).toBe(galaxyById('2-2'));
    expect(runDef(INITIAL_FLOW)).toBeNull();
  });
});

/** The save after `action` from `state` as the app writes it, and the change itself. */
function written(save: SaveData, state: FlowState, action: FlowAction): { change: SaveChange | null; save: SaveData } {
  const change = saveChange(state, action, transition(state, action), () => NEXT_DAY);
  return { change, save: change === null ? save : applySaveChange(save, change, save.rankSeq).save };
}

describe('saveChange: the Daily is sealed off from every other record', () => {
  const results = transition(dailyOn('playing'), clear());
  const over = transition(dailyOn('playing'), DIE);
  const cases: readonly { readonly name: string; readonly state: FlowState; readonly action: FlowAction }[] = [
    { name: 'clear', state: dailyOn('playing'), action: clear() },
    { name: 'game over', state: dailyOn('playing'), action: DIE },
    { name: 'hit', state: dailyOn('playing'), action: { kind: 'hit', livesLeft: 1, weaponTier: 0 } },
    { name: 'retry from results', state: results, action: { kind: 'retry' } },
    { name: 'retry from game over', state: over, action: { kind: 'confirm' } },
    { name: 'quit', state: dailyOn('paused'), action: QUIT },
    { name: 'start', state: at('modeSelect'), action: { kind: 'playDaily', date: DATE } },
  ];

  it.each(cases)('$name leaves every field outside the Daily byte-identical, with no Rank part', ({ state, action }) => {
    const { change, save } = written(FULL_SAVE, state, action);
    expect(change?.rank ?? null).toBeNull();
    expect(outsideDaily(save)).toBe(outsideDaily(FULL_SAVE));
    expect(totalStars(save)).toBe(totalStars(FULL_SAVE));
  });

  it("a clear records the pinned date's score through the Daily record, and only a clear writes", () => {
    for (const { name, state, action } of cases) {
      const { save } = written(FULL_SAVE, state, action);
      expect(save, name).toEqual(name === 'clear' ? recordDailyClear(FULL_SAVE, DATE, REPORT.score) : FULL_SAVE);
    }
    expect(written(FULL_SAVE, dailyOn('playing'), clear()).save.daily).toEqual({ lastCleared: DATE, streak: 4, bestStreak: 5, best: { date: DATE, score: REPORT.score } });
  });

  /** Clears the Daily of DATE from mode select on a store over `save`, saving (a normal run) or not (a debug run). */
  function clearDailyOn(save: SaveData, writes: boolean) {
    const storage = memoryStorage(save);
    const store = createSaveStore({ storage, events: NO_EVENTS, writes });
    store.load();
    const flow = createFlowController({ store, overrides: { galaxy: undefined, startLives: undefined }, today: () => DATE, startRun: vi.fn(), showScreen: vi.fn(), notify: vi.fn() });
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'daily' });
    flow.handle([{ type: 'galaxyCleared', score: REPORT.score, bonus: REPORT.bonus, deaths: REPORT.deaths, stars: REPORT.stars }], { lives: 2, weaponTier: 1 });
    expect(flow.state.screen).toBe('results');
    return { flow, storage };
  }

  /** FULL_SAVE with a best on DATE that the clear beats, so only the debug gate keeps a debug clear from a "New best!". */
  const BEATABLE: SaveData = { ...FULL_SAVE, daily: { ...FULL_SAVE.daily, best: { date: DATE, score: REPORT.score - 1 } } };

  it('a debug run (?seed=) writes nothing to storage, and has no record to beat', () => {
    const { flow, storage } = clearDailyOn(BEATABLE, false);
    expect(flow.state.newBest).toBeNull();
    expect(storage.items.get(SAVE_KEY)).toBe(JSON.stringify(BEATABLE));
  });

  it('the same clear in a normal run beats that best', () => {
    expect(clearDailyOn(BEATABLE, true).flow.state.newBest).toEqual({ kind: 'daily', score: REPORT.score });
  });
});

describe('createFlowController: the Daily', () => {
  function setup(save: SaveData = defaultSave()) {
    const storage = memoryStorage(save);
    const store = createSaveStore({ storage, events: NO_EVENTS });
    store.load();
    let today = DATE;
    const started: FlowState[] = [];
    const flow = createFlowController({
      store,
      overrides: { galaxy: undefined, startLives: undefined },
      today: () => today,
      startRun: (state) => started.push(state),
      showScreen: vi.fn(),
      notify: vi.fn(),
    });
    return {
      flow,
      store,
      started,
      setToday: (date: string) => {
        today = date;
      },
    };
  }

  const cleared = (score: number) => [{ type: 'galaxyCleared' as const, score, bonus: 0, deaths: 0, stars: 3 as const }];

  it('the Daily card on mode select plays today, read as it is chosen', () => {
    const { flow, started, setToday } = setup();
    flow.command({ kind: 'start' });
    setToday(NEXT_DAY);
    flow.command({ kind: 'chooseMode', mode: 'daily' });
    expect(started).toEqual([at('playing', { mode: 'daily', galaxy: dailyGalaxy(NEXT_DAY).def.id, daily: NEXT_DAY, runs: 1 })]);
  });

  it('keeps the date a run began on across midnight and its retries, and mode select reads today again', () => {
    const { flow, store, started, setToday } = setup();
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'daily' });
    setToday(NEXT_DAY);
    flow.handle(cleared(1000), { lives: 3, weaponTier: 0 });
    expect(store.save.daily).toMatchObject({ lastCleared: DATE, best: { date: DATE, score: 1000 } });
    flow.command({ kind: 'retry' });
    expect(started.at(-1)?.daily).toBe(DATE);
    flow.handle(cleared(1500), { lives: 3, weaponTier: 0 });
    expect(flow.state.newBest).toEqual({ kind: 'daily', score: 1500 });
    expect(store.save.daily).toMatchObject({ lastCleared: DATE, streak: 1, best: { date: DATE, score: 1500 } });

    flow.command({ kind: 'title' });
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'daily' });
    expect(started.at(-1)?.daily).toBe(NEXT_DAY);
  });

  it("never writes the anchor galaxy's best, stars or frontier", () => {
    const { flow, store } = setup(FULL_SAVE);
    flow.command({ kind: 'start' });
    flow.command({ kind: 'chooseMode', mode: 'daily' });
    flow.handle(cleared(99999), { lives: 3, weaponTier: 0 });
    expect(outsideDaily(store.save)).toBe(outsideDaily(FULL_SAVE));
    expect(flow.state.result?.newLooks).toEqual([]);
  });
});
