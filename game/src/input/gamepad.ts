import { NO_CONTROLS, type Controls } from '../sim/controls';
import type { FocusDirection } from './menuFocus';

/** The parts of a standard-mapping `Gamepad` the game reads, copied so a browser that reuses the object cannot change them. */
export interface PadSnapshot {
  readonly axes: readonly number[];
  readonly pressed: readonly boolean[];
}

/** The pad buttons that stand for a menu command rather than a direction. */
export type PadButton = 'confirm' | 'back' | 'pause';
export type PadEdge = PadButton | FocusDirection;

const NO_EDGES: readonly PadEdge[] = [];

/** Standard-mapping button indices. */
const A = 0;
const B = 1;
const RB = 5;
const RT = 7;
const START = 9;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

const STICK_DEAD_ZONE = 0.2;
/** How far the stick must be pushed to count as a menu direction. */
const STICK_MENU_THRESHOLD = 0.5;
/** Same scale as the touch stick: this distance is full thrust. */
const FULL_THRUST_DISTANCE = 60;

const BUTTON_EDGES: readonly (readonly [number, PadEdge])[] = [
  [A, 'confirm'],
  [B, 'back'],
  [START, 'pause'],
  [DPAD_UP, 'up'],
  [DPAD_DOWN, 'down'],
  [DPAD_LEFT, 'left'],
  [DPAD_RIGHT, 'right'],
];

/** The first connected pad with the standard mapping, else the first connected pad, else null. */
export function pickPad(pads: ArrayLike<Gamepad | null>): Gamepad | null {
  let first: Gamepad | null = null;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (pad === null || pad === undefined) continue;
    if (pad.mapping === 'standard') return pad;
    first ??= pad;
  }
  return first;
}

export function snapshotPad(pad: Gamepad | null): PadSnapshot | null {
  return pad === null ? null : { axes: Array.from(pad.axes), pressed: pad.buttons.map((b) => b.pressed) };
}

function leftStick(pad: PadSnapshot): readonly [x: number, y: number] {
  return [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
}

/** Controls from a pad: the left stick steers like the touch stick, the D-pad turns and thrusts, A, RB and RT fire. */
export function controlsFromPad(pad: PadSnapshot | null): Controls {
  if (pad === null) return NO_CONTROLS;
  const [x, y] = leftStick(pad);
  const push = Math.hypot(x, y);
  const left = pad.pressed[DPAD_LEFT] === true;
  const right = pad.pressed[DPAD_RIGHT] === true;
  return {
    turn: left === right ? 0 : left ? -1 : 1,
    thrust: pad.pressed[DPAD_UP] === true,
    fire: pad.pressed[A] === true || pad.pressed[RB] === true || pad.pressed[RT] === true,
    stick:
      push <= STICK_DEAD_ZONE
        ? null
        : {
            angle: Math.atan2(y, x),
            distance: Math.min(FULL_THRUST_DISTANCE, ((push - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE)) * FULL_THRUST_DISTANCE),
          },
  };
}

/** Whether the player is touching the pad: any button held, or the left stick pushed past its dead zone. */
export function padInUse(pad: PadSnapshot | null): boolean {
  return pad !== null && (Math.hypot(...leftStick(pad)) > STICK_DEAD_ZONE || pad.pressed.includes(true));
}

/** The edges a pad is holding: its menu buttons, and the direction the left stick is pushed (its stronger axis, past the threshold). */
function heldEdges(pad: PadSnapshot | null): ReadonlySet<PadEdge> {
  const held = new Set<PadEdge>();
  if (pad === null) return held;
  for (const [button, edge] of BUTTON_EDGES) {
    if (pad.pressed[button] === true) held.add(edge);
  }
  const [x, y] = leftStick(pad);
  if (Math.max(Math.abs(x), Math.abs(y)) > STICK_MENU_THRESHOLD) {
    if (Math.abs(x) >= Math.abs(y)) held.add(x < 0 ? 'left' : 'right');
    else held.add(y < 0 ? 'up' : 'down');
  }
  return held;
}

/** What `next` presses that `prev` did not, once each. A pad that has just appeared counts as untouched before. */
export function padEdges(prev: PadSnapshot | null, next: PadSnapshot | null): readonly PadEdge[] {
  if (next === null) return NO_EDGES;
  const before = heldEdges(prev);
  return [...heldEdges(next)].filter((edge) => !before.has(edge));
}

/**
 * Keeps a fire button that was already down when a run started or resumed (A, which also confirmed) quiet until it is
 * let go, as the key latch does for keys.
 */
export interface PadFireLatch {
  /** Silences the fire button if `pad` is holding it now. */
  latch(pad: PadSnapshot | null): void;
  /** Passes `controls` through, with fire cleared while latched; a released button clears the latch. */
  apply(controls: Controls): Controls;
}

export function createPadFireLatch(): PadFireLatch {
  let latched = false;
  return {
    latch(pad) {
      latched = controlsFromPad(pad).fire;
    },
    apply(controls) {
      if (!controls.fire) latched = false;
      return latched ? { ...controls, fire: false } : controls;
    },
  };
}

/**
 * A reader that takes one snapshot of the active pad per call. A browser that lacks the Gamepad API or refuses it
 * (a permissions policy) is reported once through `onUnavailable`, after which every read is null.
 */
export function createPadReader(
  getPads: () => ArrayLike<Gamepad | null>,
  onUnavailable: (error: unknown) => void,
): () => PadSnapshot | null {
  let available = true;
  return () => {
    if (!available) return null;
    try {
      return snapshotPad(pickPad(getPads()));
    } catch (error) {
      available = false;
      onUnavailable(error);
      return null;
    }
  };
}
