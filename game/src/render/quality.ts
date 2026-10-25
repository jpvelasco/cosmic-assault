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

/** Frames longer than this are stalls (a hidden tab, a debugger), not load, so they are ignored. */
export const MAX_SAMPLE_MS = 250;
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
 */
export class QualityScaler {
  private current: number;
  private pinned = false;
  private readonly slow = new FrameWindow();
  private readonly fast = new FrameWindow();
  private clock = 0;
  private upWait = UP_WAIT_MS;
  private upgradedAt: number | null = null;

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

  sample(frameMs: number): void {
    if (this.pinned || !(frameMs >= 0 && frameMs <= MAX_SAMPLE_MS)) return;
    this.clock += frameMs;
    this.slow.add(frameMs);
    this.fast.add(frameMs);
    this.settleUpgrade();
    if (this.slow.ms >= DOWN_WINDOW_MS) {
      if (this.slow.mean > DOWN_MEAN_MS && this.current < LOWEST) this.stepDown();
      this.slow.reset();
    }
    if (this.fast.ms >= this.upWait) {
      if (this.fast.mean < UP_MEAN_MS && this.current > 0) this.stepUp();
      this.fast.reset();
    }
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
