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

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (minInclusive, maxExclusive) => minInclusive + Math.floor(next() * (maxExclusive - minInclusive)),
    chance: (p) => next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('pick() needs at least one item');
      }
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
