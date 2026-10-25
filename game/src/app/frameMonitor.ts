import { WARMUP_MS } from '../render/quality';

/** A frame this long or longer is a visible hitch. */
export const LONG_FRAME_MS = 50;

export interface FrameSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly longFrames: number;
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

  sample(frameMs: number): void {
    if (!(frameMs >= 0)) return;
    if (this.elapsed < WARMUP_MS) {
      this.elapsed += frameMs;
      return;
    }
    const bin = Math.min(Math.floor(frameMs / BIN_MS), BINS - 1);
    this.bins[bin] = (this.bins[bin] as number) + 1;
    this.count++;
    if (frameMs >= LONG_FRAME_MS) this.longFrames++;
  }

  /** Forgets everything, including the warm-up already served; call when a run starts. */
  reset(): void {
    this.bins.fill(0);
    this.elapsed = 0;
    this.count = 0;
    this.longFrames = 0;
  }

  summary(): FrameSummary {
    return { count: this.count, p50: this.percentile(0.5), p95: this.percentile(0.95), longFrames: this.longFrames };
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
