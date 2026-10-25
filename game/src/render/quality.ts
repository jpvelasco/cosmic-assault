/** One rung of the quality ladder: what a frame costs at this level. */
export interface QualityLevel {
  readonly name: 'high' | 'medium' | 'low' | 'lowest';
  /** Most device pixels per CSS pixel the canvas backing store may use. */
  readonly dprCap: number;
  /** Multiplier on the glow sprites' alpha. */
  readonly glow: number;
  /** Particle pool size. */
  readonly particles: number;
  /** Multiplier on the star count. */
  readonly starScale: number;
  readonly vignette: boolean;
}

/** The richest level, which a renderer uses until told otherwise. */
export const HIGH_QUALITY: QualityLevel = { name: 'high', dprCap: 2, glow: 1, particles: 400, starScale: 1, vignette: true };

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  HIGH_QUALITY,
  { name: 'medium', dprCap: 1.5, glow: 0.8, particles: 240, starScale: 0.75, vignette: true },
  { name: 'low', dprCap: 1.25, glow: 0.6, particles: 120, starScale: 0.5, vignette: false },
  { name: 'lowest', dprCap: 1, glow: 0.4, particles: 60, starScale: 0.35, vignette: false },
];

const LOWEST = QUALITY_LEVELS.length - 1;
/** From this level down the page drops costly effects of its own, such as backdrop blur (the `lite` body class). */
export const LITE_FROM_INDEX = 2;

/** Frame time at the start of a run is skipped by the scaler and the monitor: sprites bake and the JIT warms up then. */
export const WARMUP_MS = 3000;
/** Frames longer than this are stalls (a hidden tab, a debugger), not load, so they are ignored. */
export const MAX_SAMPLE_MS = 250;
/** Idle frame time (title, pause) averaged into each measure of the display's own frame interval. */
export const IDLE_WINDOW_MS = 1000;
/** Idle frame time skipped at the start of each idle stretch: the screen change, its redraw and a card popping in. */
export const IDLE_SETTLE_MS = 500;
/** The display interval the mean thresholds are written for (60 Hz). A faster display is still judged at 60 Hz. */
const REFERENCE_INTERVAL_MS = 1000 / 60;
/** The slowest display interval believed (30 Hz, low-power caps), so a misread idle stretch cannot hide real load. */
const SLOWEST_INTERVAL_MS = 1000 / 30;
/** Step down once this much frame time averages over `DOWN_MEAN_MS`. */
export const DOWN_WINDOW_MS = 1200;
export const DOWN_MEAN_MS = 21;
/** Step up once this much frame time averages under `UP_MEAN_MS`. */
export const UP_WAIT_MS = 7000;
export const UP_MEAN_MS = 17.6;
/** A step down this soon after a step up means the upgrade did not hold, so the next one waits twice as long. */
export const QUICK_DOWN_MS = 3000;
/** The wait never grows past this many times `UP_WAIT_MS`, so a device can always recover. */
const MAX_UP_WAIT_FACTOR = 8;

function assertLevel(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > LOWEST) {
    throw new RangeError(`Quality level must be a whole number from 0 to ${String(LOWEST)} (got ${String(index)}); pick one of QUALITY_LEVELS`);
  }
}

/** A span of accepted frame time and the frames in it. */
class FrameWindow {
  ms = 0;
  frames = 0;

  add(frameMs: number): void {
    this.ms += frameMs;
    this.frames++;
  }

  /** Mean frame time; only meaningful once frames were added. */
  get mean(): number {
    return this.ms / this.frames;
  }

  reset(): void {
    this.ms = 0;
    this.frames = 0;
  }
}

/**
 * Walks the quality ladder from measured frame times: down fast when frames run slow, up slowly
 * once there is headroom. Time is the sum of the frames it was given, so it needs no clock.
 *
 * Slow is relative to the display's own frame interval, measured on idle screens (title, pause),
 * where the game does almost no work: a display or browser capped at 30 Hz (low-power modes) shows
 * 33 ms idle frames, so 33 ms play frames are not load there. The mean thresholds are written for
 * 60 Hz and scale with that interval, clamped between the 60 Hz and 30 Hz values. Each idle
 * stretch skips its first `IDLE_SETTLE_MS`; until an idle second has been measured after that, the
 * display is taken to be 60 Hz.
 *
 * A step that changes the pixel ratio re-bakes every sprite in one frame after the resize debounce;
 * that one-frame spike is accepted.
 */
