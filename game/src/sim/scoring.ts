import type { Dimension } from '../content/types';

/** Seconds a combo survives without a kill. */
export const COMBO_WINDOW_SECONDS = 2.2;
const KILLS_PER_STEP = 5;
const MAX_MULTIPLIER = 5;
const CLEAR_BONUS = 250;
const NO_DEATH_BONUS = 500;

/** Rank's one run through every Dimension, Free play's replay of a galaxy, or the Daily Galaxy. */
export type GalaxyMode = 'rank' | 'free' | 'daily';
/** The modes whose galaxy runs start afresh: see `startsFresh`. */
export type FreshMode = Exclude<GalaxyMode, 'rank'>;
export type Stars = 1 | 2 | 3;

/**
 * Whether a galaxy run in `mode` starts afresh, with 3 lives and the weapon tier at 0, and keeps its tier through a death:
 * Free play and the Daily do. Only Rank carries lives and a tier from galaxy to galaxy, and drops a tier with a death.
 */
export const startsFresh = (mode: GalaxyMode): mode is FreshMode => mode !== 'rank';

/** What the World's checks call each mode that starts afresh. */
export const FRESH_MODE_NAMES: Readonly<Record<FreshMode, string>> = { free: 'Free play', daily: 'The Daily' };

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

/** A clear's two bonuses in `dimension`, before any Rank multiplier: one for the clear, one for a clear with no deaths. */
export function clearBonuses(dimension: Dimension, deaths: number): { readonly clear: number; readonly noDeath: number } {
  return { clear: CLEAR_BONUS * dimension, noDeath: deaths === 0 ? NO_DEATH_BONUS * dimension : 0 };
}

/** The totals of a cleared galaxy. */
export function clearReport({ score, deaths, dimension, mode }: ClearInput): ClearReport {
  const { clear, noDeath } = clearBonuses(dimension, deaths);
  const bonus = clear + noDeath;
  const total = mode === 'rank' ? Math.round((score + bonus) * dimensionMultiplier(dimension)) : score + bonus;
  return { score: total, bonus, deaths, stars: starsFor(deaths) };
}

/**
 * The points a cleared galaxy's kills scored, before its bonus and any Rank multiplier: `clearReport` run backwards.
 * Exact, because the report rounds once and the multiplier is at least 1.
 */
export function galaxyPoints(report: Pick<ClearReport, 'score' | 'bonus'>, dimension: Dimension, mode: GalaxyMode): number {
  const factor = mode === 'rank' ? dimensionMultiplier(dimension) : 1;
  return Math.round(report.score / factor) - report.bonus;
}

/** What a clear counts toward its galaxy's best: its kills and bonus, without Rank's multiplier, so both modes compare alike. */
export function galaxyBestScore(report: Pick<ClearReport, 'score' | 'bonus'>, dimension: Dimension, mode: GalaxyMode): number {
  return galaxyPoints(report, dimension, mode) + report.bonus;
}
