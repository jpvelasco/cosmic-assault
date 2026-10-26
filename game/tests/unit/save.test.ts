import { describe, expect, it } from 'vitest';
import { GALAXIES, galaxyOrdinal } from '../../src/content/galaxies';
import { createRng, type Rng } from '../../src/sim/rng';
import { defaultSave, MAX_RANK_SEQ, mergeSaves, parseSave, SAVE_KEY, sanitizeSave, type SaveData } from '../../src/meta/save';
import type { RankEntry } from '../../src/meta/rankBoard';
import type { RankRun } from '../../src/meta/rankRun';

const RUN: RankRun = { next: '2-3', score: 1500, lives: 4, weaponTier: 1, continued: false, startedAt: '2026-10-26' };
const ENTRY: RankEntry = { score: 900, reached: 'D2 · G1', date: '2026-10-25', continued: true };
const GOOD: SaveData = {
  version: 1,
  frontier: '2-3',
  galaxies: { '1-1': { bestScore: 700, stars: 2 }, '2-2': { bestScore: 1200, stars: 3 } },
  rankRun: RUN,
  rankSeq: 3,
  rankBoard: [ENTRY],
  classicBest: 4400,
  classicImported: true,
};

describe('defaults', () => {
  it('start at 1-1 with nothing cleared', () => {
    expect(SAVE_KEY).toBe('cosmic-assault.v2');
    expect(defaultSave()).toEqual({ version: 1, frontier: '1-1', galaxies: {}, rankRun: null, rankSeq: 0, rankBoard: [], classicBest: null, classicImported: false });
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

  describe('rankSeq', () => {
    it.each([0, 1, 41])('keeps %j', (rankSeq) => {
      expect(sanitizeSave({ rankSeq }).rankSeq).toBe(rankSeq);
    });

    it('is capped at 2^31, so a doctored or runaway count stays a safe, comparable number', () => {
      expect(MAX_RANK_SEQ).toBe(2 ** 31);
      expect(sanitizeSave({ rankSeq: 2 ** 31 }).rankSeq).toBe(2 ** 31);
      expect(sanitizeSave({ rankSeq: 2 ** 31 + 1 }).rankSeq).toBe(2 ** 31);
      expect(sanitizeSave({ rankSeq: Number.MAX_SAFE_INTEGER }).rankSeq).toBe(2 ** 31);
    });

    it.each([-1, 1.5, '3', null, Number.POSITIVE_INFINITY, Number.NaN])('resets %j to 0', (rankSeq) => {
      expect(sanitizeSave({ ...GOOD, rankSeq }).rankSeq).toBe(0);
    });

    it('is 0 when missing, as in a save from before it existed', () => {
      expect(sanitizeSave({ ...GOOD, rankSeq: undefined }).rankSeq).toBe(0);
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

  it('orders full board ties by reached, then Continue, whichever side holds them', () => {
    const tie = (reached: string, continued: boolean): RankEntry => ({ ...ENTRY, score: 500, reached, continued });
    const x = { ...a, rankBoard: [tie('D3 · G1', false), tie('D2 · G1', true)] };
    const y = { ...b, rankBoard: [tie('D2 · G1', false)] };
    const merged = mergeSaves(x, y).rankBoard;
    expect(merged.map((e) => `${e.reached}/${String(e.continued)}`)).toEqual(['D2 · G1/false', 'D2 · G1/true', 'D3 · G1/false']);
    expect(mergeSaves(y, x).rankBoard).toEqual(merged);
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
    const run = (next: RankRun['next'], score: number, extra: Partial<RankRun> = {}): RankRun => ({ ...RUN, next, score, ...extra });
    const both = (x: SaveData, y: SaveData): [SaveData, SaveData] => [mergeSaves(x, y), mergeSaves(y, x)];

    it('on the same rankSeq takes the one with the further next galaxy', () => {
      const far = { ...a, rankRun: run('3-1', 10) };
      const near = { ...b, rankRun: run('2-5', 99999) };
      for (const merged of both(far, near)) expect(merged.rankRun).toEqual(far.rankRun);
    });

    it('on the same galaxy takes the higher score', () => {
      const high = { ...a, rankRun: run('2-5', 800) };
      const low = { ...b, rankRun: run('2-5', 300) };
      for (const merged of both(high, low)) expect(merged.rankRun).toEqual(high.rankRun);
    });

    it('on the same galaxy and score prefers the run that has not used Continue', () => {
      const plain = { ...a, rankRun: run('2-5', 300, { continued: false }) };
      const used = { ...b, rankRun: run('2-5', 300, { continued: true }) };
      for (const merged of both(plain, used)) expect(merged.rankRun?.continued).toBe(false);
    });

    it('is commutative even when the runs differ only in lives, tier or start date', () => {
      const x = { ...a, rankRun: run('2-5', 300, { lives: 2, weaponTier: 1, startedAt: '2026-01-01' }) };
      const y = { ...b, rankRun: run('2-5', 300, { lives: 4, weaponTier: 0, startedAt: '2026-02-02' }) };
      const [xy, yx] = both(x, y);
      expect(xy).toEqual(yx);
    });

    it('takes the only run there is, and none when neither has one', () => {
      const has = { ...a, rankRun: run('2-5', 1) };
      for (const merged of both(has, b)) expect(merged.rankRun).toEqual(has.rankRun);
      expect(mergeSaves(a, b).rankRun).toBeNull();
    });

    it('takes the run, even none, from the side with the higher rankSeq', () => {
      const stale = { ...a, rankSeq: 1, rankRun: run('3-1', 90000) };
      const ended = { ...b, rankSeq: 2, rankRun: null };
      for (const merged of both(stale, ended)) expect(merged).toMatchObject({ rankSeq: 2, rankRun: null });
      const restarted = { ...b, rankSeq: 3, rankRun: run('1-1', 0) };
      for (const merged of both(ended, restarted)) expect(merged).toMatchObject({ rankSeq: 3, rankRun: restarted.rankRun });
      for (const merged of both(stale, restarted)) expect(merged.rankRun).toEqual(restarted.rankRun);
    });

    it('at the rankSeq cap both sides tie, so the run that got further wins', () => {
      const behind = { ...a, rankSeq: MAX_RANK_SEQ, rankRun: run('1-2', 5) };
      const ahead = { ...b, rankSeq: MAX_RANK_SEQ, rankRun: run('2-1', 0) };
      for (const merged of both(behind, ahead)) expect(merged).toMatchObject({ rankSeq: MAX_RANK_SEQ, rankRun: ahead.rankRun });
    });

    it('a null run does not beat a run on the same rankSeq', () => {
      const has = { ...a, rankSeq: 2, rankRun: run('1-2', 5) };
      const none = { ...b, rankSeq: 2, rankRun: null };
      for (const merged of both(has, none)) expect(merged.rankRun).toEqual(has.rankRun);
    });
  });

  it('does not mutate either input', () => {
    const before = JSON.stringify([a, b]);
    mergeSaves(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('mergeSaves over seeded random pairs', () => {
  const GALAXY_IDS = GALAXIES.map((g) => g.id);

  function randomSave(rng: Rng): SaveData {
    const galaxies: Record<string, { bestScore: number; stars: number }> = {};
    for (const id of GALAXY_IDS) if (rng.chance(0.3)) galaxies[id] = { bestScore: rng.int(0, 5) * 100, stars: rng.int(0, 4) };
    const board = Array.from({ length: rng.int(0, 14) }, () => ({
      score: rng.int(0, 5) * 100,
      reached: rng.pick(['D1 · G1', 'D1 · G2', 'D2 · ★']),
      date: rng.pick(['2026-01-01', '2026-02-02']),
      continued: rng.chance(0.5),
    }));
    const hasRun = rng.chance(0.7);
    return sanitizeSave({
      frontier: rng.pick(GALAXY_IDS),
      galaxies,
      rankSeq: rng.int(0, 3),
      rankRun: hasRun
        ? { next: rng.pick(GALAXY_IDS), score: rng.int(0, 4) * 100, lives: rng.int(1, 6), weaponTier: rng.int(0, 4), continued: rng.chance(0.5), startedAt: rng.pick(['2026-01-01', '2026-02-02']) }
        : null,
      rankBoard: board,
      classicBest: rng.chance(0.5) ? rng.int(0, 5) * 1000 : null,
      classicImported: rng.chance(0.5),
    });
  }

  const rng = createRng(20261026);
  const triples = Array.from({ length: 300 }, () => [randomSave(rng), randomSave(rng), randomSave(rng)] as const);

  it('is commutative', () => {
    for (const [a, b] of triples) expect(mergeSaves(a, b)).toEqual(mergeSaves(b, a));
  });

  it('is idempotent once merged', () => {
    for (const [a, b] of triples) {
      const m = mergeSaves(a, b);
      expect(mergeSaves(m, m)).toEqual(m);
      expect(mergeSaves(m, b)).toEqual(m);
      expect(mergeSaves(m, a)).toEqual(m);
    }
  });

  it('is associative', () => {
    for (const [a, b, c] of triples) expect(mergeSaves(mergeSaves(a, b), c)).toEqual(mergeSaves(a, mergeSaves(b, c)));
  });

  it('never loses a frontier, a best, or a rankSeq from either side', () => {
    for (const [a, b] of triples) {
      const m = mergeSaves(a, b);
      expect(galaxyOrdinal(m.frontier)).toBe(Math.max(galaxyOrdinal(a.frontier), galaxyOrdinal(b.frontier)));
      expect(m.rankSeq).toBe(Math.max(a.rankSeq, b.rankSeq));
      for (const id of GALAXY_IDS) {
        expect(m.galaxies[id]?.bestScore ?? 0).toBe(Math.max(a.galaxies[id]?.bestScore ?? 0, b.galaxies[id]?.bestScore ?? 0));
        expect(m.galaxies[id]?.stars ?? 0).toBe(Math.max(a.galaxies[id]?.stars ?? 0, b.galaxies[id]?.stars ?? 0));
      }
    }
  });
});
