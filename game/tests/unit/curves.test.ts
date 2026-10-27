import { describe, expect, it } from 'vitest';
import { dropChance, kindProbability, rockSpeedMultiplier, sawtooth, spawnInterval, threatBudget } from '../../src/content/curves';

describe('spawnInterval', () => {
  it('shrinks from 2.4 s by 0.82 per tier', () => {
    expect(spawnInterval(0)).toBeCloseTo(2.4, 10);
    expect(spawnInterval(2.5)).toBeCloseTo(2.4 * 0.82 ** 2.5, 10);
    expect(spawnInterval(5)).toBeCloseTo(2.4 * 0.82 ** 5, 10);
  });

  it('stays within 0.7 to 2.4 s', () => {
    expect(spawnInterval(-3)).toBe(2.4);
    expect(spawnInterval(100)).toBe(0.7);
  });
});

describe('threatBudget', () => {
  it('grows from 12 by 3.5 per tier', () => {
    expect(threatBudget(0)).toBe(12);
    expect(threatBudget(2.5)).toBe(20.75);
    expect(threatBudget(5)).toBe(29.5);
  });

  it('stays within 12 to 40', () => {
    expect(threatBudget(-1)).toBe(12);
    expect(threatBudget(10)).toBe(40);
  });
});

describe('rockSpeedMultiplier', () => {
  it('adds 5% per tier', () => {
    expect(rockSpeedMultiplier(0)).toBe(1);
    expect(rockSpeedMultiplier(2.5)).toBeCloseTo(1.125, 10);
    expect(rockSpeedMultiplier(5)).toBeCloseTo(1.25, 10);
  });

  it('stays within the tiers the game has', () => {
    expect(rockSpeedMultiplier(-2)).toBe(1);
    expect(rockSpeedMultiplier(50)).toBeCloseTo(1.25, 10);
  });
});

describe('kindProbability', () => {
  const ramp = { from: 1, base: 0.1, step: 0.05, max: 0.4 };

  it('holds the base below `from`, then climbs by step per tier past it, up to max', () => {
    expect(kindProbability(ramp, 0)).toBeCloseTo(0.1, 10);
    expect(kindProbability(ramp, 1)).toBeCloseTo(0.1, 10);
    expect(kindProbability(ramp, 2.5)).toBeCloseTo(0.175, 10);
    expect(kindProbability(ramp, 5)).toBeCloseTo(0.3, 10);
  });

  it('never exceeds max', () => {
    expect(kindProbability(ramp, 100)).toBe(0.4);
  });

  it('is clamped to 0 or more', () => {
    expect(kindProbability({ from: 0, base: -0.5, step: 0, max: 1 }, 0)).toBe(0);
  });
});

describe('sawtooth', () => {
  it('eases the first galaxy of every Dimension, the first included, to 0.85', () => {
    expect(sawtooth({ index: 1, dimension: 1 })).toBe(0.85);
    expect(sawtooth({ index: 1, dimension: 2 })).toBe(0.85);
    expect(sawtooth({ index: 1, dimension: 5 })).toBe(0.85);
  });

  it('leaves everything else at 1', () => {
    expect(sawtooth({ index: 2, dimension: 1 })).toBe(1);
    expect(sawtooth({ index: 2, dimension: 2 })).toBe(1);
    expect(sawtooth({ index: 6, dimension: 5 })).toBe(1);
  });
});

describe('non-finite input', () => {
  it.each([Number.NaN, Infinity, -Infinity])('throws a RangeError that says what to pass for %s', (bad) => {
    for (const curve of [spawnInterval, threatBudget, rockSpeedMultiplier]) {
      expect(() => curve(bad)).toThrow(RangeError);
      expect(() => curve(bad)).toThrow(/finite/);
    }
    expect(() => kindProbability({ from: 0, base: 0.1, step: 0, max: 1 }, bad)).toThrow(RangeError);
  });

  it('rejects a ramp with a non-finite field', () => {
    expect(() => kindProbability({ from: 0, base: Number.NaN, step: 0, max: 1 }, 1)).toThrow(RangeError);
  });

  it.each(['from', 'base', 'step', 'max'] as const)('names the invalid ramp field %s and the allowed range', (field) => {
    const ramp = { from: 0, base: 0.1, step: 0, max: 1, [field]: Number.POSITIVE_INFINITY };
    expect(() => kindProbability(ramp, 1)).toThrow(new RegExp(`ramp\\.${field} .*finite.*got Infinity`));
    expect(() => kindProbability(ramp, 1)).not.toThrow(/tier/);
  });
});

describe('dropChance', () => {
  it('starts at 6% and adds 1% per tier', () => {
    expect(dropChance(0)).toBeCloseTo(0.06, 10);
    expect(dropChance(2.5)).toBeCloseTo(0.085, 10);
    expect(dropChance(5)).toBeCloseTo(0.11, 10);
  });

  it('is capped at 12% and never below 6%', () => {
    expect(dropChance(6)).toBeCloseTo(0.12, 10);
    expect(dropChance(100)).toBe(0.12);
    expect(dropChance(-3)).toBe(0.06);
  });

  it('refuses a tier that is not a number', () => {
    expect(() => dropChance(Number.NaN)).toThrow(RangeError);
  });
});
