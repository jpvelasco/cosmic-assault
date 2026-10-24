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
});

describe('hashString', () => {
  it('matches pinned FNV-1a values', () => {
    expect(hashString('spawn')).toBe(975326616);
    expect(hashString('loot')).toBe(3790556855);
    expect(hashString('fx')).toBe(1294124851);
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
