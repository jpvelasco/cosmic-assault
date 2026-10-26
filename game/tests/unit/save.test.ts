import { describe, expect, it } from 'vitest';
import { defaultSave, mergeSaves, parseSave, SAVE_KEY, sanitizeSave, type SaveData } from '../../src/meta/save';
import type { RankEntry } from '../../src/meta/rankBoard';
import type { RankRun } from '../../src/meta/rankRun';

const RUN: RankRun = { next: '2-3', score: 1500, lives: 4, weaponTier: 1, continued: false, startedAt: '2026-10-26' };
const ENTRY: RankEntry = { score: 900, reached: 'D2 · G1', date: '2026-10-25', continued: true };
const GOOD: SaveData = {
  version: 1,
  frontier: '2-3',
  galaxies: { '1-1': { bestScore: 700, stars: 2 }, '2-2': { bestScore: 1200, stars: 3 } },
  rankRun: RUN,
  rankBoard: [ENTRY],
  classicBest: 4400,
  classicImported: true,
};

describe('defaults', () => {
  it('start at 1-1 with nothing cleared', () => {
    expect(SAVE_KEY).toBe('cosmic-assault.v2');
    expect(defaultSave()).toEqual({ version: 1, frontier: '1-1', galaxies: {}, rankRun: null, rankBoard: [], classicBest: null, classicImported: false });
  });

  it('are a fresh copy each time', () => {
    expect(defaultSave()).not.toBe(defaultSave());
    expect(defaultSave().galaxies).not.toBe(defaultSave().galaxies);
  });
});

