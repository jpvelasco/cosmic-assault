import { isWorldSeed, UINT32_MAX } from '../sim/world';

const DECIMAL_DIGITS = /^\d+$/;

/** Parses a `?seed=` value into a uint32 World seed, or warns and returns undefined. */
export function parseSeed(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const seed = DECIMAL_DIGITS.test(raw) ? Number(raw) : Number.NaN;
  if (isWorldSeed(seed)) return seed;
  console.warn(
    `Ignoring ?seed=${raw}: it must be an integer from 0 to ${String(UINT32_MAX)}; using a time-based seed instead`,
  );
  return undefined;
}

/** The `?seed=` override; only e2e builds honour it, release builds always use the clock. */
export function seedOverride(): number | undefined {
  if (import.meta.env.MODE !== 'e2e') return undefined;
  return parseSeed(new URLSearchParams(window.location.search).get('seed'));
}

export function clockSeed(): number {
  return Date.now() >>> 0;
}
