import { describe, expect, it } from 'vitest';
import { ceilingFor, LONG_FRAME_HEADROOM, MIN_READINGS, P95_HEADROOM, PERF_CEILINGS, PERF_READINGS } from '../../e2e/perfThresholds';

describe('ceilingFor', () => {
  it('allows p95 up to 1.25 times the worst reading, and long frames up to the most plus 2', () => {
    expect([P95_HEADROOM, LONG_FRAME_HEADROOM]).toEqual([1.25, 2]);
    const ceiling = ceilingFor([
      { p95Ms: 30, longFrames: 1 },
      { p95Ms: 40, longFrames: 4 },
      { p95Ms: 36, longFrames: 2 },
    ]);
    expect(ceiling).toEqual({ p95Ms: 50, longFrames: 6 });
  });

  it('rounds the p95 ceiling to a tenth of a millisecond', () => {
    expect(ceilingFor([{ p95Ms: 33.33, longFrames: 0 }, { p95Ms: 1, longFrames: 0 }, { p95Ms: 2, longFrames: 0 }]).p95Ms).toBe(41.7);
  });

  it('refuses fewer readings than it needs, saying to record more', () => {
    expect(() => ceilingFor([{ p95Ms: 30, longFrames: 0 }, { p95Ms: 30, longFrames: 0 }])).toThrow(/at least 3 readings \(got 2\); record more runs/);
  });
});

describe('the perf ceilings', () => {
  it.each(Object.entries(PERF_READINGS))('come from at least three real readings of the %s scene', (scene, readings) => {
    expect(readings.length).toBeGreaterThanOrEqual(MIN_READINGS);
    for (const { p95Ms, longFrames } of readings) {
      expect(p95Ms, scene).toBeGreaterThan(0);
      expect(Number.isInteger(longFrames) && longFrames >= 0, scene).toBe(true);
    }
    expect(PERF_CEILINGS[scene as keyof typeof PERF_CEILINGS]).toEqual(ceilingFor(readings));
  });
});
