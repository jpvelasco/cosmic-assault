import { describe, expect, it } from 'vitest';
import { bestsBefore, newBest, NO_BESTS, type BestsBefore, type BestOutcome, type NewBest } from '../../src/meta/bests';
import { defaultSave, type SaveData } from '../../src/meta/save';
import type { RankEntry } from '../../src/meta/rankBoard';

interface Case {
  readonly name: string;
  readonly before: BestsBefore;
  readonly outcome: BestOutcome;
  readonly expected: NewBest | null;
}

const SCORE = 900;
const galaxy = (record: number | null): BestsBefore => ({ ...NO_BESTS, galaxy: record });
const rankTop = (record: number | null): BestsBefore => ({ ...NO_BESTS, rankTop: record });
const daily = (record: number | null): BestsBefore => ({ ...NO_BESTS, daily: record });

/** Every kind of record against the outcomes a run can have: a first record, a tie, a beat, a debug run and an empty board. */
const CASES: readonly Case[] = [
  { name: 'galaxy, first record', before: galaxy(null), outcome: { kind: 'galaxy', score: SCORE }, expected: null },
  { name: 'galaxy, tie', before: galaxy(SCORE), outcome: { kind: 'galaxy', score: SCORE }, expected: null },
  { name: 'galaxy, beat', before: galaxy(SCORE), outcome: { kind: 'galaxy', score: SCORE + 1 }, expected: { kind: 'galaxy', score: SCORE + 1 } },
  { name: 'galaxy, debug run', before: NO_BESTS, outcome: { kind: 'galaxy', score: SCORE + 1 }, expected: null },
  { name: 'Rank run, empty board', before: rankTop(null), outcome: { kind: 'rankRun', score: SCORE }, expected: null },
  { name: 'Rank run, tie', before: rankTop(SCORE), outcome: { kind: 'rankRun', score: SCORE }, expected: null },
  { name: 'Rank run, beat', before: rankTop(SCORE), outcome: { kind: 'rankRun', score: SCORE + 1 }, expected: { kind: 'rankRun', score: SCORE + 1 } },
  { name: 'Rank run, debug run', before: NO_BESTS, outcome: { kind: 'rankRun', score: SCORE + 1 }, expected: null },
  { name: 'Daily, first record', before: daily(null), outcome: { kind: 'daily', score: SCORE }, expected: null },
  { name: 'Daily, tie', before: daily(SCORE), outcome: { kind: 'daily', score: SCORE }, expected: null },
  { name: 'Daily, beat', before: daily(SCORE), outcome: { kind: 'daily', score: SCORE + 1 }, expected: { kind: 'daily', score: SCORE + 1 } },
  { name: 'Daily, debug run', before: NO_BESTS, outcome: { kind: 'daily', score: SCORE + 1 }, expected: null },
];

describe('newBest', () => {
  it.each(CASES)('$name', ({ before, outcome, expected }) => {
    expect(newBest(before, outcome)).toEqual(expected);
  });

  it('compares each kind only against its own record', () => {
    const others: BestsBefore = { galaxy: 1, rankTop: 1, daily: null };
    expect(newBest(others, { kind: 'daily', score: 5000 })).toBeNull();
    expect(newBest(others, { kind: 'rankRun', score: 5000 })).toEqual({ kind: 'rankRun', score: 5000 });
  });
});

describe('bestsBefore', () => {
  const board = (scores: readonly number[]): RankEntry[] =>
    scores.map((score) => ({ score, reached: 'D1 · G1', date: '2026-10-01', continued: false }));
  const saveWith = (galaxies: SaveData['galaxies'], rankBoard: RankEntry[] = []): SaveData => ({ ...defaultSave(), galaxies, rankBoard });

  it('reads the galaxy in play and the top of the Rank board, as saved', () => {
    const save = saveWith({ '2-3': { bestScore: 2400, stars: 2 } }, board([5100, 3000]));
    expect(bestsBefore(save, '2-3')).toEqual({ galaxy: 2400, rankTop: 5100, daily: null });
  });

  it('has no galaxy best for a galaxy never cleared, nor a galaxy when none is in play', () => {
    expect(bestsBefore(defaultSave(), '2-3').galaxy).toBeNull();
    expect(bestsBefore(saveWith({ '2-3': { bestScore: 2400, stars: 2 } }), null).galaxy).toBeNull();
  });

  it('has no Rank record on an empty board', () => {
    expect(bestsBefore(defaultSave(), '1-1').rankTop).toBeNull();
  });
});
