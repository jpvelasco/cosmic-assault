import { galaxyOrdinal, nextGalaxyId } from '../content/galaxies';
import type { GalaxyDef, GalaxyId } from '../content/types';

export const RANK_START_LIVES = 3;
export const RANK_MAX_LIVES = 5;

/** A Rank run in progress: the galaxy to play next and what the player carries into it. */
export interface RankRun {
  readonly next: GalaxyId;
  /** The score carried into `next`. */
  readonly score: number;
  /** 0 once the run is lost: it waits, with its board entry posted, for a Continue. */
  readonly lives: number;
  readonly weaponTier: 0 | 1 | 2 | 3;
  /** True once the player used Continue; the board marks such runs. */
  readonly continued: boolean;
  /** `YYYY-MM-DD` */
  readonly startedAt: string;
  /** True while `next` is being played. A run saved like this was left mid-galaxy (Quit or a closed tab): it forfeits. */
  readonly inGalaxy: boolean;
}

/** A fresh run at 1-1. `today` is passed in because this module may not read the clock. */
export function startRank(today: string): RankRun {
  return { next: '1-1', score: 0, lives: RANK_START_LIVES, weaponTier: 0, continued: false, startedAt: today, inGalaxy: false };
}

/**
 * The run after `cleared` is won with `score` and `livesLeft`; a boss gives one extra life, up to the cap.
 * `'complete'` after 5-★. Throws if `cleared` is not the run's `next` galaxy.
 */
export function afterClear(run: RankRun, cleared: GalaxyDef, score: number, livesLeft: number): RankRun | 'complete' {
  if (cleared.id !== run.next) {
    throw new RangeError(`afterClear got ${cleared.id}, but this Rank run is on ${run.next}: pass the galaxy the run just played (galaxyById(run.next))`);
  }
  const next = nextGalaxyId(cleared.id);
  if (next === null) return 'complete';
  const lives = cleared.kind === 'boss' ? Math.min(RANK_MAX_LIVES, livesLeft + 1) : livesLeft;
  return { ...run, next, score, lives, inGalaxy: false };
}

/** Continue after a game over: same galaxy, fresh lives, score back to 0, and the run is marked. */
export function afterGameOver(run: RankRun): RankRun {
  return { ...run, score: 0, lives: RANK_START_LIVES, continued: true };
}

/**
 * The run after its galaxy is left unfinished (Quit, or a tab closed mid-galaxy) with the ship on `livesLeft`: one
 * more life lost and the galaxy's score gone, back between galaxies. The lives lost in the galaxy stay lost, and more
 * lives left than the run carried never refund any. With no lives left the run is lost, as at a game over.
 */
export function afterForfeit(run: RankRun, livesLeft: number): RankRun {
  return { ...run, lives: Math.max(0, Math.min(run.lives, livesLeft) - 1), inGalaxy: false };
}

/** The run, still in its galaxy, after the ship is hit with `livesLeft` left: a forfeit from here counts from them. */
export function afterHit(run: RankRun, livesLeft: number): RankRun {
  return { ...run, lives: Math.min(run.lives, livesLeft) };
}

/** Which of two runs got further: positive when `b` did. Further `next`, then higher score, then one that has not used Continue; the rest breaks ties so every pair has an order. */
export function compareRuns(a: RankRun, b: RankRun): number {
  return (
    galaxyOrdinal(b.next) - galaxyOrdinal(a.next) ||
    b.score - a.score ||
    Number(a.continued) - Number(b.continued) ||
    b.lives - a.lives ||
    b.weaponTier - a.weaponTier ||
    (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0)
  );
}
