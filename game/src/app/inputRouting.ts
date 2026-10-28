import { padInUse, type PadEdge, type PadSnapshot } from '../input/gamepad';
import type { KeyboardSource } from '../input/keyboardSource';
import { hasShortcutModifier, isFormControlTarget } from '../input/keyEvent';
import type { KeyLatch } from '../input/keyLatch';
import { arrowDirection, type FocusDirection } from '../input/menuFocus';
import { attachFullscreenKey } from '../platform/fullscreen';
import { listen } from '../ui/dom';
import { focusedControl, moveFocus, nudgeSlider } from '../ui/menuNav';
import { commandForKey, commandForPad, TOGGLE_FULLSCREEN, type Command, type FlowCommand } from './commands';
import type { Screen } from './flow';
import { passesGameOverGuard } from './gameOverGuard';

/** What can sit over the game's cards: nothing, the settings, records or Hangar card, the rotate prompt or the crash card. */
export type Cover = 'none' | 'settings' | 'records' | 'hangar' | 'rotate' | 'crash';

/** The inputs the router hands on: the commands, grouped (and a pause toggle split by screen), and the menu's own inputs. */
export type RoutedInput =
  /** A command that goes forward, and so may start a run: Play, a mode, Dimension or galaxy, Next, Retry, Continue. */
  | 'start'
  /** A command that leaves a card: Back, Map and Title. */
  | 'leave'
  | 'toggleMute'
  | 'toggleFullscreen'
  | 'pause'
  | 'resume'
  /** Arrow keys and the D-pad moving menu focus. */
  | 'navigate'
  /** Pad A pressing the focused control. */
  | 'pressFocused'
  /** Esc, pad Back, Done or Back closing the settings, records or Hangar card. */
  | 'closeCard';

const Y = true;
const N = false;

/**
 * Which inputs act under which cover; the one place a new screen adds a row or a column. An input acts only when
 * every cover that is up allows it. Under the crash card the loop is dead, so only the synchronous F key still runs.
 */
const ACTS_UNDER: Readonly<Record<RoutedInput, Readonly<Record<Cover, boolean>>>> = {
  start: { none: Y, settings: N, records: N, hangar: N, rotate: N, crash: N },
  resume: { none: Y, settings: N, records: N, hangar: N, rotate: N, crash: N },
  pause: { none: Y, settings: N, records: N, hangar: N, rotate: Y, crash: N },
  leave: { none: Y, settings: N, records: N, hangar: N, rotate: Y, crash: N },
  toggleMute: { none: Y, settings: Y, records: Y, hangar: Y, rotate: Y, crash: N },
  toggleFullscreen: { none: Y, settings: Y, records: Y, hangar: Y, rotate: Y, crash: Y },
  navigate: { none: Y, settings: Y, records: Y, hangar: Y, rotate: N, crash: N },
  pressFocused: { none: Y, settings: Y, records: Y, hangar: Y, rotate: N, crash: N },
  closeCard: { none: Y, settings: Y, records: Y, hangar: Y, rotate: N, crash: N },
};

/** The cover cards a player opens and closes: pad Back closes the one that is up. */
const CARD_COVERS: readonly Cover[] = ['settings', 'records', 'hangar'];

/** Every cover, bottom first. */
const COVERS = ['settings', 'records', 'hangar', 'rotate', 'crash'] as const;

/** Which covers are up. */
export type CoversUp = Readonly<Record<Exclude<Cover, 'none'>, boolean>>;

/** The covers that are up, bottom first; `['none']` when the cards are uncovered. */
export function coversFor(up: CoversUp): Cover[] {
  const covers = COVERS.filter((cover) => up[cover]);
  return covers.length === 0 ? ['none'] : covers;
}

/** Whether any cover is up; unlike `coversFor`, it builds nothing, so a frame can ask. */
export function anyCoverUp(up: CoversUp): boolean {
  for (const cover of COVERS) if (up[cover]) return true;
  return false;
}

export function actsUnder(input: RoutedInput, covers: readonly Cover[]): boolean {
  return covers.every((cover) => ACTS_UNDER[input][cover]);
}

const LEAVING: ReadonlySet<Command['kind']> = new Set(['back', 'map', 'title']);

