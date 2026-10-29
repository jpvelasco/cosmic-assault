/** The scenes the perf spec measures. */
export type PerfScene = 'field' | 'bossFight';

/** What one run of a perf scene measured: its 95th-percentile frame time, and its frames of `LONG_FRAME_MS` or more. */
export interface FrameReading {
  readonly p95Ms: number;
  readonly longFrames: number;
}

/** A scene's p95 and long-frame ceilings: a run fails past either. */
export type FrameCeiling = FrameReading;

/**
 * Every ceiling of a scene: its p95 and long-frame ceilings, and the most of its frames that may be slow (over 1.5
 * display intervals, `slowShare` in src/testApi.d.ts); `slowShare` is null until SLOW_SHARE_READINGS calibrates the
 * scene, and asserts nothing until then.
 */
export interface SceneCeiling extends FrameCeiling {
  readonly slowShare: number | null;
}

/** The frame stats the perf spec reads at the end of a scene. */
type FrameStats = CosmicAssaultTestState['frameStats'];

/** A run's p95 may reach this many times the worst p95 its scene's readings hold. */
export const P95_HEADROOM = 1.25;
/** A run may have this many long frames more than the most its scene's readings hold. */
export const LONG_FRAME_HEADROOM = 2;
/** A run's share of slow frames may reach this many times the worst share its scene's readings hold. */
export const SLOW_SHARE_HEADROOM = 1.25;
/**
 * Readings a ceiling needs before it means anything. A scene's p95 sits near the display's frame step, so a runner a
 * little slower tips it past the step: the same commit has read about 25% slower an hour later, and fewer readings than
 * this, from fewer windows, would let one fast window set a ceiling the next slow one fails.
 */
export const MIN_READINGS = 8;

function requireReadings(count: number): void {
  if (count < MIN_READINGS) {
    throw new RangeError(`A frame-time ceiling needs at least ${String(MIN_READINGS)} readings (got ${String(count)}); record more runs of the perf job first`);
  }
}

/** The ceilings `readings` allow: p95 at most P95_HEADROOM times the worst, long frames at most the most plus LONG_FRAME_HEADROOM. */
export function ceilingFor(readings: readonly FrameReading[]): FrameCeiling {
  requireReadings(readings.length);
  const worst = (pick: (reading: FrameReading) => number): number => Math.max(...readings.map(pick));
  return { p95Ms: Math.round(P95_HEADROOM * worst((r) => r.p95Ms) * 10) / 10, longFrames: worst((r) => r.longFrames) + LONG_FRAME_HEADROOM };
}

/**
 * The readings each scene's ceiling comes from, under the perf project's 4x CPU slowdown: eight runs of the CI `perf`
 * job on GitHub's `ubuntu-24.04` runners over five hours, across three commits of one feature branch. The first three
 * predate a renderer change; the other five, which hold every maximum, are of today's renderer. Recalibrate the same way
 * (eight runs, over hours, not minutes) when a scene's content or the renderer changes.
 */
export const PERF_READINGS: Readonly<Record<PerfScene, readonly FrameReading[]>> = {
  field: [
    { p95Ms: 21.75, longFrames: 0 },
    { p95Ms: 20.25, longFrames: 0 },
    { p95Ms: 20, longFrames: 0 },
    { p95Ms: 21.75, longFrames: 0 },
    { p95Ms: 25.75, longFrames: 0 },
    { p95Ms: 28, longFrames: 1 },
    { p95Ms: 29.5, longFrames: 0 },
    { p95Ms: 21, longFrames: 0 },
  ],
  bossFight: [
    { p95Ms: 17.25, longFrames: 0 },
    { p95Ms: 17.25, longFrames: 0 },
    { p95Ms: 17.25, longFrames: 0 },
    { p95Ms: 17.25, longFrames: 0 },
    { p95Ms: 21, longFrames: 0 },
    { p95Ms: 21, longFrames: 0 },
    { p95Ms: 21.75, longFrames: 0 },
    { p95Ms: 18, longFrames: 0 },
  ],
};

/** The slow-frame share ceiling `shares` allow, SLOW_SHARE_HEADROOM times the worst to a hundredth of a percent; null with no shares yet. */
export function slowShareCeilingFor(shares: readonly number[]): number | null {
  if (shares.length === 0) return null;
  requireReadings(shares.length);
  return Math.round(SLOW_SHARE_HEADROOM * Math.max(...shares) * 10000) / 10000;
}

/**
 * The slow-frame shares each scene's ceiling comes from, read from `slowShare` in the CI `perf` job's perf.json under
 * the same 4x CPU slowdown. None are recorded yet, so no scene's share is asserted: record eight runs spread over six
 * hours or more, as for PERF_READINGS, and the ceiling holds from then on.
 */
export const SLOW_SHARE_READINGS: Readonly<Record<PerfScene, readonly number[]>> = {
  field: [],
  bossFight: [],
};

function sceneCeiling(scene: PerfScene): SceneCeiling {
  return { ...ceilingFor(PERF_READINGS[scene]), slowShare: slowShareCeilingFor(SLOW_SHARE_READINGS[scene]) };
}

/** Each scene's ceilings, from its readings. */
export const PERF_CEILINGS: Readonly<Record<PerfScene, SceneCeiling>> = { field: sceneCeiling('field'), bossFight: sceneCeiling('bossFight') };

/** Each of `ceiling` that `stats` is over, said with the figure, its ceiling and the file that sets it; empty within all. */
export function ceilingBreaches({ p95, longFrames, slowShare }: FrameStats, ceiling: SceneCeiling): string[] {
  const breaches: string[] = [];
  if (p95 > ceiling.p95Ms) breaches.push(`p95 frame time ${String(p95)} ms is over its ${String(ceiling.p95Ms)} ms ceiling`);
  if (longFrames > ceiling.longFrames) breaches.push(`${String(longFrames)} long frames are over the ceiling of ${String(ceiling.longFrames)}`);
  if (ceiling.slowShare !== null && slowShare > ceiling.slowShare) breaches.push(`slow-frame share ${String(slowShare)} is over its ${String(ceiling.slowShare)} ceiling`);
  return breaches.map((breach) => `${breach} (e2e/perfThresholds.ts)`);
}

/** A scene's frame figures as perf.json records them: its ceilings, its frame stats and the ceilings they break. */
export function frameReport(stats: FrameStats, ceiling: SceneCeiling): { readonly ceiling: SceneCeiling; readonly breaches: readonly string[] } & FrameStats {
  return { ceiling, ...stats, breaches: ceilingBreaches(stats, ceiling) };
}
