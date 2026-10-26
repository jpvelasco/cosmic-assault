import { describe, expect, it } from 'vitest';
import { addEntry, RANK_BOARD_SIZE, reachedLabel, type RankEntry } from '../../src/meta/rankBoard';

const entry = (score: number, date = '2026-10-26', extra: Partial<RankEntry> = {}): RankEntry => ({ score, reached: 'D1 · G1', date, continued: false, ...extra });

describe('reachedLabel', () => {
  it('shows the Dimension and galaxy with a middle dot, and a star for a boss galaxy', () => {
    expect(reachedLabel('3-4')).toBe('D3 · G4');
    expect(reachedLabel('1-1')).toBe('D1 · G1');
    expect(reachedLabel('5-6')).toBe('D5 · ★');
    expect(reachedLabel('2-6')).toBe('D2 · ★');
  });
});

describe('addEntry', () => {
  it('sorts by score, highest first', () => {
    const board = [entry(10), entry(30)].reduce<readonly RankEntry[]>(addEntry, []);
    expect(board.map((e) => e.score)).toEqual([30, 10]);
    expect(addEntry(board, entry(20)).map((e) => e.score)).toEqual([30, 20, 10]);
  });

  it('keeps only the top ten, and a score that does not make it changes nothing', () => {
    const full = Array.from({ length: RANK_BOARD_SIZE }, (_, i) => entry(100 - i)).reduce<readonly RankEntry[]>(addEntry, []);
    expect(RANK_BOARD_SIZE).toBe(10);
    expect(full).toHaveLength(10);
    expect(addEntry(full, entry(50))).toEqual(full);
    const better = addEntry(full, entry(95));
    expect(better).toHaveLength(10);
    expect(better.map((e) => e.score)).toEqual([100, 99, 98, 97, 96, 95, 95, 94, 93, 92]);
  });

  it('on a tie the earlier date ranks higher, whichever order they arrive in', () => {
    const early = entry(500, '2026-01-02');
    const late = entry(500, '2026-03-04');
    expect(addEntry([late], early)).toEqual([early, late]);
    expect(addEntry([early], late)).toEqual([early, late]);
  });

  it('on a tie in score and date, the earlier-recorded entry stays first', () => {
    const first = entry(500, '2026-01-02', { reached: 'D2 · G1' });
    const second = entry(500, '2026-01-02', { reached: 'D3 · G1' });
    expect(addEntry([first], second)).toEqual([first, second]);
  });

  it('does not mutate the board it is given', () => {
    const board = [entry(10)];
    addEntry(board, entry(20));
    expect(board).toEqual([entry(10)]);
  });

  it('keeps the Continue mark', () => {
    expect(addEntry([], entry(5, '2026-10-26', { continued: true }))[0]?.continued).toBe(true);
  });
});