export function inputForCommand(command: Command, screen: Screen): RoutedInput {
  switch (command.kind) {
    case 'togglePause':
      return screen === 'playing' ? 'pause' : 'resume';
    case 'toggleMute':
    case 'toggleFullscreen':
      return command.kind;
    default:
      return LEAVING.has(command.kind) ? 'leave' : 'start';
  }
}

/** Whether `command` runs now: the game-over guard has lapsed and every cover allows it. */
export function commandActs(command: Command, screen: Screen, covers: readonly Cover[], msSinceRunEnd: number): boolean {
  return passesGameOverGuard(screen, command, msSinceRunEnd) && actsUnder(inputForCommand(command, screen), covers);
}

/** What a routed command does. */
export interface CommandHandlers {
  /** A command that moves between screens. */
  flow(command: FlowCommand): void;
  /** The pause key or button: unlike a blur, it blips. */
  pause(): void;
  resume(): void;
  toggleMute(): void;
  toggleFullscreen(): void;
}

export interface InputRouterDeps {
  readonly keyboard: KeyboardSource;
  /** Released key by key as presses drain, so a key held through a start acts again once pressed anew. */
  readonly startKeys: KeyLatch;
  readonly run: CommandHandlers;
  screen(): Screen;
  covers(): readonly Cover[];
  /** Milliseconds since the run on the end card ended. */
  msSinceRunEnd(now: number): number;
  /** The controls menu focus moves among: an open settings or records card's, else the card for the screen. */
  menuControls(): HTMLElement[];
  /** Closes the settings or records card, whichever is open. */
  closeCard(): void;
  /**
   * Hears every key press, pointer press and pad touch: restarts the attract demo's idle count, and ends a demo that is
   * playing. True if it ended one, so the input that did it must do nothing else.
   */
  interrupt(): boolean;
}

export interface InputRouter {
  /** Runs a key, pad or button command if the game-over guard and the covers allow it. */
  applyCommand(command: Command, now: number): void;
  /** Acts on the key presses since the last frame. */
  routeKeys(now: number): void;
  /** Acts on this frame's pad presses (`edges`, from the snapshot `pad` read this frame). */
  routePad(pad: PadSnapshot | null, edges: readonly PadEdge[], now: number): void;
  dispose(): void;
}

/** Set on `body` while a pad or arrow key drives menu focus; the stylesheet shows the focus ring for it. */
const NAV_KEYS_CLASS = 'nav-keys';

/** What a pointer press leads to: none of it may act once that press has ended an attract demo. */
const POINTER_FOLLOW_UPS = ['mousedown', 'mouseup', 'click'] as const;

/** Keeps `e` from the game's own handlers and from its browser action (a focused button's press, a scroll). */
function swallow(e: Event): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

/**
 * Keeps the input that ends an attract demo from doing anything else, listening on `win` in the capture phase, ahead of
 * every other handler. A key press is swallowed with its repeats and its release, so a key held from it never counts as
 * pressed on the title; a pointer press with the mouse presses and click it leads to, until any other input comes.
 * Returns what the pad's frame reading calls, and the function that detaches it all.
 */
function swallowDemoEnders(win: Window, interrupt: () => boolean, onPointerDown: () => void): { readonly padTouched: () => boolean; readonly dispose: () => void } {
  const heldKeys = new Set<string>();
  let pointerPress = false;

  const onKeyDown = (e: Event): void => {
    pointerPress = false;
    const key = e as KeyboardEvent;
    if (key.repeat && heldKeys.has(key.code)) {
      swallow(e);
      return;
    }
    heldKeys.delete(key.code);
    // A browser shortcut ends a demo too, but keeps its browser action.
    if (!interrupt() || hasShortcutModifier(key)) return;
    heldKeys.add(key.code);
    swallow(e);
  };
  const onKeyUp = (e: Event): void => {
    if (heldKeys.delete((e as KeyboardEvent).code)) swallow(e);
  };
  const onPointer = (): void => {
    onPointerDown();
    pointerPress = interrupt();
  };
  const onFollowUp = (e: Event): void => {
    if (!pointerPress) return;
    swallow(e);
    if (e.type === 'click') pointerPress = false;
  };
  const onBlur = (): void => {
    heldKeys.clear();
    pointerPress = false;
  };
  const unlisteners = [
    listen(win, 'keydown', onKeyDown, true),
    listen(win, 'keyup', onKeyUp, true),
    listen(win, 'pointerdown', onPointer, true),
    ...POINTER_FOLLOW_UPS.map((type) => listen(win, type, onFollowUp, true)),
    listen(win, 'blur', onBlur),
  ];
  return {
    padTouched: () => {
      pointerPress = false;
      return interrupt();
    },
    dispose: () => {
      for (const unlisten of unlisteners) unlisten();
    },
  };
}

