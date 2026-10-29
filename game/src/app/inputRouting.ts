import { padInUse, type PadEdge, type PadSnapshot } from '../input/gamepad';
import type { KeyboardSource } from '../input/keyboardSource';
import { isFormControlTarget } from '../input/keyEvent';
import type { KeyLatch } from '../input/keyLatch';
import { arrowDirection, type FocusDirection } from '../input/menuFocus';
import { attachFullscreenKey } from '../platform/fullscreen';
import { listen } from '../ui/dom';
import { focusedControl, moveFocus, nudgeSlider } from '../ui/menuNav';
import { COVER_CARD_IDS, type CoverCardId } from './cardToggle';
import { commandForKey, commandForPad, TOGGLE_FULLSCREEN, type Command, type FlowCommand } from './commands';
import { swallowDemoEnders } from './demoEnders';
import type { Screen } from './flow';
import { passesGameOverGuard } from './gameOverGuard';

/** What can sit over the game's cards: nothing, a cover card (settings, records, Hangar), the rotate prompt or the crash card. */
export type Cover = 'none' | CoverCardId | 'rotate' | 'crash';

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
  /** Esc, pad B, Done or Back closing the settings, records or Hangar card. */
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

/** Every cover, bottom first: the cover cards, then the rotate prompt and the crash card over them. */
const COVERS = [...COVER_CARD_IDS, 'rotate', 'crash'] as const;

const isCoverCard = (cover: Cover): cover is CoverCardId => (COVER_CARD_IDS as readonly Cover[]).includes(cover);

/** Which covers are up. */
export type CoversUp = Readonly<Record<Exclude<Cover, 'none'>, boolean>>;

/** A table with no cover up, for a caller to refill in place. */
export const noCoversUp = (): Record<Exclude<Cover, 'none'>, boolean> =>
  Object.fromEntries(COVERS.map((cover) => [cover, false])) as Record<Exclude<Cover, 'none'>, boolean>;

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
  /** The controls menu focus moves among: the top cover card's, else the card for the screen. */
  menuControls(): HTMLElement[];
  /** Closes the topmost cover card. */
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
  /**
   * Acts on this frame's pad presses (`edges`, from the snapshot `pad` read this frame). True when the frame ended an
   * attract demo instead, so its presses must do nothing else.
   */
  routePad(pad: PadSnapshot | null, edges: readonly PadEdge[], now: number): boolean;
  dispose(): void;
}

/** Set on `body` while a pad or arrow key drives menu focus; the stylesheet shows the focus ring for it. */
const NAV_KEYS_CLASS = 'nav-keys';

/**
 * Turns keys, pad presses and the synchronous F key into commands and menu moves, through the one cover table.
 * Listens on `win` for F (full screen must be asked for inside the key handler), for the pointer press that hides the
 * pad's focus ring, and, ahead of every other handler, for the key, pointer or pad input that ends an attract demo,
 * which it swallows (`swallowDemoEnders`), and for the Esc that closes a cover card.
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

  const cardUp = (): boolean => deps.covers().some(isCoverCard);
  /** Esc and pad B with a cover card up close it, unless the rotate prompt is over it too. */
  const closeTopCard = (): void => {
    if (acts('closeCard')) deps.closeCard();
  };

  /**
   * Esc with a cover card up closes that card alone, from any focus (a focused slider's too). It is taken ahead of the
   * game's own key handling, which never hears it, so the same press cannot also resume or go back; its repeats close
   * nothing more.
   */
  const onEscape = (e: Event): void => {
    const { code, repeat } = e as KeyboardEvent;
    if (code !== 'Escape' || !cardUp()) return;
    e.stopImmediatePropagation();
    if (!repeat) closeTopCard();
  };

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
        // B closes the top cover card when one is up, else does what Esc does on the screen.
        if (cardUp()) closeTopCard();
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

  // Listens in the capture phase, so a demo-ending F is swallowed before the F key's own (bubble-phase) listener sees it.
  const demoEnders = swallowDemoEnders(win, () => deps.interrupt(), hideNavFocus);
  const unlisteners = [
    demoEnders.dispose,
    listen(win, 'keydown', onEscape, true),
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
      if (padInUse(pad) && demoEnders.padTouched()) return true;
      for (const edge of edges) routePadEdge(edge, now);
      return false;
    },
    dispose() {
      for (const unlisten of unlisteners) unlisten();
      hideNavFocus();
    },
  };
}
