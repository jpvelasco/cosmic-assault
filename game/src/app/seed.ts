import { isGalaxyId } from '../content/galaxies';
import type { GalaxyDef, GalaxyId } from '../content/types';
import { isCalendarDate } from '../meta/calendar';
import { QUALITY_LEVELS } from '../render/quality';
import { isGalaxyStartLives, isWorldSeed, MAX_GALAXY_START_LIVES, UINT32_MAX } from '../sim/world';

const DECIMAL_DIGITS = /^\d+$/;

/**
 * Tags every e2e query warning. Only the parsers below and `runSeed`'s gated warning use it, so `check:no-bridge` can
 * prove the release build dropped them by finding it in `dist-e2e/` and not in `dist/`.
 */
export const E2E_QUERY_MARK = '__E2E_QUERY__';

/**
 * The run settings an e2e or dev build may take from the URL; undefined means use the normal value.
 *
 * Free play always starts with 3 lives (the World refuses any other count), so `startLives` applies only to Rank:
 * a Rank run started from mode select begins with it, and a `?galaxy=` run given `?lives=` is played as a Rank run
 * from that galaxy with those lives instead of in Free play. Continue still restores the normal 3.
 */
export interface RunOverrides {
  readonly seed: number | undefined;
  /** 1 to 5: a Rank run's starting lives. */
  readonly startLives: number | undefined;
  /** A quality level index (see QUALITY_LEVELS) to pin instead of adapting to frame time. */
  readonly quality: number | undefined;
  /** The title's Play jumps straight into this galaxy, skipping mode select and the map. */
  readonly galaxy: GalaxyId | undefined;
  /** Seconds into the galaxy played at which a gravity storm is added to it, which no authored galaxy schedules. */
  readonly storm: number | undefined;
  /** The date the app takes as today, `YYYY-MM-DD`, in place of the device's. */
  readonly today: string | undefined;
}

const NO_OVERRIDES: RunOverrides = { seed: undefined, startLives: undefined, quality: undefined, galaxy: undefined, storm: undefined, today: undefined };

/** Warns, with the e2e mark, that `?name=raw` breaks `rule` and what happens instead. */
function warnIgnored(name: string, raw: string, rule: string, fallback: string): void {
  console.warn(`${E2E_QUERY_MARK} Ignoring ?${name}=${raw}: it must be ${rule}; ${fallback}`);
}

/** Parses a decimal query value accepted by `isValid`, or warns (naming the rule and fallback) and returns undefined. */
function parseQueryInteger(
  name: string,
  raw: string | null,
  isValid: (value: number) => boolean,
  range: string,
  fallback: string,
): number | undefined {
  if (raw === null) return undefined;
  const value = DECIMAL_DIGITS.test(raw) ? Number(raw) : Number.NaN;
  if (isValid(value)) return value;
  warnIgnored(name, raw, `an integer from ${range}`, fallback);
  return undefined;
}

/** Parses a `?seed=` value into a uint32 World seed, or warns and returns undefined. */
export function parseSeed(raw: string | null): number | undefined {
  return parseQueryInteger('seed', raw, isWorldSeed, `0 to ${String(UINT32_MAX)}`, 'using a time-based seed instead');
}

/** Parses a `?lives=` value into a Rank run's starting lives (1–5), or warns and returns undefined. */
export function parseLives(raw: string | null): number | undefined {
  return parseQueryInteger('lives', raw, isGalaxyStartLives, `1 to ${String(MAX_GALAXY_START_LIVES)}`, 'starting with the default lives instead');
}

/** Parses a `?galaxy=` value (`D-G`, 1-1 to 5-6), or warns and returns undefined. */
export function parseGalaxy(raw: string | null): GalaxyId | undefined {
  if (raw === null) return undefined;
  if (isGalaxyId(raw)) return raw;
  warnIgnored('galaxy', raw, 'a galaxy from 1-1 to 5-6 (Dimension-galaxy, 6 is the boss)', 'starting on the title as normal instead');
  return undefined;
}

