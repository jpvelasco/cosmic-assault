import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed, hashString, mulberry32 } from '../../src/sim/rng';

const DRAWS = 10_000;

describe('mulberry32', () => {
  it('produces the pinned sequence for seed 1', () => {
    const next = mulberry32(1);
    expect(next()).toBe(0.6270739405881613);
    expect(next()).toBe(0.002735721180215478);
    expect(next()).toBe(0.5274470399599522);
  });
});

describe('createRng', () => {
  it('produces the pinned sequence for seed 42', () => {
    const rng = createRng(42);
    expect(rng.next()).toBe(0.6011037519201636);
    expect(rng.next()).toBe(0.44829055899754167);
  });

  it('gives identical sequences for the same seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('keeps range() within [min, max)', () => {
    const rng = createRng(3);
    for (let i = 0; i < DRAWS; i++) {
      const value = rng.range(-3, 5);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(5);
    }
  });

  it('returns only integers in [minInclusive, maxExclusive) from int() and hits every value', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < DRAWS; i++) {
      const value = rng.int(0, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(5);
      seen.add(value);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('makes chance(0) always false and chance(1) always true', () => {
    const rng = createRng(5);
    for (let i = 0; i < DRAWS; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('picks items from the given array', () => {
    const rng = createRng(9);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('throws a RangeError from pick() on an empty array', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow('pick() needs at least one item');
  });

  it('throws a RangeError from range() when max is not greater than min', () => {
    const rng = createRng(1);
    expect(() => rng.range(5, 5)).toThrow(RangeError);
    expect(() => rng.range(5, 3)).toThrow(/needs/);
    expect(() => rng.range(5, 3)).toThrow(
      'range() needs finite bounds with max > min (got min=5, max=3); swap or widen the bounds',
    );
  });

  it('throws a RangeError from range() on a non-finite bound', () => {
    const rng = createRng(1);
    expect(() => rng.range(0, NaN)).toThrow(RangeError);
    expect(() => rng.range(0, NaN)).toThrow(/needs/);
    expect(() => rng.range(-Infinity, 1)).toThrow(RangeError);
  });

  it('throws a RangeError from int() when maxExclusive is not greater than minInclusive', () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 5)).toThrow(RangeError);
    expect(() => rng.int(5, 5)).toThrow(/needs/);
    expect(() => rng.int(5, 3)).toThrow(RangeError);
    expect(() => rng.int(5, 3)).toThrow(
      'int() needs finite bounds with maxExclusive > minInclusive (got 5, 3); swap or widen the bounds',
    );
  });

  it('throws a RangeError from int() on a non-finite bound', () => {
    const rng = createRng(1);
    expect(() => rng.int(0, Infinity)).toThrow(RangeError);
    expect(() => rng.int(0, Infinity)).toThrow(/needs/);
  });

  it('throws a RangeError from int() on a non-integer bound', () => {
    const rng = createRng(1);
    expect(() => rng.int(0.5, 3)).toThrow(RangeError);
    expect(() => rng.int(0.5, 3)).toThrow(/needs/);
    expect(() => rng.int(0.5, 3)).toThrow(
      'int() needs integer bounds (got 0.5, 3); round the bounds before calling',
    );
  });

  it('throws a RangeError from createRng() on a non-integer seed', () => {
    for (const seed of [1.5, NaN, Infinity]) {
      expect(() => createRng(seed)).toThrow(RangeError);
    }
    expect(() => createRng(1.5)).toThrow(
      'createRng() needs an integer seed (got 1.5); round or hash the seed first',
    );
  });

  it('still accepts negative and out-of-range integer seeds', () => {
    expect(() => createRng(-1)).not.toThrow();
    expect(() => createRng(2 ** 32 + 5)).not.toThrow();
    expect(createRng(2 ** 32 + 5).next()).toBe(createRng(5).next());
  });

  it('throws a RangeError from chance() on an invalid probability', () => {
    const rng = createRng(1);
    for (const p of [NaN, -0.1, 1.1]) {
      expect(() => rng.chance(p)).toThrow(RangeError);
    }
    expect(() => rng.chance(1.1)).toThrow(
      'chance() needs a probability between 0 and 1 (got 1.1); clamp it first',
    );
  });

  it('pins the int() sequence for seed 42 over [0, 100)', () => {
    const rng = createRng(42);
    const values = Array.from({ length: 5 }, () => rng.int(0, 100));
    expect(values).toEqual([60, 44, 85, 66, 17]);
  });

  it('pins the pick() sequence for seed 42 over four items', () => {
    const rng = createRng(42);
    const values = Array.from({ length: 5 }, () => rng.pick(['a', 'b', 'c', 'd']));
    expect(values).toEqual(['c', 'b', 'd', 'c', 'a']);
  });
});

describe('hashString', () => {
  it('matches pinned FNV-1a values', () => {
    expect(hashString('spawn')).toBe(975326616);
    expect(hashString('loot')).toBe(3790556855);
    expect(hashString('fx')).toBe(1294124851);
  });

  it('returns the FNV-1a offset basis for the empty string', () => {
    expect(hashString('')).toBe(2166136261);
  });
});

describe('deriveSeed', () => {
  it('gives different seeds for different streams', () => {
    expect(deriveSeed(7, 'spawn')).not.toBe(deriveSeed(7, 'loot'));
  });

  it('is stable across calls', () => {
    expect(deriveSeed(7, 'spawn')).toBe(deriveSeed(7, 'spawn'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const seed = deriveSeed(-1, 'fx');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
