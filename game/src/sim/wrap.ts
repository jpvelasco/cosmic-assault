import { WRAP_MARGIN } from './config';
import type { Field } from './field';

/** Maps a coordinate from a `from`-sized wrap band onto a `to`-sized one; unchanged sizes keep it exact. */
export function rescale(value: number, from: number, to: number): number {
  if (from === to) return value;
  return ((value + WRAP_MARGIN) * (to + 2 * WRAP_MARGIN)) / (from + 2 * WRAP_MARGIN) - WRAP_MARGIN;
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
