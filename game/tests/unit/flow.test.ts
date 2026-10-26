import { describe, expect, it } from 'vitest';
import { freeNext, INITIAL_FLOW, localDate, saveChange, transition, type FlowAction, type FlowState } from '../../src/app/flow';
import type { GalaxyId } from '../../src/content/types';
import { startRank, type RankRun } from '../../src/meta/rankRun';
import { defaultSave, type SaveData } from '../../src/meta/save';
import type { ClearReport } from '../../src/sim/scoring';

const TODAY = '2026-10-26';
const RUN: RankRun = startRank(TODAY);
const REPORT: ClearReport = { score: 1200, bonus: 750, deaths: 0, stars: 3 };

/** A flow on `screen` with `extra` fields, as if reached through the screens before it. */
const at = (screen: FlowState['screen'], extra: Partial<FlowState> = {}): FlowState => ({ ...INITIAL_FLOW, screen, ...extra });
const freeOn = (screen: FlowState['screen'], galaxy: GalaxyId, extra: Partial<FlowState> = {}): FlowState =>
  at(screen, { mode: 'free', galaxy, dimension: Number(galaxy[0]) as FlowState['dimension'], runs: 1, ...extra });
const rankOn = (screen: FlowState['screen'], run: RankRun, extra: Partial<FlowState> = {}): FlowState =>
  at(screen, { mode: 'rank', galaxy: run.next, rankRun: run, runs: 1, ...extra });

/** Applies `actions` in order, as the app would. */
const run = (state: FlowState, ...actions: FlowAction[]): FlowState => actions.reduce(transition, state);

/** The save after `action` from `state`, written as the app writes it. */
function saved(save: SaveData, state: FlowState, action: FlowAction): { state: FlowState; save: SaveData } {
  const next = transition(state, action);
  const change = saveChange(state, action, next, TODAY);
  return { state: next, save: change === null ? save : change(save) };
}

describe('INITIAL_FLOW', () => {
  it('starts on the title with no mode, galaxy or Rank run', () => {
    expect(INITIAL_FLOW).toEqual({ screen: 'title', mode: null, dimension: 1, galaxy: null, rankRun: null, result: null, runs: 0 });
  });
});

describe('transition: into a run', () => {
  it('Play on the title opens mode select', () => {
    expect(transition(INITIAL_FLOW, { kind: 'start' })).toEqual(at('modeSelect'));
  });

  it('Rank on mode select starts the run at its next galaxy', () => {
    expect(transition(at('modeSelect'), { kind: 'startRank', run: RUN })).toEqual(rankOn('playing', RUN));
  });

  it('Free play on mode select opens the Dimension map', () => {
    expect(transition(at('modeSelect'), { kind: 'chooseFree' })).toEqual(at('map', { mode: 'free' }));
  });

  it('a Dimension on the map opens its galaxy select', () => {
    expect(transition(at('map', { mode: 'free' }), { kind: 'openDimension', dimension: 3 })).toEqual(at('galaxySelect', { mode: 'free', dimension: 3 }));
  });

  it('a galaxy on galaxy select starts a Free play run of it', () => {
    const select = at('galaxySelect', { mode: 'free', dimension: 2 });
    expect(transition(select, { kind: 'playGalaxy', id: '2-3' })).toEqual(freeOn('playing', '2-3'));
  });

  it('Resume Rank on the title resumes the saved run where it stopped', () => {
    const suspended: RankRun = { ...RUN, next: '1-4', score: 3300, lives: 2 };
    expect(transition(INITIAL_FLOW, { kind: 'resumeRank', run: suspended })).toEqual(rankOn('playing', suspended));
  });

  it('a ?galaxy= switch on the title jumps straight into that galaxy, in Free play or (with ?lives=) in Rank', () => {
    expect(transition(INITIAL_FLOW, { kind: 'playGalaxy', id: '3-5' })).toEqual(freeOn('playing', '3-5'));
    const direct: RankRun = { ...RUN, next: '3-5', lives: 1 };
    expect(transition(INITIAL_FLOW, { kind: 'startRank', run: direct })).toEqual(rankOn('playing', direct));
  });

  it('counts every run it starts, so the app knows when to build a new World', () => {
    const first = run(at('galaxySelect', { mode: 'free' }), { kind: 'playGalaxy', id: '1-1' });
    const again = run(first, { kind: 'die', score: 0 }, { kind: 'retry' });
    expect([first.runs, again.runs]).toEqual([1, 2]);
  });
});

