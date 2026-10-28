import type { GalaxyId } from '../content/types';
import { dailyBestBefore } from './daily';
import type { SaveData } from './save';

/** The kinds of record a run can beat: a galaxy's best, the Rank board's top, and a Daily's best on its date. */
export type BestKind = 'galaxy' | 'rankRun' | 'daily';

/** A score a run has made, of `kind`, to compare with that kind's record. */
export interface BestOutcome {
  readonly kind: BestKind;
  readonly score: number;
}

/** A record a run beat: its kind and the score it now stands on. */
export type NewBest = BestOutcome;

/**
 * The records a run has to beat, as saved before the run writes: each is the number to beat, or null where there is
 * none (a first clear, an empty board, a debug run). The galaxy's is at Free play scale.
 */
export interface BestsBefore {
  readonly galaxy: number | null;
  readonly rankTop: number | null;
  /** The best Daily score on the date in play. */
  readonly daily: number | null;
}

/** What a debug run has to beat: nothing, since its clears are never saved. */
export const NO_BESTS: BestsBefore = { galaxy: null, rankTop: null, daily: null };

/** The field of `BestsBefore` each kind is compared against. */
const RECORD_OF: Readonly<Record<BestKind, keyof BestsBefore>> = { galaxy: 'galaxy', rankRun: 'rankTop', daily: 'daily' };

/** The run a record is looked up for: its galaxy (null outside a galaxy run), and the date of a Daily (null outside one). */
export interface BestsRun {
  readonly galaxy: GalaxyId | null;
  readonly daily: string | null;
}

/**
 * The records in `save` for `run`, as they stand before the run writes. A Daily has its date's best and no galaxy best:
 * the anchor galaxy it is built on keeps a record of its own.
 */
export function bestsBefore(save: SaveData, { galaxy, daily }: BestsRun): BestsBefore {
  return {
    galaxy: galaxy === null || daily !== null ? null : (save.galaxies[galaxy]?.bestScore ?? null),
    rankTop: save.rankBoard[0]?.score ?? null,
    daily: daily === null ? null : dailyBestBefore(save, daily),
  };
}

/**
 * The record `outcome` beats, or null: a record needs an earlier one to beat, so a first record, a tie and an empty
 * board are none. This is the only place a score is compared with a record.
 */
export function newBest(before: BestsBefore, outcome: BestOutcome): NewBest | null {
  const record = before[RECORD_OF[outcome.kind]];
  return record !== null && outcome.score > record ? { kind: outcome.kind, score: outcome.score } : null;
}
