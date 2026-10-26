import { nextGalaxyId } from '../content/galaxies';
import type { GalaxyDef, GalaxyId } from '../content/types';

export const RANK_START_LIVES = 3;
export const RANK_MAX_LIVES = 5;

/** A Rank run in progress: the galaxy to play next and what the player carries into it. */
export interface RankRun {
  readonly next: GalaxyId;
  readonly score: number;
  readonly lives: number;
  readonly weaponTier: 0 | 1 | 2 | 3;
  /** True once the player used Continue; the board marks such runs. */
  readonly continued: boolean;
  /** `YYYY-MM-DD` */
  readonly startedAt: string;
}

/** A fresh run at 1-1. `today` is passed in because this module may not read the clock. */
export function startRank(today: string): RankRun {
  return { next: '1-1', score: 0, lives: RANK_START_LIVES, weaponTier: 0, continued: false, startedAt: today };
}

/** The run after `cleared` is won with `score` and `livesLeft`; a boss gives one extra life, up to the cap. `'complete'` after 5-★. */
export function afterClear(run: RankRun, cleared: GalaxyDef, score: number, livesLeft: number): RankRun | 'complete' {
  const next = nextGalaxyId(cleared.id);
  if (next === null) return 'complete';
  const lives = cleared.kind === 'boss' ? Math.min(RANK_MAX_LIVES, livesLeft + 1) : livesLeft;
  return { ...run, next, score, lives };
}

/** Continue after a game over: same galaxy, fresh lives, score back to 0, and the run is marked. */
export function afterGameOver(run: RankRun): RankRun {
  return { ...run, score: 0, lives: RANK_START_LIVES, continued: true };
}