describe('transition: Back', () => {
  it.each<[FlowState, FlowState]>([
    [at('modeSelect'), at('title')],
    [at('map', { mode: 'free' }), at('modeSelect')],
    [at('galaxySelect', { mode: 'free', dimension: 4 }), at('map', { mode: 'free', dimension: 4 })],
  ])('goes back one screen from %j', (from, to) => {
    expect(transition(from, { kind: 'back' })).toEqual(to);
  });

  it('does nothing on the title or in play', () => {
    for (const state of [INITIAL_FLOW, freeOn('playing', '1-1')]) expect(transition(state, { kind: 'back' })).toBe(state);
  });
});

describe('transition: pause', () => {
  it('pauses and resumes without starting a new run', () => {
    const playing = freeOn('playing', '1-2');
    const paused = transition(playing, { kind: 'pause' });
    expect(paused).toEqual({ ...playing, screen: 'paused' });
    expect(transition(paused, { kind: 'resume' })).toEqual(playing);
  });

  it('Quit leaves for the title; a Rank run stays suspended in the save as it was at the galaxy start', () => {
    expect(transition(freeOn('paused', '1-2'), { kind: 'quit' })).toMatchObject({ screen: 'title', rankRun: null });
    const quit = transition(rankOn('paused', RUN), { kind: 'quit' });
    expect(quit).toMatchObject({ screen: 'title', rankRun: null });
    expect(saveChange(rankOn('paused', RUN), { kind: 'quit' }, quit, TODAY)).toBeNull();
  });
});

describe('transition: Free play results and game over', () => {
  const cleared = transition(freeOn('playing', '1-3'), { kind: 'clear', report: REPORT, livesLeft: 3 });

  it('a clear shows the results with its report', () => {
    expect(cleared).toEqual(freeOn('results', '1-3', { result: { report: REPORT, total: REPORT.score } }));
  });

  it('results offer Next, Retry and Map', () => {
    expect(freeNext(cleared)).toBe('1-4');
    expect(transition(cleared, { kind: 'next' })).toMatchObject({ screen: 'playing', mode: 'free', galaxy: '1-4', runs: 2 });
    expect(transition(cleared, { kind: 'retry' })).toMatchObject({ screen: 'playing', galaxy: '1-3', runs: 2 });
    expect(transition(cleared, { kind: 'map' })).toMatchObject({ screen: 'map', mode: 'free', dimension: 1 });
  });

  it('Enter on results is Next, and Back is Map', () => {
    expect(transition(cleared, { kind: 'confirm' })).toEqual(transition(cleared, { kind: 'next' }));
    expect(transition(cleared, { kind: 'back' })).toEqual(transition(cleared, { kind: 'map' }));
  });

  it('a boss clear goes Next into the next Dimension', () => {
    const boss = transition(freeOn('playing', '2-6'), { kind: 'clear', report: REPORT, livesLeft: 1 });
    expect(transition(boss, { kind: 'next' })).toMatchObject({ galaxy: '3-1', dimension: 3 });
  });

  it('after the last galaxy there is no Next, and Enter, the first button left, retries', () => {
    const last = transition(freeOn('playing', '5-6'), { kind: 'clear', report: REPORT, livesLeft: 1 });
    expect(freeNext(last)).toBeNull();
    expect(transition(last, { kind: 'next' })).toBe(last);
    expect(transition(last, { kind: 'confirm' })).toMatchObject({ screen: 'playing', galaxy: '5-6', runs: 2 });
  });

  it('game over offers Retry and Map, and Retry starts at once', () => {
    const over = transition(freeOn('playing', '2-2'), { kind: 'die', score: 0 });
    expect(over).toEqual(freeOn('gameOver', '2-2'));
    expect(transition(over, { kind: 'retry' })).toEqual(freeOn('playing', '2-2', { runs: 2 }));
    expect(transition(over, { kind: 'confirm' })).toEqual(freeOn('playing', '2-2', { runs: 2 }));
    expect(transition(over, { kind: 'map' })).toEqual(freeOn('map', '2-2'));
    expect(transition(over, { kind: 'back' })).toEqual(freeOn('map', '2-2'));
    for (const kind of ['next', 'continue'] as const) expect(transition(over, { kind })).toBe(over);
  });
});

