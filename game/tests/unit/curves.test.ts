import { describe, expect, it } from 'vitest';
import { kindProbability, rockSpeedMultiplier, sawtooth, spawnInterval, threatBudget } from '../../src/content/curves';

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
  it('grows from 8 by 6 per tier', () => {
    expect(threatBudget(0)).toBe(8);
    expect(threatBudget(2.5)).toBe(23);
    expect(threatBudget(5)).toBe(38);
  });

  it('stays within 8 to 40', () => {
    expect(threatBudget(-1)).toBe(8);
    expect(threatBudget(10)).toBe(40);
  });
});

describe('rockSpeedMultiplier', () => {
  it('adds 8% per tier', () => {
    expect(rockSpeedMultiplier(0)).toBe(1);
    expect(rockSpeedMultiplier(2.5)).toBeCloseTo(1.2, 10);
    expect(rockSpeedMultiplier(5)).toBeCloseTo(1.4, 10);
  });

  it('stays within the tiers the game has', () => {
    expect(rockSpeedMultiplier(-2)).toBe(1);
    expect(rockSpeedMultiplier(50)).toBeCloseTo(1.4, 10);
  });
});

describe('kindProbability', () => {
  const ramp = { from: 1, base: 0.1, step: 0.05, max: 0.4 };

  it('holds the base until the ramp starts, then climbs by step per tier', () => {
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
  it('eases the first galaxy of every Dimension after the first to 0.85', () => {
    expect(sawtooth({ index: 1, dimension: 2 })).toBe(0.85);
    expect(sawtooth({ index: 1, dimension: 5 })).toBe(0.85);
  });

  it('leaves everything else at 1', () => {
    expect(sawtooth({ index: 1, dimension: 1 })).toBe(1);
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
