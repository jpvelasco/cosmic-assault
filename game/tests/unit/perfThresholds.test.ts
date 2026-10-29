import { describe, expect, it } from 'vitest';
import { ceilingBreaches, ceilingFor, frameReport, LONG_FRAME_HEADROOM, MIN_READINGS, P95_HEADROOM, PERF_CEILINGS, PERF_READINGS, SLOW_SHARE_FLOOR, SLOW_SHARE_HEADROOM, SLOW_SHARE_READINGS, slowShareCeilingFor, type SceneCeiling } from '../../e2e/perfThresholds';

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

  // The same commit has read 21.75 ms and, an hour later, 29.5 ms, so a ceiling needs readings from several windows of
  // runner time; eight, over hours, is the rule.
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

describe('slowShareCeilingFor', () => {
  const eight = (worst: number): number[] => [worst, ...Array<number>(MIN_READINGS - 1).fill(0)];

  it('allows 1.25 times the worst share, rounded up to a hundredth of a percent', () => {
    expect(SLOW_SHARE_HEADROOM).toBe(1.25);
    expect(slowShareCeilingFor([0.02, 0.031, 0.04, 0.012, 0.03, 0.01, 0.025, 0.033])).toBe(0.05);
    expect(slowShareCeilingFor(eight(0.0123))).toBe(0.0173);
    expect(slowShareCeilingFor(eight(0.1970554926387316))).toBe(0.2464);
  });

  it('allows a floor of 0.5 points over a worst that is near zero, so one slow frame does not fail the gate', () => {
    expect(SLOW_SHARE_FLOOR).toBe(0.005);
    expect(slowShareCeilingFor(eight(0))).toBe(0.005);
    expect(slowShareCeilingFor(eight(0.0028))).toBe(0.0078);
  });

  it('never rounds under the worst plus the floor', () => {
    for (const worst of [0, 0.0001, 0.0028, 0.01, 0.0133, 0.02, 0.0399, 0.1]) {
      expect(slowShareCeilingFor(eight(worst)) ?? 0, String(worst)).toBeGreaterThanOrEqual(worst + SLOW_SHARE_FLOOR - 1e-12);
    }
  });

  it('sets no ceiling for a scene with no readings yet', () => {
    expect(slowShareCeilingFor([])).toBeNull();
  });

  it.each(Array.from({ length: MIN_READINGS - 1 }, (_, i) => i + 1))('refuses a partial calibration of %i readings, saying to record more', (count) => {
    expect(() => slowShareCeilingFor(Array<number>(count).fill(0.01))).toThrow(new RegExp(`at least 8 readings \\(got ${String(count)}\\); record more runs`));
  });
});

/** Frame stats of a run with `p95` ms, `longFrames` and `slowShare`. */
function stats(p95: number, longFrames: number, slowShare: number): CosmicAssaultTestState['frameStats'] {
  return { count: 900, p50: 16, p95, longFrames, slowShare };
}

const CEILING: SceneCeiling = { p95Ms: 30, longFrames: 2, slowShare: 0.1 };

describe('ceilingBreaches', () => {
  it('passes a run at every ceiling', () => {
    expect(ceilingBreaches(stats(30, 2, 0.1), CEILING)).toEqual([]);
  });

  it('names each ceiling a run is over, and the file that sets it', () => {
    const breaches = ceilingBreaches(stats(30.25, 3, 0.11), CEILING);
    expect(breaches).toHaveLength(3);
    expect(breaches[0]).toMatch(/p95 frame time 30\.25 ms is over its 30 ms ceiling/);
    expect(breaches[1]).toMatch(/3 long frames are over the ceiling of 2/);
    expect(breaches[2]).toMatch(/slow-frame share 0\.11 is over its 0\.1 ceiling/);
    for (const breach of breaches) expect(breach).toContain('e2e/perfThresholds.ts');
  });

  it('holds a calibrated scene to its slow-frame share alone', () => {
    expect(ceilingBreaches(stats(20, 0, 0.1001), CEILING)).toEqual([expect.stringMatching(/slow-frame share/)]);
  });

  it('asserts nothing new for a scene whose slow-frame share is not calibrated yet', () => {
    expect(ceilingBreaches(stats(20, 0, 1), { ...CEILING, slowShare: null })).toEqual([]);
    expect(ceilingBreaches(stats(31, 0, 1), { ...CEILING, slowShare: null })).toHaveLength(1);
  });
});

describe('frameReport', () => {
  it('records the ceiling, the frame stats with the slow-frame share, and the breaches, in that order', () => {
    const report = frameReport(stats(31, 0, 0.25), CEILING);
    expect(Object.keys(report)).toEqual(['ceiling', 'count', 'p50', 'p95', 'longFrames', 'slowShare', 'breaches']);
    expect(report).toMatchObject({ ceiling: CEILING, p95: 31, slowShare: 0.25 });
    expect(report.breaches).toEqual(ceilingBreaches(stats(31, 0, 0.25), CEILING));
  });

  it('records an uncalibrated slow-frame ceiling as null', () => {
    expect(frameReport(stats(20, 0, 0.25), { ...CEILING, slowShare: null }).ceiling.slowShare).toBeNull();
  });
});

describe('the slow-frame share ceilings', () => {
  it.each(Object.entries(SLOW_SHARE_READINGS))('come from at least eight real readings of the %s scene', (scene, shares) => {
    expect(shares.length, scene).toBeGreaterThanOrEqual(MIN_READINGS);
    for (const share of shares) expect(share >= 0 && share <= 1, scene).toBe(true);
  });

  it.each(Object.keys(PERF_CEILINGS) as (keyof typeof PERF_CEILINGS)[])('are the %s scene ceiling, next to its p95 and long-frame ceilings', (scene) => {
    expect(PERF_CEILINGS[scene]).toEqual({ ...ceilingFor(PERF_READINGS[scene]), slowShare: slowShareCeilingFor(SLOW_SHARE_READINGS[scene]) });
  });
});
