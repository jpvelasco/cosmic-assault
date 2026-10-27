import { PLAYER, STEP_SECONDS, STICK } from '../sim/config';
import type { Controls, Stick } from '../sim/controls';
import { turnBetween } from '../sim/math';

const TURN_PER_STEP = PLAYER.turnSpeed * STEP_SECONDS;

/** What a pilot means to do this step, before it becomes controls. */
export interface Intent {
  /** Where the nose should point; null leaves it where it is. */
  heading: number | null;
  /** True steers to `heading` on the stick at full thrust; false turns toward it with the keys and coasts. */
  thrust: boolean;
  fire: boolean;
}

export const idleIntent = (): Intent => ({ heading: null, thrust: false, fire: false });

export function copyIntent(from: Readonly<Intent>, to: Intent): void {
  to.heading = from.heading;
  to.thrust = from.thrust;
  to.fire = from.fire;
}

interface MutableControls {
  turn: -1 | 0 | 1;
  thrust: boolean;
  fire: boolean;
  stick: Stick | null;
}

/**
 * Turns intents into controls against the ship's nose as it is now, so a turn stops at its heading. It reuses one
 * controls object and one stick: the controls it returns are valid until the next `apply`.
 */
export class Hands {
  private readonly stick = { angle: 0, distance: STICK.fullThrust };
  private readonly controls: MutableControls = { turn: 0, thrust: false, fire: false, stick: null };

  apply(intent: Readonly<Intent>, shipAngle: number): Controls {
    const { controls, stick } = this;
    const { heading } = intent;
    controls.fire = intent.fire;
    controls.turn = 0;
    controls.stick = null;
    if (heading === null) return controls;
    if (intent.thrust) {
      stick.angle = heading;
      controls.stick = stick;
      return controls;
    }
    const turn = turnBetween(shipAngle, heading);
    if (Math.abs(turn) > TURN_PER_STEP / 2) controls.turn = turn > 0 ? 1 : -1;
    return controls;
  }
}