describe('sanitizeSave', () => {
  it('keeps a fully valid save as it is', () => {
    expect(sanitizeSave(GOOD)).toEqual(GOOD);
  });

  it.each([null, undefined, 42, 'text', true, [], [GOOD], '{"frontier":"2-3"'])('gives the defaults for %j', (raw) => {
    expect(sanitizeSave(raw)).toEqual(defaultSave());
  });

  it('gives the defaults for an empty object', () => {
    expect(sanitizeSave({})).toEqual(defaultSave());
  });

  it('reads a save from a newer version field by field, and writes version 1', () => {
    expect(sanitizeSave({ ...GOOD, version: 2, extra: 'from the future' })).toEqual(GOOD);
    expect(sanitizeSave({ ...GOOD, version: 'x', frontier: 'banana' })).toEqual({ ...GOOD, frontier: '1-1' });
  });

  describe('frontier', () => {
    it.each(['6-1', '1-7', '0-1', '1-0', 'banana', '', 3, null, {}, '1-1 '])('falls back to 1-1 for %j', (frontier) => {
      expect(sanitizeSave({ ...GOOD, frontier }).frontier).toBe('1-1');
    });

    it('keeps the edges of the table', () => {
      expect(sanitizeSave({ frontier: '5-6' }).frontier).toBe('5-6');
      expect(sanitizeSave({ frontier: '1-1' }).frontier).toBe('1-1');
    });

    it('does not cost the other fields', () => {
      expect(sanitizeSave({ ...GOOD, frontier: 'nope' })).toEqual({ ...GOOD, frontier: '1-1' });
    });
  });

  describe('galaxies', () => {
    it('drops unknown ids and keeps the rest', () => {
      const galaxies = { '1-1': { bestScore: 5, stars: 1 }, '9-9': { bestScore: 5, stars: 1 }, '1-7': { bestScore: 5, stars: 1 }, x: { bestScore: 5, stars: 1 } };
      expect(sanitizeSave({ galaxies }).galaxies).toEqual({ '1-1': { bestScore: 5, stars: 1 } });
    });

    it('clamps stars to 0-3 and rounds fractions down', () => {
      const galaxies = { '1-1': { bestScore: 1, stars: 7 }, '1-2': { bestScore: 1, stars: -2 }, '1-3': { bestScore: 1, stars: 2.9 }, '1-4': { bestScore: 1, stars: 'three' }, '1-5': { bestScore: 1 } };
      expect(sanitizeSave({ galaxies }).galaxies).toEqual({
        '1-1': { bestScore: 1, stars: 3 },
        '1-2': { bestScore: 1, stars: 0 },
        '1-3': { bestScore: 1, stars: 2 },
        '1-4': { bestScore: 1, stars: 0 },
        '1-5': { bestScore: 1, stars: 0 },
      });
    });

    it.each([-5, 'lots', null, Number.NaN, 12.5])('resets a bad best score %j to 0 but keeps its stars', (bestScore) => {
      expect(sanitizeSave({ galaxies: { '1-1': { bestScore, stars: 2 } } }).galaxies).toEqual({ '1-1': { bestScore: 0, stars: 2 } });
    });

    it.each([null, 5, 'x', [], undefined])('drops a galaxy record that is %j', (record) => {
      expect(sanitizeSave({ galaxies: { '1-1': record, '1-2': { bestScore: 3, stars: 1 } } }).galaxies).toEqual({ '1-2': { bestScore: 3, stars: 1 } });
    });

    it.each([null, [], 'x', 7])('gives none when the table itself is %j', (galaxies) => {
      expect(sanitizeSave({ ...GOOD, galaxies }).galaxies).toEqual({});
    });
  });

  describe('rankRun', () => {
    it('is kept when valid', () => {
      expect(sanitizeSave({ rankRun: RUN }).rankRun).toEqual(RUN);
    });

    it('is dropped when any field is bad', () => {
      const bad: unknown[] = [
        { ...RUN, next: '9-9' },
        { ...RUN, score: -1 },
        { ...RUN, score: '5' },
        { ...RUN, lives: 0 },
        { ...RUN, lives: 6 },
        { ...RUN, lives: 2.5 },
        { ...RUN, weaponTier: 4 },
        { ...RUN, continued: 'no' },
        { ...RUN, startedAt: 'yesterday' },
        { ...RUN, startedAt: 20261026 },
        { score: 1 },
        null,
        [],
        'run',
      ];
      for (const rankRun of bad) expect(sanitizeSave({ ...GOOD, rankRun }).rankRun).toBeNull();
    });

    it('does not carry unknown fields', () => {
      expect(sanitizeSave({ rankRun: { ...RUN, cheat: true } }).rankRun).toEqual(RUN);
    });
  });

  describe('rankBoard', () => {
    it('drops an entry with any bad field and keeps the others', () => {
      const bad: unknown[] = [
        { ...ENTRY, score: -1 },
        { ...ENTRY, score: '900' },
        { ...ENTRY, score: 1.5 },
        { ...ENTRY, reached: 'D9 · G1' },
        { ...ENTRY, reached: 'D2 - G1' },
        { ...ENTRY, reached: 7 },
        { ...ENTRY, date: 'someday' },
        { ...ENTRY, continued: 1 },
        { score: 5 },
        null,
        'entry',
      ];
      const board = [...bad, ENTRY];
      expect(sanitizeSave({ rankBoard: board }).rankBoard).toEqual([ENTRY]);
    });

    it('accepts both reached forms', () => {
      const boss = { ...ENTRY, reached: 'D5 · ★' };
      expect(sanitizeSave({ rankBoard: [boss, ENTRY] }).rankBoard).toEqual([boss, ENTRY]);
      expect(sanitizeSave({ rankBoard: [boss] }).rankBoard).toEqual([boss]);
    });

    it('sorts the board and keeps the best ten', () => {
      const rankBoard = Array.from({ length: 14 }, (_, i) => ({ ...ENTRY, score: i * 3 }));
      const board = sanitizeSave({ rankBoard }).rankBoard;
      expect(board).toHaveLength(10);
      expect(board.map((e) => e.score)).toEqual([39, 36, 33, 30, 27, 24, 21, 18, 15, 12]);
    });

    it.each([null, 'x', {}, 4])('is empty when the board is %j', (rankBoard) => {
      expect(sanitizeSave({ rankBoard }).rankBoard).toEqual([]);
    });
  });

  describe('classic fields', () => {
    it.each([[0, 0], [4400, 4400], [-1, null], [1.5, null], ['4400', null], [null, null], [Number.POSITIVE_INFINITY, null]])('classicBest %j becomes %j', (raw, expected) => {
      expect(sanitizeSave({ classicBest: raw }).classicBest).toBe(expected);
    });

    it('classicImported is only ever a boolean', () => {
      expect(sanitizeSave({ classicImported: true }).classicImported).toBe(true);
      expect(sanitizeSave({ classicImported: 'yes' }).classicImported).toBe(false);
    });
  });
});

