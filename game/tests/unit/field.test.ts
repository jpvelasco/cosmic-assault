import { describe, expect, it } from 'vitest';
import { fieldForViewport } from '../../src/sim/field';

describe('fieldForViewport', () => {
  it('keeps a 16:9 viewport at 1280x720', () => {
    expect(fieldForViewport(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('keeps a phone-landscape aspect inside the clamp', () => {
    const field = fieldForViewport(844, 390);
    expect(field.width).toBeCloseTo((720 * 844) / 390, 9);
    expect(field.height).toBe(720);
  });

  it('clamps a square viewport to 4:3', () => {
    expect(fieldForViewport(800, 800).width).toBe(960);
  });

  it('clamps an ultrawide viewport to 21:9', () => {
    expect(fieldForViewport(3440, 1000).width).toBe(1680);
  });

  it('throws a RangeError on a zero size', () => {
    expect(() => fieldForViewport(0, 720)).toThrow(RangeError);
    expect(() => fieldForViewport(0, 720)).toThrow(
      'fieldForViewport() needs positive finite sizes (got 0×720); wait for layout before sizing the field',
    );
  });

  it('throws a RangeError on a non-finite size', () => {
    expect(() => fieldForViewport(1280, NaN)).toThrow(RangeError);
    expect(() => fieldForViewport(1280, NaN)).toThrow(
      'fieldForViewport() needs positive finite sizes (got 1280×NaN); wait for layout before sizing the field',
    );
  });
});
