import type { PadEdge } from '../input/gamepad';
import type { KeyboardSource } from '../input/keyboardSource';
import { isFormControlTarget } from '../input/keyEvent';
import type { KeyLatch } from '../input/keyLatch';
import { arrowDirection, type FocusDirection } from '../input/menuFocus';
import { attachFullscreenKey } from '../platform/fullscreen';
import { listen } from '../ui/dom';
import { focusedControl, moveFocus, nudgeSlider } from '../ui/menuNav';
import { commandForKey, commandForPad, TOGGLE_FULLSCREEN, type Command } from './commands';
import type { AppMode } from './game';
import { passesGameOverGuard } from './gameOverGuard';

/** What can sit over the game's cards: nothing, the settings card, the rotate prompt or the crash card. */
export type Cover = 'none' | 'settings' | 'rotate' | 'crash';

/** The inputs the router hands on: the commands (a pause toggle split by mode), and the menu's own inputs. */
export type RoutedInput =
  | Exclude<Command['kind'], 'togglePause'>
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
  selectLevel: { none: Y, settings: N, rotate: Y, crash: N },
  toTitle: { none: Y, settings: N, rotate: Y, crash: N },
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

export function inputForCommand(command: Command, mode: AppMode): RoutedInput {
  if (command.kind !== 'togglePause') return command.kind;
  return mode === 'playing' ? 'pause' : 'resume';
}

/** Whether `command` runs now: the game-over guard has lapsed and every cover allows it. */
export function commandActs(command: Command, mode: AppMode, covers: readonly Cover[], msSinceGameOver: number): boolean {
  return passesGameOverGuard(mode, command, msSinceGameOver) && actsUnder(inputForCommand(command, mode), covers);
}

/** What a routed command does. */
export interface CommandHandlers {
  start(): void;
  quit(): void;
  selectLevel(level: number): void;
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
  mode(): AppMode;
  covers(): readonly Cover[];
  msSinceGameOver(now: number): number;
  /** The controls menu focus moves among: the settings card's while it is open, else the card for the mode. */
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
    const mode = deps.mode();
    if (!commandActs(command, mode, deps.covers(), deps.msSinceGameOver(now))) return;
    switch (command.kind) {
      case 'start':
        run.start();
        break;
      case 'toTitle':
        run.quit();
        break;
      case 'selectLevel':
        run.selectLevel(command.level);
        break;
      case 'togglePause':
        if (mode === 'playing') run.pause();
        else run.resume();
        break;
      case 'toggleMute':
        run.toggleMute();
        break;
      case 'toggleFullscreen':
        run.toggleFullscreen();
        break;
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

  function runPadCommand(button: 'confirm' | 'back' | 'pause', now: number): void {
    const command = commandForPad(deps.mode(), button);
    if (command !== null) applyCommand(command, now);
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
        // Back closes the top card: the settings card when it is open, else what Esc does on the card for the mode.
        if (deps.covers().includes('settings')) deps.closeSettings();
        else runPadCommand('back', now);
        break;
      case 'pause':
        runPadCommand('pause', now);
        break;
      default:
        // In play the D-pad and stick steer the ship, which the frame reads as controls.
        if (deps.mode() !== 'playing') navigateMenu(edge);
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
        if (direction !== null && deps.mode() !== 'playing') {
          if (!isFormControlTarget(document.activeElement)) navigateMenu(direction);
          continue;
        }
        const command = commandForKey(deps.mode(), code);
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