describe('transition: Rank results', () => {
  const playing = rankOn('playing', { ...RUN, score: 1000, lives: 2 });
  const cleared = transition(playing, { kind: 'clear', report: REPORT, livesLeft: 2 });

  it('a clear carries the score and lives into the next galaxy', () => {
    expect(cleared).toEqual(rankOn('results', { ...RUN, next: '1-2', score: 2200, lives: 2 }, { galaxy: '1-1', result: { report: REPORT, total: 2200 } }));
  });

  it('continues automatically to the run next galaxy: Next and Enter play it', () => {
    const next = rankOn('playing', { ...RUN, next: '1-2', score: 2200, lives: 2 }, { runs: 2 });
    expect(transition(cleared, { kind: 'next' })).toEqual(next);
    expect(transition(cleared, { kind: 'confirm' })).toEqual(next);
  });

  it('has no Retry or Map: a Rank galaxy is played once', () => {
    expect(freeNext(cleared)).toBeNull();
    for (const kind of ['retry', 'map', 'continue'] as const) expect(transition(cleared, { kind })).toBe(cleared);
  });

  it('leaving from results suspends the run: Title and Back go to the title', () => {
    for (const kind of ['title', 'back'] as const) expect(transition(cleared, { kind })).toMatchObject({ screen: 'title', mode: null, rankRun: null });
  });

  it('5-★ completes the run', () => {
    const last = rankOn('playing', { ...RUN, next: '5-6', score: 90000, lives: 1 });
    const done = transition(last, { kind: 'clear', report: REPORT, livesLeft: 1 });
    expect(done).toMatchObject({ screen: 'rankComplete', galaxy: '5-6', rankRun: null, result: { report: REPORT, total: 91200 } });
    for (const kind of ['confirm', 'title', 'back'] as const) expect(transition(done, { kind })).toMatchObject({ screen: 'title', mode: null });
    for (const kind of ['next', 'retry', 'map', 'continue'] as const) expect(transition(done, { kind })).toBe(done);
  });
});

describe('transition: Rank game over', () => {
  const run1 = { ...RUN, next: '1-3' as const, score: 2500, lives: 1 };
  const over = transition(rankOn('playing', run1), { kind: 'die', score: 400 });

  it('offers Continue and Title', () => {
    expect(over).toEqual(rankOn('gameOver', run1));
    for (const kind of ['next', 'map'] as const) expect(transition(over, { kind })).toBe(over);
  });

  it('Continue replays the same galaxy with 3 fresh lives, the score reset and the run marked', () => {
    const continued = { ...run1, score: 0, lives: 3, continued: true };
    for (const kind of ['continue', 'confirm', 'retry'] as const) {
      expect(transition(over, { kind })).toEqual(rankOn('playing', continued, { runs: 2 }));
    }
  });

  it('Title and Back end the run', () => {
    for (const kind of ['title', 'back'] as const) expect(transition(over, { kind })).toMatchObject({ screen: 'title', rankRun: null });
  });
});

describe('transition: ignored actions', () => {
  it.each<[FlowState, FlowAction]>([
    [INITIAL_FLOW, { kind: 'next' }],
    [INITIAL_FLOW, { kind: 'chooseFree' }],
    [at('modeSelect'), { kind: 'playGalaxy', id: '1-1' }],
    [at('map', { mode: 'free' }), { kind: 'playGalaxy', id: '1-1' }],
    [at('galaxySelect', { mode: 'free' }), { kind: 'openDimension', dimension: 2 }],
    [freeOn('playing', '1-1'), { kind: 'start' }],
    [freeOn('playing', '1-1'), { kind: 'resume' }],
    [freeOn('playing', '1-1'), { kind: 'quit' }],
    [freeOn('paused', '1-1'), { kind: 'pause' }],
    [freeOn('paused', '1-1'), { kind: 'die', score: 0 }],
    [freeOn('gameOver', '1-1'), { kind: 'clear', report: REPORT, livesLeft: 1 }],
    [freeOn('results', '1-1'), { kind: 'pause' }],
  ])('%j ignores %j', (state, action) => {
    expect(transition(state, action)).toBe(state);
  });

  it('a clear can still land while paused, when a quit finishes a warp-out', () => {
    expect(transition(freeOn('paused', '1-1'), { kind: 'clear', report: REPORT, livesLeft: 3 })).toMatchObject({ screen: 'results' });
  });
});

