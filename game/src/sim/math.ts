/** A full turn in radians. */
export const TAU = Math.PI * 2;

/** The signed turn from heading `from` to `to`, in (-π, π]. */
export function turnBetween(from: number, to: number): number {
  const turn = (to - from) % TAU;
  if (turn > Math.PI) return turn - TAU;
  return turn <= -Math.PI ? turn + TAU : turn;
}

/**
 * Eases `t` from 0 to 1 with zero slope at both ends (3t² − 2t³), times `scale`. The scale is multiplied in first, so a
 * scaled ease rounds exactly as `scale * t * t * (3 - 2 * t)` written out does, and the sim's results do not move.
 */
export const smoothstep = (t: number, scale = 1): number => scale * t * t * (3 - 2 * t);

/** Absorbs float residue from summing dt steps, so a time boundary fires on the step it is reached. */
export const TIME_EPSILON = 1e-9;

/** Anything with a velocity. */
export interface Moving {
  vx: number;
  vy: number;
}

/**
 * Adds (dvx, dvy) to `body`'s velocity, but not past `cap` units per second: a body already faster than `cap` is
 * only kept from gaining. An external force (a gravity well's pull, a boss's shove) never touches `stepShip` this way.
 */
export function nudge(body: Moving, dvx: number, dvy: number, cap: number): void {
  const before = Math.hypot(body.vx, body.vy);
  body.vx += dvx;
  body.vy += dvy;
  const limit = Math.max(before, cap);
  const after = Math.hypot(body.vx, body.vy);
  if (after > limit) {
    body.vx *= limit / after;
    body.vy *= limit / after;
  }
}
