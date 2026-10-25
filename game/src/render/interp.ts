import { WRAP_MARGIN } from '../sim/config';
import type { Field } from '../sim/field';
import { TAU } from '../sim/math';

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/**
 * Writes the pose `alpha` of the way from the previous to the current one into `out`.
 *
 * An entity that wrapped this step jumped about a whole wrap period, so a displacement
 * beyond half the period on either axis means "wrapped": draw the current pose rather
 * than streaking across the field. The angle always lerps along the shortest arc.
 */
export function interpolatePose(
  px: number,
  py: number,
  pangle: number,
  x: number,
  y: number,
  angle: number,
  alpha: number,
  field: Field,
  out: { x: number; y: number; angle: number },
): void {
  const wrapped =
    Math.abs(x - px) > (field.width + 2 * WRAP_MARGIN) / 2 || Math.abs(y - py) > (field.height + 2 * WRAP_MARGIN) / 2;
  out.x = wrapped ? x : px + (x - px) * alpha;
  out.y = wrapped ? y : py + (y - py) * alpha;
  // Fold the raw difference into [-pi, pi) so the lerp takes the short way round.
  const turn = ((((angle - pangle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  out.angle = pangle + turn * alpha;
}

/**
 * Writes the extra (dx, dy) offsets at which to draw an entity again, and returns how
 * many there are (at most 3, so `out` needs room for 6 numbers).
 *
 * Derivation: `wrapPosition` keeps an entity in [-M, W + M] (M = WRAP_MARGIN) and jumps
 * it by one period P = W + 2M when it leaves, so the world is a torus of period P and
 * the entity is also "really" at x + P and x - P. The visible field is [0, W]. The copy
 * at x + P is on screen when its left edge is inside the field, x + P - r < W; the copy
 * at x - P when its right edge is, x - P + r > 0. The same holds on y with Q = H + 2M.
 * Drawing exactly those copies means the circle looks identical just before and just
 * after the jump. Corners combine the two axes, giving up to 3 copies; interior gives 0.
 */
export function wrapCopies(x: number, y: number, radius: number, field: Field, out: Float64Array): number {
  const periodX = field.width + 2 * WRAP_MARGIN;
  const periodY = field.height + 2 * WRAP_MARGIN;
  // Offset to draw at per axis, or 0 when that axis needs no copy.
  const dx = x + periodX - radius < field.width ? periodX : x - periodX + radius > 0 ? -periodX : 0;
  const dy = y + periodY - radius < field.height ? periodY : y - periodY + radius > 0 ? -periodY : 0;
  // Written in place, with no helper closure, because this runs for every entity every frame.
  let count = 0;
  if (dx !== 0) {
    out[0] = dx;
    out[1] = 0;
    count = 1;
  }
  if (dy !== 0) {
    out[count * 2] = 0;
    out[count * 2 + 1] = dy;
    count++;
  }
  if (dx !== 0 && dy !== 0) {
    out[4] = dx;
    out[5] = dy;
    count = 3;
  }
  return count;
}
