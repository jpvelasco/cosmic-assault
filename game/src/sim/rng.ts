export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(minInclusive: number, maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

const UINT32_RANGE = 4294967296;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function hashString(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME);
  }
  return hash >>> 0;
}

export function deriveSeed(seed: number, stream: string): number {
  return (seed ^ hashString(stream)) >>> 0;
}

function assertRangeBounds(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new RangeError(
      `range() needs finite bounds with max > min (got min=${String(min)}, max=${String(max)}); swap or widen the bounds`,
    );
  }
}

function intBoundsError(minInclusive: number, maxExclusive: number): RangeError {
  return new RangeError(
    `int() needs finite bounds with maxExclusive > minInclusive (got ${String(minInclusive)}, ${String(maxExclusive)}); swap or widen the bounds`,
  );
}

function assertIntBounds(minInclusive: number, maxExclusive: number): void {
  if (!Number.isFinite(minInclusive) || !Number.isFinite(maxExclusive)) {
    throw intBoundsError(minInclusive, maxExclusive);
  }
  if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
    throw new RangeError(
      `int() needs integer bounds (got ${String(minInclusive)}, ${String(maxExclusive)}); round the bounds before calling`,
    );
  }
  if (maxExclusive <= minInclusive) {
    throw intBoundsError(minInclusive, maxExclusive);
  }
}

function assertIntegerSeed(seed: number): void {
  if (!Number.isInteger(seed)) {
    throw new RangeError(
      `createRng() needs an integer seed (got ${String(seed)}); round or hash the seed first`,
    );
  }
}

function assertProbability(p: number): void {
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(
      `chance() needs a probability between 0 and 1 (got ${String(p)}); clamp it first`,
    );
  }
}

export function createRng(seed: number): Rng {
  assertIntegerSeed(seed);
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => {
      assertRangeBounds(min, max);
      return min + next() * (max - min);
    },
    int: (minInclusive, maxExclusive) => {
      assertIntBounds(minInclusive, maxExclusive);
      return minInclusive + Math.floor(next() * (maxExclusive - minInclusive));
    },
    chance: (p) => {
      assertProbability(p);
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('pick() needs at least one item');
      }
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
