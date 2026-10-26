import { describe, expect, it } from 'vitest';
import type { ClearResult } from '../../src/app/flow';
import { clearReport } from '../../src/sim/scoring';
import { newBestLabel } from '../../src/ui/resultsCard';

/** A Dimension 2 clear of 1000 kill points with no deaths: Free play's score is the best, Rank's is multiplied. */
const KILLS = 1000;
const clear = (mode: 'free' | 'rank', newBest: boolean): ClearResult => {
  const report = clearReport({ score: KILLS, deaths: 0, dimension: 2, mode });
  return { report, total: report.score, newBest };
};
const freeBest = clear('free', true).report.score;

describe('newBestLabel', () => {
  it('is empty when the clear set no best, or there is no clear', () => {
    expect(newBestLabel({ galaxy: '2-1', mode: 'free', result: clear('free', false) })).toBe('');
    expect(newBestLabel({ galaxy: '2-1', mode: 'rank', result: clear('rank', false) })).toBe('');
    expect(newBestLabel({ galaxy: '2-1', mode: 'rank', result: null })).toBe('');
  });

  it('is the plain badge in Free play, where the card shows the recorded number', () => {
    expect(newBestLabel({ galaxy: '2-1', mode: 'free', result: clear('free', true) })).toBe('New best!');
  });

  it('names the recorded best in Rank, not the multiplied score beside it', () => {
    const result = clear('rank', true);
    expect(result.report.score).toBeGreaterThan(freeBest);
    expect(newBestLabel({ galaxy: '2-1', mode: 'rank', result })).toBe(`New best! ${String(freeBest)}`);
  });
});
