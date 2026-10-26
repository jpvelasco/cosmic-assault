import type { Controls, Stick } from '../sim/controls';

/** What the touch layer reports: a fire button and a joystick. */
export interface TouchInput {
  readonly fire: boolean;
  readonly stick: Stick | null;
}

/** Joins the sources into one Controls: fire and thrust are ORed, the keys turn before the pad does, and touch steers before the pad. */
export function mergeControls(keys: Omit<Controls, 'stick'>, touch: TouchInput, pad: Controls): Controls {
  return {
    turn: keys.turn === 0 ? pad.turn : keys.turn,
    thrust: keys.thrust || pad.thrust,
    fire: keys.fire || touch.fire || pad.fire,
    stick: touch.stick ?? pad.stick,
  };
}