/**
 * Turns keys, pad presses and the synchronous F key into commands and menu moves, through the one cover table.
 * Listens on `win` for F (full screen must be asked for inside the key handler) and for the pointer press that hides
 * the pad's focus ring.
 */
export function createInputRouter(win: Window, deps: InputRouterDeps): InputRouter {
  const { keyboard, startKeys, run } = deps;
  const acts = (input: RoutedInput): boolean => actsUnder(input, deps.covers());

  function applyCommand(command: Command, now: number): void {
    const screen = deps.screen();
    if (!commandActs(command, screen, deps.covers(), deps.msSinceRunEnd(now))) return;
    switch (command.kind) {
      case 'togglePause':
        if (screen === 'playing') run.pause();
        else run.resume();
        break;
      case 'toggleMute':
        run.toggleMute();
        break;
      case 'toggleFullscreen':
        run.toggleFullscreen();
        break;
      default:
        run.flow(command);
    }
  }

  /** Pad and arrow navigation moves focus without a keyboard event, so the page asks for the ring itself until the next pointer press. */
  const showNavFocus = (): void => {
    document.body.classList.add(NAV_KEYS_CLASS);
  };
  const hideNavFocus = (): void => {
    document.body.classList.remove(NAV_KEYS_CLASS);
  };

  function navigateMenu(dir: FocusDirection): void {
    if (!acts('navigate')) return;
    showNavFocus();
    const controls = deps.menuControls();
    const focused = focusedControl(controls);
    if (focused !== null && (dir === 'left' || dir === 'right') && nudgeSlider(focused, dir)) return;
    moveFocus(controls, dir);
  }

  /** A pad button with no menu button focused; on a menu card, where A asks for nothing, A focuses its first button. */
  function runPadCommand(button: 'confirm' | 'back' | 'pause', now: number): void {
    const command = commandForPad(deps.screen(), button);
    if (command !== null) applyCommand(command, now);
    else if (button === 'confirm' && deps.screen() !== 'playing') navigateMenu('down');
  }

  function routePadEdge(edge: PadEdge, now: number): void {
    switch (edge) {
      case 'confirm': {
        const focused = acts('pressFocused') ? focusedControl(deps.menuControls()) : null;
        if (focused === null) runPadCommand('confirm', now);
        else {
          showNavFocus();
          focused.click();
        }
        break;
      }
      case 'back':
        // Back closes the top card: the settings, records or Hangar card when one is open, else what Esc does on the card for the screen.
        if (deps.covers().some((cover) => CARD_COVERS.includes(cover))) deps.closeCard();
        else runPadCommand('back', now);
        break;
      case 'pause':
        runPadCommand('pause', now);
        break;
      default:
        // In play the D-pad and stick steer the ship, which the frame reads as controls.
        if (deps.screen() !== 'playing') navigateMenu(edge);
    }
  }

  // Added ahead of the F key's listener, which a demo-ending F must never reach.
  const demoEnders = swallowDemoEnders(win, () => deps.interrupt(), hideNavFocus);
  const unlisteners = [
    demoEnders.dispose,
    attachFullscreenKey(win, {
      toggle: () => {
        applyCommand(TOGGLE_FULLSCREEN, performance.now());
      },
    }),
  ];

  return {
    applyCommand,
    routeKeys(now) {
      for (const code of keyboard.drainPressed()) {
        startKeys.release(code);
        const direction = arrowDirection(code);
        // Out of play the arrows move menu focus, unless a slider has focus and needs them itself.
        if (direction !== null && deps.screen() !== 'playing') {
          if (!isFormControlTarget(document.activeElement)) navigateMenu(direction);
          continue;
        }
        const command = commandForKey(deps.screen(), code);
        if (command !== null) applyCommand(command, now);
      }
    },
    routePad(pad, edges, now) {
      if (padInUse(pad) && demoEnders.padTouched()) return;
      for (const edge of edges) routePadEdge(edge, now);
    },
    dispose() {
      for (const unlisten of unlisteners) unlisten();
      hideNavFocus();
    },
  };
}