/** Parses a `?quality=` value (a level index or name) into a QUALITY_LEVELS index, or warns and returns undefined. */
export function parseQuality(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const named = QUALITY_LEVELS.findIndex(({ name }) => name === raw);
  if (named >= 0) return named;
  const last = QUALITY_LEVELS.length - 1;
  const names = QUALITY_LEVELS.map(({ name }) => name).join(', ');
  return parseQueryInteger('quality', raw, (value) => value <= last, `0 to ${String(last)} (or one of ${names})`, 'adapting to frame time instead');
}

/** Parses a `?storm=` value (3 to 600 seconds), or warns and returns undefined. */
export function parseStorm(raw: string | null): number | undefined {
  return parseQueryInteger('storm', raw, (value) => value >= 3 && value <= 600, '3 to 600 seconds', 'playing the galaxy without a storm instead');
}

/** Parses a `?today=` value (a calendar date, `YYYY-MM-DD`), or warns and returns undefined. */
export function parseToday(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  if (isCalendarDate(raw)) return raw;
  warnIgnored('today', raw, 'a calendar date as YYYY-MM-DD', "using the device's date instead");
  return undefined;
}

/**
 * A run started with `?galaxy=`, `?seed=`, `?lives=` or `?storm=` is a debug run: it never writes the save. `?today=`
 * is not: a device clock can be set to any date as well.
 */
export function isDebugRun({ seed, startLives, galaxy, storm }: RunOverrides): boolean {
  return seed !== undefined || startLives !== undefined || galaxy !== undefined || storm !== undefined;
}

/** `def` with a gravity storm of intensity 2 added at `at` seconds, its events kept in time order. */
function withStorm(def: GalaxyDef, at: number): GalaxyDef {
  const events = [...def.events, { at, type: 'gravityStorm' as const, intensity: 2 as const }].sort((a, b) => a.at - b.at);
  return { ...def, events };
}

/**
 * The galaxy a run plays: `def`, with the `?storm=` storm added in e2e and dev builds. A release build returns `def` before
 * it reads the storm, so the injection is not in its bundle.
 */
export function playedGalaxy(def: GalaxyDef, storm: number | undefined): GalaxyDef {
  if (import.meta.env.MODE !== 'e2e' && !import.meta.env.DEV) return def;
  return storm === undefined ? def : withStorm(def, storm);
}

/**
 * The World seed a run plays on: a Daily's own (`daily`, null outside the Daily), else `?seed=` or the clock. A Daily's
 * date fixes its World, so a `?seed=` is ignored there, with a warning in e2e and dev builds.
 */
export function runSeed(seed: number | undefined, daily: number | null): number {
  if (daily === null) return seed ?? clockSeed();
  if (seed !== undefined && (import.meta.env.MODE === 'e2e' || import.meta.env.DEV)) {
    warnIgnored('seed', String(seed), 'left out of a Daily, whose date fixes its World seed', "playing the Daily's own seed instead");
  }
  return daily;
}

/** The `?seed=`, `?lives=`, `?quality=`, `?galaxy=`, `?storm=` and `?today=` overrides; only e2e and dev builds honour them, release builds never parse the URL. */
export function runOverrides(): RunOverrides {
  if (import.meta.env.MODE !== 'e2e' && !import.meta.env.DEV) return NO_OVERRIDES;
  const params = new URLSearchParams(window.location.search);
  return {
    seed: parseSeed(params.get('seed')),
    startLives: parseLives(params.get('lives')),
    quality: parseQuality(params.get('quality')),
    galaxy: parseGalaxy(params.get('galaxy')),
    storm: parseStorm(params.get('storm')),
    today: parseToday(params.get('today')),
  };
}

export function clockSeed(): number {
  return Date.now() >>> 0;
}
