import type { Dimension } from '../content/types';

/** Seconds a combo survives without a kill. */
export const COMBO_WINDOW_SECONDS = 2.2;
const KILLS_PER_STEP = 5;
const MAX_MULTIPLIER = 5;
const CLEAR_BONUS = 250;
const NO_DEATH_BONUS = 500;

export type GalaxyMode = 'rank' | 'free';
export type Stars = 1 | 2 | 3;

/** What a kill's points are multiplied by after `combo` chained kills, this one included. */
export function comboMultiplier(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / KILLS_PER_STEP));
}

/** A chain of kills, each within the window of the one before; a death or a lapse breaks it. */
export class Combo {
  private kills = 0;
  private lastKillAt = 0;

  get count(): number {
    return this.kills;
  }

  get multiplier(): number {
    return comboMultiplier(this.kills);
  }

  /** Chains a kill at `elapsed` seconds; returns the multiplier its points take. */
  kill(elapsed: number): number {
    this.expire(elapsed);
    this.kills++;
    this.lastKillAt = elapsed;
    return this.multiplier;
  }

  /** Breaks the chain if the window has passed since the last kill. */
  expire(elapsed: number): void {
    if (elapsed - this.lastKillAt > COMBO_WINDOW_SECONDS) this.kills = 0;
  }

  reset(): void {
    this.kills = 0;
  }
}

/** 0 deaths in the galaxy earn 3 stars, 1 earns 2, more earn 1 for clearing it. */
export function starsFor(deaths: number): Stars {
  return deaths === 0 ? 3 : deaths === 1 ? 2 : 1;
}

/** Rank's reward for a deeper Dimension. */
export function dimensionMultiplier(dimension: Dimension): number {
  return 1 + 0.1 * (dimension - 1);
}

export interface ClearInput {
  readonly score: number;
  readonly deaths: number;
  readonly dimension: Dimension;
  readonly mode: GalaxyMode;
}

export interface ClearReport {
  /** The run's total: score plus bonus, times the Dimension multiplier in Rank. */
  readonly score: number;
  /** The clear and no-death bonus, before any Rank multiplier. */
  readonly bonus: number;
  readonly deaths: number;
  readonly stars: Stars;
}

/** The totals of a cleared galaxy. */
export function clearReport({ score, deaths, dimension, mode }: ClearInput): ClearReport {
  const bonus = CLEAR_BONUS * dimension + (deaths === 0 ? NO_DEATH_BONUS * dimension : 0);
  const total = mode === 'rank' ? Math.round((score + bonus) * dimensionMultiplier(dimension)) : score + bonus;
  return { score: total, bonus, deaths, stars: starsFor(deaths) };
}
