import { describe, expect, it } from 'vitest';
import { localDate } from '../../src/app/date';
import { applySaveChange, freeNext, INITIAL_FLOW, saveChange, transition, type FlowAction, type FlowState, type SaveChange } from '../../src/app/flow';
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
/** The screens a Rank run is in its galaxy on: the flow's run is marked so. */
const IN_GALAXY: readonly FlowState['screen'][] = ['playing', 'paused', 'gameOver'];
const rankOn = (screen: FlowState['screen'], run: RankRun, extra: Partial<FlowState> = {}): FlowState =>
  at(screen, { mode: 'rank', galaxy: run.next, rankRun: IN_GALAXY.includes(screen) ? { ...run, inGalaxy: true } : run, runs: 1, ...extra });

/** Applies `actions` in order, as the app would. */
const run = (state: FlowState, ...actions: FlowAction[]): FlowState => actions.reduce(transition, state);

/** The save after `action` from `state`, written as the app writes it, by a tab that is up to date. */
function saved(save: SaveData, state: FlowState, action: FlowAction): { state: FlowState; save: SaveData } {
  const next = transition(state, action);
  const change = saveChange(state, action, next, () => TODAY);
  return { state: next, save: change === null ? save : applySaveChange(save, change, save.rankSeq).save };
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

  it('Rank on mode select starts the run at its next galaxy, marked as in it', () => {
    expect(transition(at('modeSelect'), { kind: 'startRank', run: RUN })).toEqual(rankOn('playing', RUN));
    expect(transition(at('modeSelect'), { kind: 'startRank', run: RUN }).rankRun?.inGalaxy).toBe(true);
  });

  it('with a run saved, Rank asks first: the confirm card starts the new run, or Back returns to mode select', () => {
    const asking = transition(at('modeSelect'), { kind: 'askNewRank' });
    expect(asking).toEqual(at('confirmNewRank'));
    expect(transition(asking, { kind: 'startRank', run: RUN })).toEqual(rankOn('playing', RUN));
    expect(transition(asking, { kind: 'back' })).toEqual(at('modeSelect'));
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

  it('Resume Rank on mode select resumes the saved run too', () => {
    const suspended: RankRun = { ...RUN, next: '2-2', score: 5100, lives: 3 };
    expect(transition(at('modeSelect'), { kind: 'resumeRank', run: suspended })).toEqual(rankOn('playing', suspended));
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

  it('Quit leaves for the title, writing nothing in Free play', () => {
    const paused = freeOn('paused', '1-2');
    const quit = transition(paused, { kind: 'quit', livesLeft: 3 });
    expect(quit).toMatchObject({ screen: 'title', rankRun: null });
    expect(saveChange(paused, { kind: 'quit', livesLeft: 3 }, quit, () => TODAY)).toBeNull();
  });
});

describe('transition: Free play results and game over', () => {
  const cleared = transition(freeOn('playing', '1-3'), { kind: 'clear', report: REPORT, livesLeft: 3, bestBefore: null });

  it('a clear shows the results with its report', () => {
    expect(cleared).toEqual(freeOn('results', '1-3', { result: { report: REPORT, total: REPORT.score, newBest: false } }));
  });

  it('marks the clear a new best only when it beats a best stored before it; a first clear is none', () => {
    const clear = (bestBefore: number | null) => transition(freeOn('playing', '1-3'), { kind: 'clear', report: REPORT, livesLeft: 3, bestBefore }).result?.newBest;
    expect(clear(null)).toBe(false);
    expect(clear(0)).toBe(true);
    expect(clear(REPORT.score - 1)).toBe(true);
    expect(clear(REPORT.score)).toBe(false);
    expect(clear(REPORT.score + 500)).toBe(false);
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
    const boss = transition(freeOn('playing', '2-6'), { kind: 'clear', report: REPORT, livesLeft: 1, bestBefore: null });
    expect(transition(boss, { kind: 'next' })).toMatchObject({ galaxy: '3-1', dimension: 3 });
  });

  it('after the last galaxy there is no Next, and Enter, the first button left, retries', () => {
    const last = transition(freeOn('playing', '5-6'), { kind: 'clear', report: REPORT, livesLeft: 1, bestBefore: null });
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
  const cleared = transition(playing, { kind: 'clear', report: REPORT, livesLeft: 2, bestBefore: null });

  it('a clear carries the score and lives into the next galaxy', () => {
    expect(cleared).toEqual(rankOn('results', { ...RUN, next: '1-2', score: 2200, lives: 2 }, { galaxy: '1-1', result: { report: REPORT, total: 2200, newBest: false } }));
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
    const done = transition(last, { kind: 'clear', report: REPORT, livesLeft: 1, bestBefore: null });
    expect(done).toMatchObject({ screen: 'rankComplete', galaxy: '5-6', rankRun: null, result: { report: REPORT, total: 91200, newBest: false } });
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
    [freeOn('playing', '1-1'), { kind: 'quit', livesLeft: 3 }],
    [freeOn('playing', '1-1'), { kind: 'hit', livesLeft: 2 }],
    [rankOn('paused', RUN), { kind: 'hit', livesLeft: 2 }],
    [rankOn('playing', RUN), { kind: 'hit', livesLeft: 0 }],
    [freeOn('paused', '1-1'), { kind: 'pause' }],
    [freeOn('paused', '1-1'), { kind: 'die', score: 0 }],
    [freeOn('paused', '1-1'), { kind: 'clear', report: REPORT, livesLeft: 3, bestBefore: null }],
    [at('confirmNewRank'), { kind: 'chooseFree' }],
    [at('map', { mode: 'free' }), { kind: 'askNewRank' }],
    [freeOn('gameOver', '1-1'), { kind: 'clear', report: REPORT, livesLeft: 1, bestBefore: null }],
    [freeOn('results', '1-1'), { kind: 'pause' }],
  ])('%j ignores %j', (state, action) => {
    expect(transition(state, action)).toBe(state);
  });

});

describe('saveChange', () => {
  const rankPart = (change: SaveChange | null): SaveChange['rank'] => change?.rank ?? null;

  it('records a Free play clear as progress only, leaving the Rank run alone', () => {
    const save = { ...defaultSave(), rankRun: RUN, rankSeq: 4 };
    const playing = freeOn('playing', '1-1');
    const action: FlowAction = { kind: 'clear', report: REPORT, livesLeft: 3, bestBefore: null };
    expect(rankPart(saveChange(playing, action, transition(playing, action), () => TODAY))).toBeNull();
    const after = saved(save, playing, action).save;
    expect(after).toMatchObject({ frontier: '1-2', galaxies: { '1-1': { bestScore: 1200, stars: 3 } }, rankRun: RUN, rankSeq: 4, rankBoard: [] });
  });

  it('writes nothing for a Free play game over or quit, or for navigation', () => {
    const cases: [FlowState, FlowAction][] = [
      [freeOn('playing', '1-1'), { kind: 'die', score: 50 }],
      [freeOn('paused', '1-1'), { kind: 'quit', livesLeft: 3 }],
      [INITIAL_FLOW, { kind: 'start' }],
      [at('modeSelect'), { kind: 'askNewRank' }],
      [at('galaxySelect', { mode: 'free' }), { kind: 'playGalaxy', id: '1-1' }],
    ];
    for (const [state, action] of cases) expect(saveChange(state, action, transition(state, action), () => TODAY)).toBeNull();
  });

  it('a new Rank run is saved through setRankRun, marked as in its galaxy', () => {
    expect(saved(defaultSave(), at('modeSelect'), { kind: 'startRank', run: RUN }).save).toMatchObject({ rankRun: { ...RUN, inGalaxy: true }, rankSeq: 1 });
  });

  it('a new Rank run over a saved one posts the abandoned run, as it stood, before replacing it', () => {
    const old = { ...RUN, next: '2-2' as const, score: 4100, continued: true };
    const after = saved({ ...defaultSave(), rankRun: old, rankSeq: 7 }, at('confirmNewRank'), { kind: 'startRank', run: RUN }).save;
    expect(after).toMatchObject({ rankRun: { ...RUN, inGalaxy: true }, rankSeq: 8 });
    expect(after.rankBoard).toEqual([{ score: 4100, reached: 'D2 · G2', date: TODAY, continued: true }]);
  });

  it('suspend and resume: a clear saves the run between galaxies at the next one, and Resume marks it in that galaxy', () => {
    let save: SaveData = saved(defaultSave(), at('modeSelect'), { kind: 'startRank', run: RUN }).save;
    const cleared = saved(save, rankOn('playing', RUN), { kind: 'clear', report: REPORT, livesLeft: 2, bestBefore: null });
    save = cleared.save;
    expect(save).toMatchObject({ frontier: '1-2', rankRun: { next: '1-2', score: 1200, lives: 2, inGalaxy: false }, rankSeq: 2 });
    // The player leaves from results (suspend): nothing more is written, and the title offers the saved run.
    const left = saved(save, cleared.state, { kind: 'title' });
    expect(left.save).toBe(save);
    const savedRun = left.save.rankRun;
    if (savedRun === null) throw new Error('the suspended run must be in the save');
    const resumed = saved(left.save, left.state, { kind: 'resumeRank', run: savedRun });
    expect(resumed.state).toEqual(rankOn('playing', savedRun, { runs: 2 }));
    expect(resumed.save).toMatchObject({ rankRun: { ...savedRun, inGalaxy: true }, rankSeq: 3 });
  });

  it('Quit mid-galaxy in Rank forfeits it: one life gone, back at the score it carried in', () => {
    const playing = { ...RUN, next: '1-3' as const, score: 2500, lives: 2 };
    const after = saved({ ...defaultSave(), rankRun: { ...playing, inGalaxy: true }, rankSeq: 5 }, rankOn('paused', playing), { kind: 'quit', livesLeft: 2 });
    expect(after.state).toMatchObject({ screen: 'title', rankRun: null });
    expect(after.save).toMatchObject({ rankRun: { ...playing, lives: 1, inGalaxy: false }, rankSeq: 6, rankBoard: [] });
  });

  it('a Rank clear records the galaxy best without the Dimension multiplier, as Free play scores it', () => {
    // 2-3 in Rank: kills 1000, bonus 500 + 1000, times 1.1.
    const report: ClearReport = { score: Math.round((1000 + 1500) * 1.1), bonus: 1500, deaths: 0, stars: 3 };
    const playing = { ...RUN, next: '2-3' as const };
    const action: FlowAction = { kind: 'clear', report, livesLeft: 3, bestBefore: 2400 };
    const after = saved(defaultSave(), rankOn('playing', playing), action);
    expect(after.save.galaxies['2-3']).toEqual({ bestScore: 2500, stars: 3 });
    // 2500 beats the 2400 saved; the multiplied 2750 is the run's, not the galaxy's.
    expect(after.state.result?.newBest).toBe(true);
    expect(transition(rankOn('playing', playing), { ...action, bestBefore: 2500 }).result?.newBest).toBe(false);
  });

  it('a hit in a Rank galaxy saves the lives left, still in the galaxy, so a closed tab forfeits from them', () => {
    const playing = { ...RUN, next: '1-3' as const, score: 2500, lives: 3 };
    const after = saved({ ...defaultSave(), rankRun: { ...playing, inGalaxy: true }, rankSeq: 5 }, rankOn('playing', playing), { kind: 'hit', livesLeft: 2 });
    expect(after.state).toEqual(rankOn('playing', { ...playing, lives: 2 }));
    expect(after.save).toMatchObject({ rankRun: { ...playing, lives: 2, inGalaxy: true }, rankSeq: 6 });
  });

  it('Quit after two deaths forfeits from the lives left: three lives down from the galaxy start, never a refund', () => {
    const playing = { ...RUN, next: '1-3' as const, score: 2500, lives: 5 };
    let step = saved({ ...defaultSave(), rankRun: { ...playing, inGalaxy: true }, rankSeq: 1 }, rankOn('playing', playing), { kind: 'hit', livesLeft: 4 });
    step = saved(step.save, step.state, { kind: 'hit', livesLeft: 3 });
    step = saved(step.save, step.state, { kind: 'pause' });
    step = saved(step.save, step.state, { kind: 'quit', livesLeft: 3 });
    expect(step.save.rankRun).toMatchObject({ lives: 2, score: 2500, inGalaxy: false });
  });

  it('Quit forfeits from the ship lives even when no hit was reported, and from the run lives when it has more', () => {
    const playing = { ...RUN, next: '1-3' as const, lives: 3 };
    expect(saved(defaultSave(), rankOn('paused', playing), { kind: 'quit', livesLeft: 2 }).save.rankRun).toMatchObject({ lives: 1 });
    expect(saved(defaultSave(), rankOn('paused', playing), { kind: 'quit', livesLeft: 5 }).save.rankRun).toMatchObject({ lives: 2 });
  });

  it('Quit on the last life loses the run: its entry posted and Continue left for the title', () => {
    const playing = { ...RUN, next: '1-3' as const, score: 2500, lives: 1 };
    const after = saved(defaultSave(), rankOn('paused', playing), { kind: 'quit', livesLeft: 1 }).save;
    expect(after.rankRun).toMatchObject({ lives: 0, score: 2500, inGalaxy: false });
    expect(after.rankBoard).toEqual([{ score: 2500, reached: 'D1 · G3', date: TODAY, continued: false }]);
  });

  it('a Rank game over posts the run total and keeps the run, with no lives, for a Continue', () => {
    const run1 = { ...RUN, next: '3-4' as const, score: 5000, lives: 1 };
    const save = { ...defaultSave(), rankRun: { ...run1, inGalaxy: true }, rankSeq: 3 };
    const after = saved(save, rankOn('playing', run1), { kind: 'die', score: 640 });
    expect(after.save).toMatchObject({ rankRun: { ...run1, lives: 0, inGalaxy: false }, rankSeq: 4 });
    expect(after.save.rankBoard).toEqual([{ score: 5640, reached: 'D3 · G4', date: TODAY, continued: false }]);
    // Title from the card writes nothing more: the title offers the Continue.
    expect(saved(after.save, after.state, { kind: 'title' }).save).toBe(after.save);
  });

  it('Continue: the continued run is saved with the score reset and marked, and its later game over is marked too', () => {
    const run1 = { ...RUN, next: '1-3' as const, score: 2500, lives: 1 };
    let step = saved({ ...defaultSave(), rankRun: run1, rankSeq: 1 }, rankOn('playing', run1), { kind: 'die', score: 100 });
    step = saved(step.save, step.state, { kind: 'continue' });
    expect(step.save).toMatchObject({ rankRun: { next: '1-3', score: 0, lives: 3, continued: true, inGalaxy: true }, rankSeq: 3 });
    expect(step.save.rankBoard).toEqual([{ score: 2600, reached: 'D1 · G3', date: TODAY, continued: false }]);
    step = saved(step.save, step.state, { kind: 'die', score: 300 });
    expect(step.save.rankBoard).toEqual([
      { score: 2600, reached: 'D1 · G3', date: TODAY, continued: false },
      { score: 300, reached: 'D1 · G3', date: TODAY, continued: true },
    ]);
  });

  it('completing 5-★ records the clear, posts the final score and ends the run', () => {
    const last = { ...RUN, next: '5-6' as const, score: 90000, lives: 1 };
    const after = saved({ ...defaultSave(), frontier: '5-6', rankRun: last, rankSeq: 9 }, rankOn('playing', last), { kind: 'clear', report: REPORT, livesLeft: 1, bestBefore: null }).save;
    // The galaxy keeps its best without D5's ×1.4: 1200 / 1.4, rounded.
    expect(after).toMatchObject({ rankRun: null, rankSeq: 10, galaxies: { '5-6': { bestScore: 857, stars: 3 } } });
    expect(after.rankBoard).toEqual([{ score: 91200, reached: 'D5 · ★', date: TODAY, continued: false }]);
  });
});

describe('applySaveChange (the stale-tab guard)', () => {
  const run1 = { ...RUN, next: '1-2' as const, score: 900, lives: 2 };
  const playing = rankOn('playing', run1);
  const clear: FlowAction = { kind: 'clear', report: REPORT, livesLeft: 2, bestBefore: null };
  const change = saveChange(playing, clear, transition(playing, clear), () => TODAY);
  if (change === null) throw new Error('a Rank clear must write');

  it('applies the whole change for a tab that saw the run at the stored rankSeq', () => {
    const save = { ...defaultSave(), rankRun: run1, rankSeq: 4 };
    expect(applySaveChange(save, change, 4)).toMatchObject({ stale: false, save: { frontier: '1-3', rankRun: { next: '1-3' }, rankSeq: 5 } });
  });

  it('drops the Rank part, but keeps the clear, once another tab has moved the run on', () => {
    // Another tab ended the run since this tab last saw it at rankSeq 4.
    const save = { ...defaultSave(), rankRun: null, rankSeq: 5 };
    const { save: after, stale } = applySaveChange(save, change, 4);
    expect(stale).toBe(true);
    expect(after).toMatchObject({ frontier: '1-3', rankRun: null, rankSeq: 5, rankBoard: [] });
  });

  it('never blocks a change with no Rank part', () => {
    const free = saveChange(freeOn('playing', '1-1'), clear, transition(freeOn('playing', '1-1'), clear), () => TODAY);
    if (free === null) throw new Error('a Free clear must write');
    expect(applySaveChange({ ...defaultSave(), rankSeq: 9 }, free, 0).stale).toBe(false);
  });
});

describe('localDate', () => {
  it('formats the local calendar date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
