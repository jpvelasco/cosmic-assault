import type { Stick } from '../sim/controls';

/** Distance that means full thrust, in reference pixels. */
const FULL_THRUST_DISTANCE = 60;

/**
 * Converts a drag offset from the stick centre into a Stick. Distance is
 * rescaled so `baseRadiusPx` maps to full thrust and is deliberately not
 * clamped: dragging past the rim reports larger distances.
 */
export function stickFromOffset(dx: number, dy: number, baseRadiusPx: number): Stick {
  return {
    angle: Math.atan2(dy, dx),
    distance: (Math.hypot(dx, dy) * FULL_THRUST_DISTANCE) / baseRadiusPx,
  };
}
