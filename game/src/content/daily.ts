import type { Dimension, GalaxyId, MusicThemeId, PaletteId, ThreatKind } from './types';

/** The twists a Daily Galaxy plays with, one a day. */
export type DailyTwistId = 'doubleMeteors' | 'gravityStorm' | 'droneSwarm' | 'splitterField';

/** How a twist scales a kind's ramp: its base and its max `times` as likely, the max no higher than `cap`. */
export interface RampScale {
  readonly times: number;
  readonly cap: number;
}

/**
 * One twist, as data the generator applies alike to every row: the least Dimension its anchor needs, the ramps it
 * scales (an anchor must field each kind it scales), how many times the usual showers fall, the set piece it schedules
 * in place of a plain gravity well, and how much higher its target sits.
 */
export interface DailyTwist {
  readonly id: DailyTwistId;
  /** Its name in the game, in sentence case: "Today's twist: Gravity storm". */
  readonly name: string;
  readonly blurb: string;
  readonly minDimension: Dimension;
  readonly rampScale: Readonly<Partial<Record<ThreatKind, RampScale>>>;
  readonly showerFactor: 1 | 2;
  readonly setPiece: 'gravityStorm' | null;
  readonly targetScale: number;
}

/** Every twist, in the order the generator rolls them. (The scales and target scales are tuning values.) */
export const DAILY_TWISTS: readonly DailyTwist[] = [
  { id: 'doubleMeteors', name: 'Double meteors', blurb: 'Twice the meteor showers', minDimension: 1, rampScale: {}, showerFactor: 2, setPiece: null, targetScale: 1.15 },
  { id: 'gravityStorm', name: 'Gravity storm', blurb: 'Several gravity wells open at once', minDimension: 2, rampScale: {}, showerFactor: 1, setPiece: 'gravityStorm', targetScale: 1.1 },
  { id: 'droneSwarm', name: 'Drone swarm', blurb: 'Drones come more often', minDimension: 2, rampScale: { drone: { times: 1.5, cap: 0.6 } }, showerFactor: 1, setPiece: null, targetScale: 1.15 },
  { id: 'splitterField', name: 'Splitter field', blurb: 'Splitter rocks come more often', minDimension: 1, rampScale: { splitter: { times: 1.6, cap: 0.6 } }, showerFactor: 1, setPiece: null, targetScale: 1.1 },
];

/** The survival galaxies a Daily is built on, from tier 0.2 to 1.6. (A tuning value.) */
export const DAILY_ANCHORS: readonly GalaxyId[] = ['1-2', '1-3', '1-4', '1-5', '2-1', '2-2', '2-3', '2-4'];

/** The looks a Daily wears, each a palette with its own theme, picked whatever its anchor. */
export const DAILY_LOOKS: readonly { readonly palette: PaletteId; readonly theme: MusicThemeId }[] = [
  { palette: 'drift', theme: 'drift' },
  { palette: 'ionReach', theme: 'ionReach' },
];

/** How many meteor showers fall before the twist's factor. */
export const DAILY_SHOWER_COUNTS: readonly number[] = [1, 2];
/** The highest intensity a Daily's showers fall at, whatever the anchor. */
export const DAILY_MAX_SHOWER_INTENSITY = 2;
/** The chance a Daily on an Ion Reach anchor gets a plain gravity well, when its twist brings no set piece. */
export const DAILY_WELL_CHANCE = 0.5;
/** Seconds between the times a Daily's events may start at. */
export const DAILY_GRID_SECONDS = 5;

/**
 * The target is `TARGET_K × duration × threatBudget(tier) × targetScale`, times a spread from `TARGET_SPREAD.low` to
 * `low + width`, rounded to `TARGET_ROUNDING`. `TARGET_K` is an initial value: it sets a target near 14,500 on a mid
 * anchor, until the bots' scores calibrate it.
 */
export const TARGET_K = 8;
export const TARGET_SPREAD = { low: 0.92, width: 0.16 } as const;
export const TARGET_ROUNDING = 50;

/** What the HUD and the cards call a Daily Galaxy. */
export const DAILY_LABEL = 'Daily';

/** A Daily's title on its cards: "Daily Galaxy · 2026-10-26". */
export const dailyTitle = (date: string): string => `Daily Galaxy · ${date}`;
