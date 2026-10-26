import { galaxyOrdinal, nextGalaxyId } from '../content/galaxies';
import type { GalaxyDef, GalaxyId, WeaponTier } from '../content/types';

export const RANK_START_LIVES = 3;
export const RANK_MAX_LIVES = 5;

/** A Rank run in progress: the galaxy to play next and what the player carries into it. */
export interface RankRun {
  readonly next: GalaxyId;
  /** The score carried into `next`. */
  readonly score: number;
  /** 0 once the run is lost: it waits, with its board entry posted, for a Continue. */
  readonly lives: number;
  readonly weaponTier: WeaponTier;
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
 * The run after `cleared` is won with `score`, `livesLeft` and the ship on `weaponTier`; a boss gives one extra life, up
 * to the cap. `'complete'` after 5-★. Throws if `cleared` is not the run's `next` galaxy.
 */
export function afterClear(run: RankRun, cleared: GalaxyDef, score: number, livesLeft: number, weaponTier: WeaponTier): RankRun | 'complete' {
  if (cleared.id !== run.next) {
    throw new RangeError(`afterClear got ${cleared.id}, but this Rank run is on ${run.next}: pass the galaxy the run just played (galaxyById(run.next))`);
  }
  const next = nextGalaxyId(cleared.id);
  if (next === null) return 'complete';
  const lives = cleared.kind === 'boss' ? Math.min(RANK_MAX_LIVES, livesLeft + 1) : livesLeft;
  return { ...run, next, score, lives, weaponTier, inGalaxy: false };
}

/** Continue after a game over: same galaxy, fresh lives, score back to 0, and the run is marked. */
export function afterGameOver(run: RankRun): RankRun {
  return { ...run, score: 0, lives: RANK_START_LIVES, continued: true };
}

/** The tier a run keeps from a galaxy it has not finished: what the galaxy took away stays gone, but its pickups are not kept. */
const keptTier = (run: RankRun, weaponTier: WeaponTier): WeaponTier => Math.min(run.weaponTier, weaponTier) as WeaponTier;

/**
 * The run after its galaxy is left unfinished (Quit, or a tab closed mid-galaxy) with the ship on `livesLeft` and
 * `weaponTier`: it counts as a death, so one more life and one more tier are lost and the galaxy's score is gone, back
 * between galaxies. The lives and tiers lost in the galaxy stay lost, and more than the run carried never refund any.
 * With no lives left the run is lost, as at a game over.
 */
export function afterForfeit(run: RankRun, livesLeft: number, weaponTier: WeaponTier): RankRun {
  return { ...run, lives: Math.max(0, Math.min(run.lives, livesLeft) - 1), weaponTier: Math.max(0, keptTier(run, weaponTier) - 1) as WeaponTier, inGalaxy: false };
}

/** The run, still in its galaxy, after the ship is hit with `livesLeft` left on `weaponTier`: a forfeit from here counts from them. */
export function afterHit(run: RankRun, livesLeft: number, weaponTier: WeaponTier): RankRun {
  return { ...run, lives: Math.min(run.lives, livesLeft), weaponTier: keptTier(run, weaponTier) };
}

/** The run after its last life goes with the ship on `weaponTier` (the tier the fatal hit left): no lives, waiting for a Continue. */
export function afterLoss(run: RankRun, weaponTier: WeaponTier): RankRun {
  return { ...run, lives: 0, weaponTier: keptTier(run, weaponTier), inGalaxy: false };
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
