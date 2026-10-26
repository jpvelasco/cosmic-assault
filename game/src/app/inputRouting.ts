import type { PadEdge } from '../input/gamepad';
import type { KeyboardSource } from '../input/keyboardSource';
import { isFormControlTarget } from '../input/keyEvent';
import type { KeyLatch } from '../input/keyLatch';
import { arrowDirection, type FocusDirection } from '../input/menuFocus';
import { attachFullscreenKey } from '../platform/fullscreen';
import { listen } from '../ui/dom';
import { focusedControl, moveFocus, nudgeSlider } from '../ui/menuNav';
import { commandForKey, commandForPad, TOGGLE_FULLSCREEN, type Command, type FlowCommand } from './commands';
import type { Screen } from './flow';
import { passesGameOverGuard } from './gameOverGuard';

/** What can sit over the game's cards: nothing, the settings card, the rotate prompt or the crash card. */
export type Cover = 'none' | 'settings' | 'rotate' | 'crash';

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
  /** Esc, pad Back or Done closing the settings card. */
  | 'closeSettings';

const Y = true;
const N = false;

/**
 * Which inputs act under which cover; the one place a new screen adds a row or a column. An input acts only when
 * every cover that is up allows it. Under the crash card the loop is dead, so only the synchronous F key still runs.
 */
const ACTS_UNDER: Readonly<Record<RoutedInput, Readonly<Record<Cover, boolean>>>> = {
  start: { none: Y, settings: N, rotate: N, crash: N },
  resume: { none: Y, settings: N, rotate: N, crash: N },
  pause: { none: Y, settings: N, rotate: Y, crash: N },
  leave: { none: Y, settings: N, rotate: Y, crash: N },
  toggleMute: { none: Y, settings: Y, rotate: Y, crash: N },
  toggleFullscreen: { none: Y, settings: Y, rotate: Y, crash: Y },
  navigate: { none: Y, settings: Y, rotate: N, crash: N },
  pressFocused: { none: Y, settings: Y, rotate: N, crash: N },
  closeSettings: { none: Y, settings: Y, rotate: N, crash: N },
};

/** The covers that are up, bottom first; `['none']` when the cards are uncovered. */
export function coversFor(up: { readonly settings: boolean; readonly rotate: boolean; readonly crash: boolean }): Cover[] {
  const covers = (['settings', 'rotate', 'crash'] as const).filter((cover) => up[cover]);
  return covers.length === 0 ? ['none'] : covers;
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
  /** The controls menu focus moves among: the settings card's while it is open, else the card for the screen. */
  menuControls(): HTMLElement[];
  closeSettings(): void;
}

export interface InputRouter {
  /** Runs a key, pad or button command if the game-over guard and the covers allow it. */
  applyCommand(command: Command, now: number): void;
  /** Acts on the key presses since the last frame. */
  routeKeys(now: number): void;
  /** Acts on this frame's pad presses. */
  routePad(edges: readonly PadEdge[], now: number): void;
  dispose(): void;
}

/** Set on `body` while a pad or arrow key drives menu focus; the stylesheet shows the focus ring for it. */
const NAV_KEYS_CLASS = 'nav-keys';

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
        // Back closes the top card: the settings card when it is open, else what Esc does on the card for the screen.
        if (deps.covers().includes('settings')) deps.closeSettings();
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

  const unlisteners = [
    listen(win, 'pointerdown', hideNavFocus),
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
    routePad(edges, now) {
      for (const edge of edges) routePadEdge(edge, now);
    },
    dispose() {
      for (const unlisten of unlisteners) unlisten();
      hideNavFocus();
    },
  };
}