export class QualityScaler {
  private current: number;
  private pinned = false;
  private readonly slow = new FrameWindow();
  private readonly fast = new FrameWindow();
  private clock = 0;
  private upWait = UP_WAIT_MS;
  private upgradedAt: number | null = null;
  /** Frame time left to skip after `startRun()`. */
  private warmupLeft = 0;
  private readonly idle = new FrameWindow();
  /** Idle frame time left to skip before the current idle stretch is measured. */
  private idleSettleLeft = IDLE_SETTLE_MS;
  /** The fastest idle window of the current idle stretch; a play frame ends the stretch. */
  private idleBest = Number.POSITIVE_INFINITY;
  /** The display's own frame interval as last measured, between the 60 Hz and 30 Hz intervals. */
  private displayMs = REFERENCE_INTERVAL_MS;

  constructor(start = 0) {
    assertLevel(start);
    this.current = start;
  }

  get index(): number {
    return this.current;
  }

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.current] as QualityLevel;
  }

  /** Holds `index` fixed: later samples no longer move it. */
  pin(index: number): void {
    assertLevel(index);
    this.current = index;
    this.pinned = true;
  }

  /** Skips the first `WARMUP_MS` of frames from now: cold-start stalls say nothing about the device. */
  startRun(): void {
    this.warmupLeft = WARMUP_MS;
  }

  /** Feeds a frame from an idle screen (title, pause), which measures the display's own frame interval. */
  sampleIdle(frameMs: number): void {
    if (this.pinned || !(frameMs >= 0 && frameMs <= MAX_SAMPLE_MS)) return;
    if (this.idleSettleLeft > 0) {
      this.idleSettleLeft -= frameMs;
      return;
    }
    this.idle.add(frameMs);
    if (this.idle.ms < IDLE_WINDOW_MS) return;
    this.idleBest = Math.min(this.idleBest, this.idle.mean);
    this.displayMs = Math.min(SLOWEST_INTERVAL_MS, Math.max(REFERENCE_INTERVAL_MS, this.idleBest));
    this.idle.reset();
  }

  /** Feeds a frame of play. */
  sample(frameMs: number): void {
    if (this.pinned || !(frameMs >= 0)) return;
    this.endIdleStretch();
    if (this.warmupLeft > 0) {
      this.warmupLeft -= frameMs;
      return;
    }
    if (frameMs > MAX_SAMPLE_MS) return;
    this.clock += frameMs;
    this.slow.add(frameMs);
    this.fast.add(frameMs);
    this.settleUpgrade();
    if (this.slow.ms >= DOWN_WINDOW_MS) {
      if (this.slow.mean > DOWN_MEAN_MS * this.displayScale && this.current < LOWEST) this.stepDown();
      this.slow.reset();
    }
    if (this.fast.ms >= this.upWait) {
      if (this.fast.mean < UP_MEAN_MS * this.displayScale && this.current > 0) this.stepUp();
      this.fast.reset();
    }
  }

  /** How many 60 Hz frame intervals one display interval lasts: the mean thresholds stretch by it. */
  private get displayScale(): number {
    return this.displayMs / REFERENCE_INTERVAL_MS;
  }

  /** The next idle screen measures afresh; until it completes a window the last interval holds. */
  private endIdleStretch(): void {
    this.idle.reset();
    this.idleSettleLeft = IDLE_SETTLE_MS;
    this.idleBest = Number.POSITIVE_INFINITY;
  }

  /** An upgrade that has held past `QUICK_DOWN_MS` earns back the normal wait. */
  private settleUpgrade(): void {
    if (this.upgradedAt !== null && this.clock - this.upgradedAt >= QUICK_DOWN_MS) {
      this.upgradedAt = null;
      this.upWait = UP_WAIT_MS;
    }
  }

  private stepDown(): void {
    if (this.upgradedAt !== null) this.upWait = Math.min(this.upWait * 2, UP_WAIT_MS * MAX_UP_WAIT_FACTOR);
    this.upgradedAt = null;
    this.current++;
    this.restartWindows();
  }

  private stepUp(): void {
    this.upgradedAt = this.clock;
    this.current--;
    this.restartWindows();
  }

  private restartWindows(): void {
    this.slow.reset();
    this.fast.reset();
  }
}