describe('saveChange', () => {
  it('records a Free play clear and leaves the Rank run alone', () => {
    const save = { ...defaultSave(), rankRun: RUN, rankSeq: 4 };
    const after = saved(save, freeOn('playing', '1-1'), { kind: 'clear', report: REPORT, livesLeft: 3 }).save;
    expect(after).toMatchObject({ frontier: '1-2', galaxies: { '1-1': { bestScore: 1200, stars: 3 } }, rankRun: RUN, rankSeq: 4, rankBoard: [] });
  });

  it('writes nothing for a Free play game over, navigation or a resume', () => {
    const cases: [FlowState, FlowAction][] = [
      [freeOn('playing', '1-1'), { kind: 'die', score: 50 }],
      [INITIAL_FLOW, { kind: 'start' }],
      [INITIAL_FLOW, { kind: 'resumeRank', run: RUN }],
      [at('galaxySelect', { mode: 'free' }), { kind: 'playGalaxy', id: '1-1' }],
    ];
    for (const [state, action] of cases) expect(saveChange(state, action, transition(state, action), TODAY)).toBeNull();
  });

  it('a new Rank run is saved through setRankRun, replacing any saved one', () => {
    const save = { ...defaultSave(), rankRun: { ...RUN, next: '2-2' as const }, rankSeq: 7 };
    expect(saved(save, at('modeSelect'), { kind: 'startRank', run: RUN }).save).toMatchObject({ rankRun: RUN, rankSeq: 8 });
  });

  it('suspend and resume: a Rank clear saves the run at its next galaxy, and Resume picks it up with the same score and lives', () => {
    let save: SaveData = saved(defaultSave(), at('modeSelect'), { kind: 'startRank', run: RUN }).save;
    const cleared = saved(save, rankOn('playing', RUN), { kind: 'clear', report: REPORT, livesLeft: 2 });
    save = cleared.save;
    expect(save).toMatchObject({ frontier: '1-2', rankRun: { next: '1-2', score: 1200, lives: 2 }, rankSeq: 2 });
    // The player leaves from results (suspend): nothing more is written, and the title offers the saved run.
    const left = saved(save, cleared.state, { kind: 'title' });
    expect(left.save).toBe(save);
    const savedRun = left.save.rankRun;
    if (savedRun === null) throw new Error('the suspended run must be in the save');
    expect(transition(left.state, { kind: 'resumeRank', run: savedRun })).toEqual(rankOn('playing', savedRun, { runs: 2 }));
  });

  it('a Rank game over writes a board entry with the run score and ends the saved run', () => {
    const run1 = { ...RUN, next: '3-4' as const, score: 5000, lives: 1 };
    const save = { ...defaultSave(), rankRun: run1, rankSeq: 3 };
    const after = saved(save, rankOn('playing', run1), { kind: 'die', score: 640 }).save;
    expect(after).toMatchObject({ rankRun: null, rankSeq: 4, rankBoard: [{ score: 5640, reached: 'D3 · G4', date: TODAY, continued: false }] });
  });

  it('Continue: the continued run is saved with the score reset and marked, and its later game over is marked too', () => {
    const run1 = { ...RUN, next: '1-3' as const, score: 2500, lives: 1 };
    let step = saved({ ...defaultSave(), rankRun: run1, rankSeq: 1 }, rankOn('playing', run1), { kind: 'die', score: 100 });
    step = saved(step.save, step.state, { kind: 'continue' });
    expect(step.save).toMatchObject({ rankRun: { next: '1-3', score: 0, lives: 3, continued: true }, rankSeq: 3 });
    expect(step.save.rankBoard).toEqual([{ score: 2600, reached: 'D1 · G3', date: TODAY, continued: false }]);
    step = saved(step.save, step.state, { kind: 'die', score: 300 });
    expect(step.save.rankBoard).toEqual([
      { score: 2600, reached: 'D1 · G3', date: TODAY, continued: false },
      { score: 300, reached: 'D1 · G3', date: TODAY, continued: true },
    ]);
  });

  it('completing 5-★ records the clear, posts the final score and ends the run', () => {
    const last = { ...RUN, next: '5-6' as const, score: 90000, lives: 1 };
    const after = saved({ ...defaultSave(), frontier: '5-6', rankRun: last, rankSeq: 9 }, rankOn('playing', last), { kind: 'clear', report: REPORT, livesLeft: 1 }).save;
    expect(after).toMatchObject({ rankRun: null, rankSeq: 10, galaxies: { '5-6': { bestScore: 1200, stars: 3 } } });
    expect(after.rankBoard).toEqual([{ score: 91200, reached: 'D5 · ★', date: TODAY, continued: false }]);
  });
});

describe('localDate', () => {
  it('formats the local calendar date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
