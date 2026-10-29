import type { PadSnapshot } from '../../src/input/gamepad';

/** Buttons on a standard-mapping pad. */
const BUTTONS = 17;

/** A standard-mapping snapshot with the given buttons pressed and axes set (left stick x, y, right stick x, y). */
export function pad(buttons: readonly number[] = [], axes: readonly number[] = [0, 0, 0, 0]): PadSnapshot {
  return { axes, pressed: Array.from({ length: BUTTONS }, (_, i) => buttons.includes(i)) };
}
