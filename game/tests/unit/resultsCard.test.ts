import { describe, expect, it } from 'vitest';
import type { ClearResult } from '../../src/app/flow';
import { clearReport } from '../../src/sim/scoring';
import { newBestText, newLookLabel } from '../../src/ui/resultsCard';

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
