import type { Dimension, GalaxyId } from '../content/types';
import type { PadButton } from '../input/gamepad';
import { GAME_KEY_CODES } from '../input/keyboard';
import { arrowDirection } from '../input/menuFocus';
import type { GalaxyMode } from '../sim/scoring';
import type { Screen } from './flow';

/** The end-card and Back commands, which are the flow's own actions of the same name. */
export type EndCommandKind = 'confirm' | 'next' | 'retry' | 'continue' | 'map' | 'title' | 'back';

export type Command =
  /** The title's Play: mode select, or straight into a `?galaxy=` run. */
  | { readonly kind: 'start' }
  | { readonly kind: 'resumeRank' }
  /**
   * A mode card. A Daily press carries the date its card shows: a card left showing an earlier day is redrawn instead of
   * played, so the player plays what the card shows. Without one, the Daily of today plays.
   */
  | { readonly kind: 'chooseMode'; readonly mode: GalaxyMode; readonly date?: string }
  | { readonly kind: 'openDimension'; readonly dimension: Dimension }
  | { readonly kind: 'openGalaxy'; readonly id: GalaxyId }
  | { readonly kind: EndCommandKind }
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'toggleMute' }
  | { readonly kind: 'toggleFullscreen' };

/** The commands that move between screens: all but pause, mute and full screen. */
export type FlowCommand = Exclude<Command, { readonly kind: 'togglePause' | 'toggleMute' | 'toggleFullscreen' }>;

export const START: Command = { kind: 'start' };
/** Enter or pad A on an end card: its first button. */
export const CONFIRM: Command = { kind: 'confirm' };
const RETRY: Command = { kind: 'retry' };
const BACK: Command = { kind: 'back' };
const TOGGLE_PAUSE: Command = { kind: 'togglePause' };
const TOGGLE_MUTE: Command = { kind: 'toggleMute' };
/** The full-screen chip's command, and the F key's too: the router's `attachFullscreenKey` listener applies it from inside the key handler. */
export const TOGGLE_FULLSCREEN: Command = { kind: 'toggleFullscreen' };
/** The arrow keys are left out: on the title they move menu focus, as on every other card. */
const START_KEYS: ReadonlySet<string> = new Set([...GAME_KEY_CODES, 'Enter'].filter((code) => arrowDirection(code) === null));
const PAUSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyP']);
const MUTE_KEY = 'KeyM';
const RETRY_KEY = 'KeyR';
const BACK_KEY = 'Escape';

/**
 * What a key press (`KeyboardEvent.code`) asks the app to do on `screen`, if anything. On an end card Space is left
 * out: it fires, so a player still holding or mashing it must not skip the card.
 */
export function commandForKey(screen: Screen, code: string): Command | null {
  if (code === MUTE_KEY) return TOGGLE_MUTE;
  switch (screen) {
    case 'title':
      return START_KEYS.has(code) ? START : null;
    case 'modeSelect':
    case 'confirmNewRank':
    case 'map':
    case 'galaxySelect':
      return code === BACK_KEY ? BACK : null;
    case 'playing':
    case 'paused':
      return PAUSE_KEYS.has(code) ? TOGGLE_PAUSE : null;
    case 'results':
    case 'gameOver':
    case 'rankComplete':
      if (code === 'Enter') return CONFIRM;
      if (code === RETRY_KEY) return RETRY;
      return code === BACK_KEY ? BACK : null;
  }
}

/**
 * What a pad button asks for on `screen` when no menu button is focused. Back does what Esc does, except in play, where
 * a stray B must not pause. A and Start play from the title and take an end card's first button; in play and on the
 * pause card Start pauses and resumes. On the menu cards A and Start ask for nothing: A then focuses the first button.
 */
export function commandForPad(screen: Screen, button: PadButton): Command | null {
  if (button === 'back') return screen === 'playing' ? null : commandForKey(screen, BACK_KEY);
  switch (screen) {
    case 'title':
      return START;
    case 'results':
    case 'gameOver':
    case 'rankComplete':
      return CONFIRM;
    case 'paused':
      return TOGGLE_PAUSE;
    case 'playing':
      return button === 'pause' ? TOGGLE_PAUSE : null;
    default:
      return null;
  }
}
