import type { Controls } from '../sim/controls';

const LEFT = ['ArrowLeft', 'KeyA'] as const;
const RIGHT = ['ArrowRight', 'KeyD'] as const;
const THRUST = ['ArrowUp', 'KeyW'] as const;
/**
 * Z and X fire too: many keyboards cannot report Up + Left + Space at once (key ghosting), so a player flying with
 * the arrows needs a fire key away from them. WASD + Space is the other way round the problem.
 */
const FIRE = ['Space', 'ShiftLeft', 'ShiftRight', 'KeyZ', 'KeyX'] as const;

/** Codes the game claims; the browser's default action is suppressed for these. */
export const GAME_KEY_CODES: ReadonlySet<string> = new Set([...LEFT, ...RIGHT, ...THRUST, ...FIRE]);

function anyHeld(held: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => held.has(code));
}

export function controlsFromKeys(held: ReadonlySet<string>): Pick<Controls, 'turn' | 'thrust' | 'fire'> {
  const left = anyHeld(held, LEFT);
  const right = anyHeld(held, RIGHT);
  return {
    turn: left === right ? 0 : left ? -1 : 1,
    thrust: anyHeld(held, THRUST),
    fire: anyHeld(held, FIRE),
  };
}
