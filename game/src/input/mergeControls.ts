import type { Controls, Stick } from '../sim/controls';

/** What the touch layer reports: a fire button and a joystick. */
export interface TouchInput {
  readonly fire: boolean;
  readonly stick: Stick | null;
}

/**
 * Joins the sources into one Controls: fire and thrust are ORed, the keys turn before the pad does, and touch steers
 * before the pad. A held turn key also overrides any stick, because a stick sets the heading outright and would
 * otherwise swallow the turn (a pad's drifting stick or a thumb resting on the joystick).
 */
export function mergeControls(keys: Omit<Controls, 'stick'>, touch: TouchInput, pad: Controls): Controls {
  return {
    turn: keys.turn === 0 ? pad.turn : keys.turn,
    thrust: keys.thrust || pad.thrust,
    fire: keys.fire || touch.fire || pad.fire,
    stick: keys.turn === 0 ? (touch.stick ?? pad.stick) : null,
  };
}
