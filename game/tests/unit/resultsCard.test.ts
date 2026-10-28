import { describe, expect, it } from 'vitest';
import { newBestText } from '../../src/ui/resultsCard';

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
