import { describe, expect, it } from 'vitest';
import { visualScaleFor } from '../../src/render/visualScale';

const UNIT = { ship: 1, rock: 1, shot: 1, effect: 1 };

describe('visualScaleFor', () => {
  it('leaves sprites at their size on screens at or above the reference scale', () => {
    expect(visualScaleFor(1.5)).toEqual(UNIT);
    expect(visualScaleFor(0.85)).toEqual(UNIT);
  });

  it('enlarges ship, shot and effects by the shortfall, and rocks by half as much', () => {
    const v = visualScaleFor(0.85 / 1.2);
    expect(v.ship).toBeCloseTo(1.2);
    expect(v.shot).toBeCloseTo(1.2);
    expect(v.effect).toBeCloseTo(1.2);
    expect(v.rock).toBeCloseTo(1.1);
  });

  it('caps a phone-sized scale at 1.4 for the ship and 1.2 for rocks', () => {
    for (const cssPerUnit of [390 / 720, 0.3]) {
      const v = visualScaleFor(cssPerUnit);
      expect(v.ship).toBeCloseTo(1.4);
      expect(v.rock).toBeCloseTo(1.2);
    }
  });

  it('falls back to no scaling for NaN and non-positive input', () => {
    for (const bad of [Number.NaN, 0, -1, Number.NEGATIVE_INFINITY]) expect(visualScaleFor(bad)).toEqual(UNIT);
  });
});
