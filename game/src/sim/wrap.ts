import { WRAP_MARGIN } from './config';
import type { Field } from './field';

/** Maps a coordinate from a `from`-sized wrap band onto a `to`-sized one; unchanged sizes keep it exact. */
export function rescale(value: number, from: number, to: number): number {
  if (from === to) return value;
  return ((value + WRAP_MARGIN) * (to + 2 * WRAP_MARGIN)) / (from + 2 * WRAP_MARGIN) - WRAP_MARGIN;
}

/** A body's place and its place a step ago, as `rescalePose` stretches them. */
export interface Pose {
  x: number;
  y: number;
  px: number;
  py: number;
}

/** Puts `body` at `spot` with its place a step ago there too, so it is drawn there and not sweeping across to it. */
export function placePose(body: Pose, spot: Readonly<{ x: number; y: number }>): void {
  body.x = body.px = spot.x;
  body.y = body.py = spot.y;
}

/** Stretches `body`'s place and its place a step ago from field `old` to `field`, keeping their fractions of the wrap band. */
export function rescalePose(body: Pose, old: Field, field: Field): void {
  body.x = rescale(body.x, old.width, field.width);
  body.y = rescale(body.y, old.height, field.height);
  body.px = rescale(body.px, old.width, field.width);
  body.py = rescale(body.py, old.height, field.height);
}

export function wrapPosition(p: { x: number; y: number }, field: Field, margin: number = WRAP_MARGIN): void {
  if (p.x < -margin) {
    p.x = field.width + margin;
  } else if (p.x > field.width + margin) {
    p.x = -margin;
  }
  if (p.y < -margin) {
    p.y = field.height + margin;
  } else if (p.y > field.height + margin) {
    p.y = -margin;
  }
}

/**
 * The shortest signed offset equal to `delta` across a wrap band `size` wide plus `margin` each side, as `wrapPosition`
 * wraps it: two points either side of an edge are close, not a field apart.
 */
export function wrapDelta(delta: number, size: number, margin: number = WRAP_MARGIN): number {
  const period = size + 2 * margin;
  if (delta > period / 2) return delta - period;
  return delta < -period / 2 ? delta + period : delta;
}

/** The distance from `from` to `to`, measured across the wrap band as `wrapDelta` measures it. */
export const wrappedDistance = (from: Readonly<{ x: number; y: number }>, to: Readonly<{ x: number; y: number }>, field: Field): number =>
  Math.hypot(wrapDelta(to.x - from.x, field.width), wrapDelta(to.y - from.y, field.height));

/** Whether two circles overlap, their offset measured across the wrap band as `wrapDelta` measures it. */
export function overlapsAcrossWrap(field: Field, ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = wrapDelta(bx - ax, field.width);
  const dy = wrapDelta(by - ay, field.height);
  const reach = ar + br;
  return dx * dx + dy * dy < reach * reach;
}
