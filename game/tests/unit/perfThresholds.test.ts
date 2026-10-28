import { describe, expect, it } from 'vitest';
import { ceilingFor, LONG_FRAME_HEADROOM, MIN_READINGS, P95_HEADROOM, PERF_READINGS } from '../../e2e/perfThresholds';

/** `n` readings of `p95Ms` each, with no long frames. */
function readings(n: number, p95Ms = 30): { p95Ms: number; longFrames: number }[] {
  return Array.from({ length: n }, () => ({ p95Ms, longFrames: 0 }));
}

describe('ceilingFor', () => {
  it('allows p95 up to 1.25 times the worst reading, and long frames up to the most plus 2', () => {
    expect([P95_HEADROOM, LONG_FRAME_HEADROOM]).toEqual([1.25, 2]);
    const ceiling = ceilingFor([...readings(MIN_READINGS - 3), { p95Ms: 30, longFrames: 1 }, { p95Ms: 40, longFrames: 4 }, { p95Ms: 36, longFrames: 2 }]);
    expect(ceiling).toEqual({ p95Ms: 50, longFrames: 6 });
  });

  it('rounds the p95 ceiling to a tenth of a millisecond', () => {
    expect(ceilingFor([{ p95Ms: 33.33, longFrames: 0 }, ...readings(MIN_READINGS - 1, 1)]).p95Ms).toBe(41.7);
  });

  it('refuses fewer readings than it needs, saying to record more', () => {
    expect(() => ceilingFor(readings(7))).toThrow(/at least 8 readings \(got 7\); record more runs/);
  });

  // One window of runner time once gave 20-21.75 ms where the same build later read 29.5 ms, so a ceiling needs readings
  // from several windows; eight is the fewest that has held so far.
  it('needs eight readings, enough to span more than one window of runner speed', () => {
    expect(MIN_READINGS).toBe(8);
  });
});

describe('the perf ceilings', () => {
  it.each(Object.entries(PERF_READINGS))('come from at least MIN_READINGS real readings of the %s scene', (scene, readings) => {
    expect(readings.length).toBeGreaterThanOrEqual(MIN_READINGS);
    for (const { p95Ms, longFrames } of readings) {
      expect(p95Ms, scene).toBeGreaterThan(0);
      expect(Number.isInteger(longFrames) && longFrames >= 0, scene).toBe(true);
    }
  });
});
