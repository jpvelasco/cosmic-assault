import { describe, expect, it } from 'vitest';
import { INITIAL_FLOW, type ClearResult, type FlowState } from '../../src/app/flow';
import { startRank } from '../../src/meta/rankRun';
import { clearReport } from '../../src/sim/scoring';
import { endButtons, endHeading, endLabel, newBestText, newLookLabel, showsStars } from '../../src/ui/resultsCard';

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
    expect(endButtons(daily('results'))).toEqual(['results-retry', 'rank-title']);
    expect(endButtons(daily('gameOver'))).toEqual(['results-retry', 'rank-title']);
  });

  it('keeps the Free play and Rank buttons as they were', () => {
    expect(endButtons(free('results'))).toEqual(['results-next', 'results-retry', 'results-map']);
    expect(endButtons(free('gameOver'))).toEqual(['results-retry', 'results-map']);
    expect(endButtons(rank('results'))).toEqual(['results-next', 'rank-title']);
    expect(endButtons(rank('gameOver'))).toEqual(['rank-continue', 'rank-title']);
    expect(endButtons({ ...rank('rankComplete'), rankRun: null })).toEqual(['rank-title']);
  });

  it('shows stars for a galaxy clear and never for the Daily, which shows its target instead', () => {
    expect(showsStars(free('results'))).toBe(true);
    expect(showsStars(rank('rankComplete'))).toBe(true);
    expect(showsStars(free('gameOver'))).toBe(false);
    expect(showsStars(daily('results'))).toBe(false);
  });
});
