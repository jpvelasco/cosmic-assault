import { describe, expect, it } from 'vitest';
import { INITIAL_FLOW, type ClearResult, type FlowState } from '../../src/app/flow';
import { startRank } from '../../src/meta/rankRun';
import { clearReport } from '../../src/sim/scoring';
import { backTarget } from '../../src/app/flow';
import { endButtons, endHeading, endKeys, endLabel, newBestText, newLookLabel, showsStars, suspends } from '../../src/ui/resultsCard';

const report = clearReport({ score: 1000, deaths: 0, dimension: 2, mode: 'free' });
const CLEAR: ClearResult = { report, total: report.score };

describe('newBestText', () => {
  it('is empty when the run beat no record', () => {
    expect(newBestText(null, 2750)).toBe('');
  });

  it('is the plain badge when the recorded number is the score the card shows', () => {
    expect(newBestText({ kind: 'galaxy', score: 1200 }, 1200)).toBe('New best!');
    expect(newBestText({ kind: 'rankRun', score: 5100 }, 5100)).toBe('New best!');
  });

  it('names the recorded number when it differs from the shown score, as Rank does for a galaxy', () => {
    expect(newBestText({ kind: 'galaxy', score: 2500 }, 2750)).toBe('New best! 2500');
  });
});

describe('newLookLabel', () => {
  it('is empty when the clear unlocked no look', () => {
    expect(newLookLabel({ ...CLEAR, newLooks: [] })).toBe('');
    expect(newLookLabel(CLEAR)).toBe('');
  });

  it('names the looks the clear unlocked, in the order they were won', () => {
    expect(newLookLabel({ ...CLEAR, newLooks: ['Ember trim'] })).toBe('New look unlocked: Ember trim');
    expect(newLookLabel({ ...CLEAR, newLooks: ['Ember trim', 'Comet trail'] })).toBe('New look unlocked: Ember trim, Comet trail');
  });
});

describe('the end card for each mode', () => {
  const end = (screen: FlowState['screen'], extra: Partial<FlowState>): FlowState => ({ ...INITIAL_FLOW, screen, galaxy: '1-3', runs: 1, ...extra });
  const free = (screen: FlowState['screen']) => end(screen, { mode: 'free', result: screen === 'gameOver' ? null : CLEAR });
  const rank = (screen: FlowState['screen']) => end(screen, { mode: 'rank', rankRun: startRank('2026-10-26'), result: screen === 'gameOver' ? null : CLEAR });
  const daily = (screen: FlowState['screen']) => end(screen, { mode: 'daily', daily: '2026-10-26', result: screen === 'gameOver' ? null : CLEAR });

  it('heads a Daily clear "Daily cleared" under its date\'s title, and a galaxy run under its galaxy', () => {
    expect(endHeading(daily('results'))).toBe('Daily cleared');
    expect(endLabel(daily('results'))).toBe('Daily Galaxy · 2026-10-26');
    expect(endHeading(daily('gameOver'))).toBe('Game over');
    expect(endLabel(daily('gameOver'))).toBe('Daily Galaxy · 2026-10-26');
    expect(endHeading(free('results'))).toBe('Galaxy cleared');
    expect(endLabel(free('results'))).toBe('Galaxy 1-3');
    expect(endHeading(rank('rankComplete'))).toBe('Rank complete');
  });

  it('offers the Daily a Retry of the same date and the title, and no Next or Map', () => {
    expect(endButtons(daily('results'))).toEqual(['results-retry', 'daily-title']);
    expect(endButtons(daily('gameOver'))).toEqual(['results-retry', 'daily-title']);
  });

  it('keeps the Free play and Rank buttons as they were', () => {
    expect(endButtons(free('results'))).toEqual(['results-next', 'results-retry', 'results-map']);
    expect(endButtons(free('gameOver'))).toEqual(['results-retry', 'results-map']);
    expect(endButtons(rank('results'))).toEqual(['results-next', 'rank-title']);
    expect(endButtons(rank('gameOver'))).toEqual(['rank-continue', 'rank-title']);
    expect(endButtons({ ...rank('rankComplete'), rankRun: null })).toEqual(['rank-title']);
  });

  it('marks the button Esc takes, the one Enter takes, and a Retry after it with R', () => {
    const keys = (flow: FlowState) => Object.fromEntries(endKeys(flow));
    expect(keys(free('results'))).toEqual({ 'results-next': 'confirm', 'results-retry': 'retry', 'results-map': 'back' });
    expect(keys(free('gameOver'))).toEqual({ 'results-retry': 'confirm', 'results-map': 'back' });
    expect(keys(rank('results'))).toEqual({ 'results-next': 'confirm', 'rank-title': 'back' });
    expect(keys(rank('gameOver'))).toEqual({ 'rank-continue': 'confirm', 'rank-title': 'back' });
    // Rank complete's one button is where Enter and Esc both go; it wears Esc's mark.
    expect(keys({ ...rank('rankComplete'), rankRun: null })).toEqual({ 'rank-title': 'back' });
    expect(keys(daily('results'))).toEqual({ 'results-retry': 'confirm', 'daily-title': 'back' });
    expect(keys(daily('gameOver'))).toEqual({ 'results-retry': 'confirm', 'daily-title': 'back' });
  });

  it('marks as Back the button that leads where backTarget does, on every end card', () => {
    const targets: Record<string, string> = { 'results-map': 'map', 'rank-title': 'title', 'daily-title': 'title' };
    for (const flow of [free('results'), free('gameOver'), rank('results'), rank('gameOver'), daily('results'), daily('gameOver')]) {
      const back = [...endKeys(flow)].find(([, key]) => key === 'back')?.[0];
      expect(back === undefined ? undefined : targets[back], `${String(flow.mode)} ${flow.screen}`).toBe(backTarget(flow.screen, flow.mode));
    }
  });

  it('says a Rank run is suspended where Back leaves it saved, and nowhere else', () => {
    expect(suspends(rank('results'))).toBe(true);
    expect(suspends(rank('gameOver'))).toBe(true);
    expect(suspends({ ...rank('rankComplete'), rankRun: null })).toBe(false);
    expect(suspends(free('results'))).toBe(false);
    expect(suspends(daily('gameOver'))).toBe(false);
  });

  it('shows stars for a galaxy clear and never for the Daily, which shows its target instead', () => {
    expect(showsStars(free('results'))).toBe(true);
    expect(showsStars(rank('rankComplete'))).toBe(true);
    expect(showsStars(free('gameOver'))).toBe(false);
    expect(showsStars(daily('results'))).toBe(false);
  });
});
