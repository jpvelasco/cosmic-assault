/** The scenes the perf spec measures. */
export type PerfScene = 'field' | 'bossFight';

/** What one run of a perf scene measured: its 95th-percentile frame time, and its frames of `LONG_FRAME_MS` or more. */
export interface FrameReading {
  readonly p95Ms: number;
  readonly longFrames: number;
}

/** A scene's ceilings: a run fails past either. */
export type FrameCeiling = FrameReading;

/** A run's p95 may reach this many times the worst p95 its scene's readings hold. */
export const P95_HEADROOM = 1.25;
/** A run may have this many long frames more than the most its scene's readings hold. */
export const LONG_FRAME_HEADROOM = 2;
/** Readings a ceiling needs before it means anything: fewer than this would let one lucky run set it. */
export const MIN_READINGS = 3;

/** The ceilings `readings` allow: p95 at most P95_HEADROOM times the worst, long frames at most the most plus LONG_FRAME_HEADROOM. */
export function ceilingFor(readings: readonly FrameReading[]): FrameCeiling {
  if (readings.length < MIN_READINGS) {
    throw new RangeError(`A frame-time ceiling needs at least ${String(MIN_READINGS)} readings (got ${String(readings.length)}); record more runs of the perf job first`);
  }
  const worst = (pick: (reading: FrameReading) => number): number => Math.max(...readings.map(pick));
  return { p95Ms: Math.round(P95_HEADROOM * worst((r) => r.p95Ms) * 10) / 10, longFrames: worst((r) => r.longFrames) + LONG_FRAME_HEADROOM };
}

/**
 * The readings each scene's ceiling comes from, under the perf project's 4x CPU slowdown. Calibrated from CI runs; see
 * ledger. Until those are recorded these are provisional: three quiet runs, one at a time, on a 16-vCPU cloud host,
 * where both scenes hold the display's 60 Hz, so the ceilings they give are far tighter than a CI runner meets.
 */
export const PERF_READINGS: Readonly<Record<PerfScene, readonly FrameReading[]>> = {
  field: [
    { p95Ms: 18, longFrames: 0 },
    { p95Ms: 18.25, longFrames: 0 },
    { p95Ms: 18, longFrames: 0 },
  ],
  bossFight: [
    { p95Ms: 17, longFrames: 0 },
    { p95Ms: 17, longFrames: 0 },
    { p95Ms: 17, longFrames: 0 },
  ],
};

/** Each scene's ceilings, from its readings. */
export const PERF_CEILINGS: Readonly<Record<PerfScene, FrameCeiling>> = {
  field: ceilingFor(PERF_READINGS.field),
  bossFight: ceilingFor(PERF_READINGS.bossFight),
};
