import { QUALITY_LEVELS } from '../render/quality';
import { isStartLives, isWorldSeed, UINT32_MAX } from '../sim/world';

const DECIMAL_DIGITS = /^\d+$/;

/**
 * Tags every e2e query warning. Only the parsers below use it, so `check:no-bridge` can prove
 * the release build dropped them by finding it in `dist-e2e/` and not in `dist/`.
 */
export const E2E_QUERY_MARK = '__E2E_QUERY__';

/** The run settings an e2e build may take from the URL; undefined means use the normal value. */
export interface RunOverrides {
  readonly seed: number | undefined;
  readonly startLives: number | undefined;
  /** A quality level index (see QUALITY_LEVELS) to pin instead of adapting to frame time. */
  readonly quality: number | undefined;
}

const NO_OVERRIDES: RunOverrides = { seed: undefined, startLives: undefined, quality: undefined };

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
  console.warn(`${E2E_QUERY_MARK} Ignoring ?${name}=${raw}: it must be an integer from ${range}; ${fallback}`);
  return undefined;
}

/** Parses a `?seed=` value into a uint32 World seed, or warns and returns undefined. */
export function parseSeed(raw: string | null): number | undefined {
  return parseQueryInteger('seed', raw, isWorldSeed, `0 to ${String(UINT32_MAX)}`, 'using a time-based seed instead');
}

/** Parses a `?lives=` value into the run's starting lives (1–3), or warns and returns undefined. */
export function parseLives(raw: string | null): number | undefined {
  return parseQueryInteger('lives', raw, isStartLives, '1 to 3', 'starting with the default lives instead');
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

/** The `?seed=`, `?lives=` and `?quality=` overrides; only e2e and dev builds honour them, release builds never parse the URL. */
export function runOverrides(): RunOverrides {
  if (import.meta.env.MODE !== 'e2e' && !import.meta.env.DEV) return NO_OVERRIDES;
  const params = new URLSearchParams(window.location.search);
  return {
    seed: parseSeed(params.get('seed')),
    startLives: parseLives(params.get('lives')),
    quality: parseQuality(params.get('quality')),
  };
}

export function clockSeed(): number {
  return Date.now() >>> 0;
}
