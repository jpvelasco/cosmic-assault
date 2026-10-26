import { describe, expect, it } from 'vitest';
import { clearReport, Combo, COMBO_WINDOW_SECONDS, comboMultiplier, dimensionMultiplier, starsFor } from '../../src/sim/scoring';

describe('comboMultiplier', () => {
  it.each([
    [0, 1],
    [4, 1],
    [5, 2],
    [9, 2],
    [10, 3],
    [19, 4],
    [20, 5],
    [99, 5],
  ])('a combo of %i multiplies by %i', (combo, multiplier) => {
    expect(comboMultiplier(combo)).toBe(multiplier);
  });
});

describe('Combo', () => {
  it('chains kills inside the 2.2 s window and steps the multiplier every 5 kills', () => {
    const combo = new Combo();
    const multipliers = Array.from({ length: 12 }, (_, i) => combo.kill(i * 2));
    expect(multipliers).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3]);
    expect(combo.count).toBe(12);
    expect(combo.multiplier).toBe(3);
  });

  it('starts a new chain when a kill comes after the window', () => {
    const combo = new Combo();
    for (let i = 0; i < 6; i++) combo.kill(i);
    expect(combo.multiplier).toBe(2);
    expect(combo.kill(5 + COMBO_WINDOW_SECONDS + 0.01)).toBe(1);
    expect(combo.count).toBe(1);
  });

  it('lapses once the window passes without a kill', () => {
    const combo = new Combo();
    for (let i = 0; i < 5; i++) combo.kill(i);
    combo.expire(4 + COMBO_WINDOW_SECONDS - 0.01);
    expect(combo.count).toBe(5);
    combo.expire(4 + COMBO_WINDOW_SECONDS + 0.01);
    expect(combo.count).toBe(0);
    expect(combo.multiplier).toBe(1);
  });

  it('resets on a death', () => {
    const combo = new Combo();
    for (let i = 0; i < 7; i++) combo.kill(i * 0.1);
    combo.reset();
    expect(combo.count).toBe(0);
    expect(combo.multiplier).toBe(1);
  });
});

describe('starsFor', () => {
  it.each([
    [0, 3],
    [1, 2],
    [2, 1],
    [7, 1],
  ] as const)('%i deaths earn %i stars', (deaths, stars) => {
    expect(starsFor(deaths)).toBe(stars);
  });
});

describe('dimensionMultiplier', () => {
  it('adds a tenth per Dimension after the first', () => {
    const expected = [1, 1.1, 1.2, 1.3, 1.4];
    ([1, 2, 3, 4, 5] as const).forEach((d, i) => {
      expect(dimensionMultiplier(d)).toBeCloseTo(expected[i] ?? 0, 10);
    });
  });
});

describe('clearReport', () => {
  it('pays 250 per Dimension to clear, and 500 per Dimension more without a death', () => {
    expect(clearReport({ score: 1000, deaths: 0, dimension: 3, mode: 'free' })).toEqual({ score: 1000 + 750 + 1500, bonus: 2250, deaths: 0, stars: 3 });
    expect(clearReport({ score: 1000, deaths: 1, dimension: 3, mode: 'free' })).toEqual({ score: 1750, bonus: 750, deaths: 1, stars: 2 });
    expect(clearReport({ score: 0, deaths: 4, dimension: 1, mode: 'free' })).toEqual({ score: 250, bonus: 250, deaths: 4, stars: 1 });
  });

  it('multiplies the total by the Dimension multiplier in Rank only, rounded', () => {
    expect(clearReport({ score: 1235, deaths: 0, dimension: 4, mode: 'rank' }).score).toBe(Math.round((1235 + 1000 + 2000) * 1.3));
    expect(clearReport({ score: 1235, deaths: 0, dimension: 4, mode: 'free' }).score).toBe(1235 + 1000 + 2000);
    expect(clearReport({ score: 1235, deaths: 0, dimension: 1, mode: 'rank' }).score).toBe(1235 + 250 + 500);
  });

  it('keeps the bonus the raw clear and no-death bonus, before the Rank multiplier', () => {
    expect(clearReport({ score: 100, deaths: 0, dimension: 2, mode: 'rank' }).bonus).toBe(1500);
  });
});