describe('parseSave', () => {
  it('reads stored JSON', () => {
    expect(parseSave(JSON.stringify(GOOD))).toEqual(GOOD);
  });

  it.each([null, '', '{"frontier":"2-3","galax', 'not json', 'null', '[]'])('gives the defaults for %j', (text) => {
    expect(parseSave(text)).toEqual(defaultSave());
  });
});

describe('mergeSaves', () => {
  const a: SaveData = {
    ...defaultSave(),
    frontier: '2-1',
    galaxies: { '1-1': { bestScore: 900, stars: 1 }, '1-2': { bestScore: 100, stars: 3 } },
    classicBest: 50,
  };
  const b: SaveData = {
    ...defaultSave(),
    frontier: '1-5',
    galaxies: { '1-1': { bestScore: 400, stars: 3 }, '1-3': { bestScore: 70, stars: 2 } },
    classicBest: 80,
    classicImported: true,
  };

  it('takes the furthest frontier', () => {
    expect(mergeSaves(a, b).frontier).toBe('2-1');
    expect(mergeSaves(b, a).frontier).toBe('2-1');
  });

  it('takes the best score and the most stars per galaxy, independently, across the union', () => {
    expect(mergeSaves(a, b).galaxies).toEqual({
      '1-1': { bestScore: 900, stars: 3 },
      '1-2': { bestScore: 100, stars: 3 },
      '1-3': { bestScore: 70, stars: 2 },
    });
  });

  it('is commutative on the frontier, bests, classic fields and board', () => {
    const entryA: RankEntry = { ...ENTRY, score: 10 };
    const entryB: RankEntry = { ...ENTRY, score: 20 };
    const x = { ...a, rankBoard: [entryA] };
    const y = { ...b, rankBoard: [entryB] };
    expect(mergeSaves(x, y)).toEqual(mergeSaves(y, x));
  });

  it('is idempotent', () => {
    expect(mergeSaves(a, a)).toEqual(a);
    expect(mergeSaves(mergeSaves(a, b), b)).toEqual(mergeSaves(a, b));
  });

  it('keeps the larger classic best and any import mark', () => {
    expect(mergeSaves(a, b)).toMatchObject({ classicBest: 80, classicImported: true });
    expect(mergeSaves(a, defaultSave()).classicBest).toBe(50);
    expect(mergeSaves(defaultSave(), defaultSave()).classicBest).toBeNull();
  });

  it('unions the board without duplicating an entry both sides hold, best ten kept', () => {
    const shared: RankEntry = { ...ENTRY, score: 500 };
    const only = (score: number): RankEntry => ({ ...ENTRY, score });
    const left = { ...a, rankBoard: [shared, only(100)] };
    const right = { ...b, rankBoard: [shared, only(300)] };
    expect(mergeSaves(left, right).rankBoard.map((e) => e.score)).toEqual([500, 300, 100]);
    const many = Array.from({ length: 10 }, (_, i) => only(1000 + i));
    expect(mergeSaves({ ...a, rankBoard: many }, { ...b, rankBoard: [only(5)] }).rankBoard).toHaveLength(10);
  });

  describe('rankRun', () => {
    const run = (next: RankRun['next'], score: number): RankRun => ({ ...RUN, next, score });

    it('takes the one with the further next galaxy', () => {
      const far = { ...a, rankRun: run('3-1', 10) };
      const near = { ...b, rankRun: run('2-5', 99999) };
      expect(mergeSaves(far, near).rankRun).toEqual(far.rankRun);
      expect(mergeSaves(near, far).rankRun).toEqual(far.rankRun);
    });

    it('on the same galaxy takes the higher score', () => {
      const high = { ...a, rankRun: run('2-5', 800) };
      const low = { ...b, rankRun: run('2-5', 300) };
      expect(mergeSaves(high, low).rankRun).toEqual(high.rankRun);
      expect(mergeSaves(low, high).rankRun).toEqual(high.rankRun);
    });

    it('takes the only run there is, and none when neither has one', () => {
      const has = { ...a, rankRun: run('2-5', 1) };
      expect(mergeSaves(has, b).rankRun).toEqual(has.rankRun);
      expect(mergeSaves(b, has).rankRun).toEqual(has.rankRun);
      expect(mergeSaves(a, b).rankRun).toBeNull();
    });
  });

  it('does not mutate either input', () => {
    const before = JSON.stringify([a, b]);
    mergeSaves(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
