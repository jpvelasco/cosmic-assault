import type { Field } from '../field';
import { rescale } from '../wrap';
import type { BossPart } from './behaviour';

/**
 * The way a serpent's head has come, kept so its body can follow it: the head's points, each at least `step` from the
 * last, newest last, in a fixed ring buffer that overwrites the oldest. Noting a point and laying the body along it
 * allocate nothing, so a fight can step it every step.
 */
export class SerpentTrail {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  /** Where the newest point is in the buffer, and how many it holds. */
  private newest = -1;
  private count = 0;

  constructor(
    private readonly capacity: number,
    /** The least distance between two points it notes. */
    private readonly step: number,
  ) {
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  /** Notes the head at (x, y), if it has moved at least the step from the last point noted. */
  follow(x: number, y: number): void {
    const last = this.newest;
    if (this.count > 0 && Math.hypot(x - (this.xs[last] ?? 0), y - (this.ys[last] ?? 0)) < this.step) return;
    this.newest = (last + 1) % this.capacity;
    this.xs[this.newest] = x;
    this.ys[this.newest] = y;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /**
   * Lays `parts`, listed tail first, along the trail behind a head at (x, y): the last part `gap` along it from the head,
   * and each other part `gap` along it from the one after. A part the trail does not reach back to lies at its oldest
   * point.
   */
  lay(x: number, y: number, parts: readonly BossPart[], gap: number): void {
    // Walks back along the trail from the head, a leg at a time, to the leg each part lies on.
    let fromX = x;
    let fromY = y;
    let walked = 0;
    let next = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i] as BossPart;
      const want = gap * (parts.length - i);
      let length = this.legFrom(next, fromX, fromY);
      while (next < this.count && walked + length < want) {
        walked += length;
        fromX = this.xs[this.slot(next)] ?? 0;
        fromY = this.ys[this.slot(next)] ?? 0;
        next++;
        length = this.legFrom(next, fromX, fromY);
      }
      if (next >= this.count) {
        part.x = fromX;
        part.y = fromY;
        continue;
      }
      const share = length > 0 ? (want - walked) / length : 0;
      part.x = fromX + ((this.xs[this.slot(next)] ?? 0) - fromX) * share;
      part.y = fromY + ((this.ys[this.slot(next)] ?? 0) - fromY) * share;
    }
  }

  /** Where in the buffer the point `back` places behind the newest is. */
  private slot(back: number): number {
    return (this.newest - back + this.capacity) % this.capacity;
  }

  /** How far it is from (x, y) to the point `back` places behind the newest; 0 past the oldest. */
  private legFrom(back: number, x: number, y: number): number {
    if (back >= this.count) return 0;
    const at = this.slot(back);
    return Math.hypot((this.xs[at] ?? 0) - x, (this.ys[at] ?? 0) - y);
  }

  /** Stretches every point it holds from field `old` to `field`, as the World stretches every body. */
  rescale(old: Field, field: Field): void {
    for (let i = 0; i < this.count; i++) {
      this.xs[i] = rescale(this.xs[i] ?? 0, old.width, field.width);
      this.ys[i] = rescale(this.ys[i] ?? 0, old.height, field.height);
    }
  }
}
