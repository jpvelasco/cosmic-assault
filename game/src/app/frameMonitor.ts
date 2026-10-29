import { WARMUP_MS } from '../render/quality';

/** A frame this long or longer is a visible hitch. */
export const LONG_FRAME_MS = 50;

/** A frame longer than this is a stall: the page was frozen, not merely slow. */
export const STALL_MS = 1000;

/** A frame longer than this many display intervals is slow: it missed at least one refresh of the display. */
export const SLOW_FRAME_INTERVALS = 1.5;

export interface FrameSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly longFrames: number;
  /** The share (0–1) of frames longer than SLOW_FRAME_INTERVALS display intervals; 0 with no frames. */
  readonly slowShare: number;
}

/** Frame times land in bins this wide, so percentiles are exact to within this many ms. */
const BIN_MS = 0.25;
/** Frames beyond this share the last bin; their exact length no longer matters. */
const MAX_MS = 500;
const BINS = MAX_MS / BIN_MS + 1;

/**
 * Collects real frame times after a warm-up and reports percentiles. Frames go into a fixed
 * histogram, so a long session neither allocates per frame nor grows.
 */
export class FrameMonitor {
  private readonly bins = new Uint32Array(BINS);
  private elapsed = 0;
  private count = 0;
  private longFrames = 0;
  private slowFrames = 0;

  /** `onStall` hears of every frame over STALL_MS, warm-up included. */
  constructor(private readonly onStall: (frameMs: number) => void = () => undefined) {}

  /** `displayMs` is the display's own frame interval (`QualityScaler.displayIntervalMs`), which says whether the frame is slow. */
  sample(frameMs: number, displayMs: number): void {
    if (!(frameMs >= 0)) return;
    if (frameMs > STALL_MS) this.onStall(frameMs);
    if (this.elapsed < WARMUP_MS) {
      this.elapsed += frameMs;
      return;
    }
    const bin = Math.min(Math.floor(frameMs / BIN_MS), BINS - 1);
    this.bins[bin] = (this.bins[bin] as number) + 1;
    this.count++;
    if (frameMs >= LONG_FRAME_MS) this.longFrames++;
    if (frameMs > SLOW_FRAME_INTERVALS * displayMs) this.slowFrames++;
  }

  /** Forgets everything, including the warm-up already served; call when a run starts. */
  reset(): void {
    this.bins.fill(0);
    this.elapsed = 0;
    this.count = 0;
    this.longFrames = 0;
    this.slowFrames = 0;
  }

  summary(): FrameSummary {
    const slowShare = this.count === 0 ? 0 : this.slowFrames / this.count;
    return { count: this.count, p50: this.percentile(0.5), p95: this.percentile(0.95), longFrames: this.longFrames, slowShare };
  }

  /** Nearest-rank percentile `p` (0–1) in ms; 0 with no frames. */
  private percentile(p: number): number {
    const rank = Math.ceil(p * this.count);
    let seen = 0;
    for (let bin = 0; bin < BINS; bin++) {
      seen += this.bins[bin] as number;
      if (seen >= rank && seen > 0) return bin * BIN_MS;
    }
    return 0;
  }
}
