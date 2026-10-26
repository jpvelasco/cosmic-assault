import { describe, expect, it } from 'vitest';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { dimensionStars, isUnlocked, recordClear, setRankRun } from '../../src/meta/progress';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, MAX_RANK_SEQ, type SaveData } from '../../src/meta/save';

const withFrontier = (frontier: GalaxyId): SaveData => ({ ...defaultSave(), frontier });

describe('recordClear', () => {
  it('records the score and stars of a first clear and opens the next galaxy', () => {
    const next = recordClear(defaultSave(), galaxyById('1-1'), 800, 2);
    expect(next.galaxies).toEqual({ '1-1': { bestScore: 800, stars: 2 } });
    expect(next.frontier).toBe('1-2');
  });

  it('keeps the best score and the best stars separately', () => {
    const first = recordClear(defaultSave(), galaxyById('1-1'), 800, 3);
    const worse = recordClear(first, galaxyById('1-1'), 500, 1);
    expect(worse.galaxies['1-1']).toEqual({ bestScore: 800, stars: 3 });
    const mixed = recordClear(recordClear(defaultSave(), galaxyById('1-1'), 900, 1), galaxyById('1-1'), 400, 3);
    expect(mixed.galaxies['1-1']).toEqual({ bestScore: 900, stars: 3 });
  });

  it('never pulls the frontier back when replaying an earlier galaxy', () => {
    const replay = recordClear(withFrontier('3-2'), galaxyById('1-1'), 10, 1);
    expect(replay.frontier).toBe('3-2');
  });

  it('clearing the frontier galaxy advances it by exactly one', () => {
    expect(recordClear(withFrontier('2-4'), galaxyById('2-4'), 1, 1).frontier).toBe('2-5');
  });

  it('a boss clear opens the first galaxy of the next Dimension', () => {
    expect(recordClear(withFrontier('1-6'), galaxyById('1-6'), 5000, 3).frontier).toBe('2-1');
    expect(recordClear(withFrontier('4-6'), galaxyById('4-6'), 5000, 3).frontier).toBe('5-1');
  });

  it('the last boss leaves the frontier at 5-★', () => {
    expect(recordClear(withFrontier('5-6'), galaxyById('5-6'), 5000, 3).frontier).toBe('5-6');
  });

  it('leaves the rest of the save, and the save it was given, alone', () => {
    const save: SaveData = { ...defaultSave(), classicBest: 12, classicImported: true, rankBoard: [{ score: 1, reached: 'D1 · G1', date: '2026-10-26', continued: false }] };
    const before = JSON.stringify(save);
    const next = recordClear(save, galaxyById('1-1'), 5, 1);
    expect(JSON.stringify(save)).toBe(before);
    expect(next).toMatchObject({ classicBest: 12, classicImported: true, rankBoard: save.rankBoard, rankRun: null, version: 1 });
  });
});

describe('isUnlocked', () => {
  it('opens everything up to and including the frontier, and nothing past it', () => {
    const save = withFrontier('2-3');
    expect(isUnlocked(save, '1-1')).toBe(true);
    expect(isUnlocked(save, '1-6')).toBe(true);
    expect(isUnlocked(save, '2-3')).toBe(true);
    expect(isUnlocked(save, '2-4')).toBe(false);
    expect(isUnlocked(save, '5-6')).toBe(false);
  });

  it('a new save has only 1-1', () => {
    expect(GALAXIES.filter((g) => isUnlocked(defaultSave(), g.id)).map((g) => g.id)).toEqual(['1-1']);
  });

  it('the last frontier opens all 30', () => {
    expect(GALAXIES.every((g) => isUnlocked(withFrontier('5-6'), g.id))).toBe(true);
  });
});

describe('dimensionStars', () => {
  it('sums only that Dimension, out of 18', () => {
    const save: SaveData = {
      ...defaultSave(),
      galaxies: {
        '1-1': { bestScore: 1, stars: 3 },
        '1-6': { bestScore: 1, stars: 2 },
        '2-1': { bestScore: 1, stars: 1 },
        '5-6': { bestScore: 1, stars: 3 },
      },
    };
    expect(dimensionStars(save, 1)).toBe(5);
    expect(dimensionStars(save, 2)).toBe(1);
    expect(dimensionStars(save, 3)).toBe(0);
    expect(dimensionStars(save, 5)).toBe(3);
  });

  it('reaches 18 with every galaxy at 3 stars', () => {
    const galaxies = Object.fromEntries(GALAXIES.map((g) => [g.id, { bestScore: 1, stars: 3 }]));
    expect(dimensionStars({ ...defaultSave(), galaxies }, 4)).toBe(18);
  });
});

describe('setRankRun', () => {
  const run = startRank('2026-10-26');

  it('sets the run and bumps rankSeq by one, whatever the change', () => {
    const started = setRankRun(defaultSave(), run);
    expect(started).toMatchObject({ rankRun: run, rankSeq: 1 });
    const continued = setRankRun(started, { ...run, continued: true });
    expect(continued).toMatchObject({ rankRun: { continued: true }, rankSeq: 2 });
    expect(setRankRun(continued, null)).toMatchObject({ rankRun: null, rankSeq: 3 });
  });

  it('stops counting at 2^31: the count stays at the cap and merges fall back to the runs themselves', () => {
    expect(setRankRun({ ...defaultSave(), rankSeq: MAX_RANK_SEQ - 1 }, run).rankSeq).toBe(MAX_RANK_SEQ);
    expect(setRankRun({ ...defaultSave(), rankSeq: MAX_RANK_SEQ }, null)).toMatchObject({ rankRun: null, rankSeq: MAX_RANK_SEQ });
  });

  it('leaves the rest of the save, and the save it was given, alone', () => {
    const save = recordClear(defaultSave(), galaxyById('1-1'), 5, 1);
    const before = JSON.stringify(save);
    const next = setRankRun(save, run);
    expect(JSON.stringify(save)).toBe(before);
    expect({ ...next, rankRun: null, rankSeq: 0 }).toEqual(save);
  });
});
