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
}

const NO_OVERRIDES: RunOverrides = { seed: undefined, startLives: undefined };

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

/** The `?seed=` and `?lives=` overrides; only e2e builds honour them, release builds never parse the URL. */
export function runOverrides(): RunOverrides {
  if (import.meta.env.MODE !== 'e2e') return NO_OVERRIDES;
  const params = new URLSearchParams(window.location.search);
  return { seed: parseSeed(params.get('seed')), startLives: parseLives(params.get('lives')) };
}

export function clockSeed(): number {
  return Date.now() >>> 0;
}
