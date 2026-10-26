import { GAME_KEY_CODES } from '../input/keyboard';
import { arrowDirection } from '../input/menuFocus';
import { isPracticeLevel } from '../sim/world';
import type { AppMode } from './game';

export type Command =
  | { readonly kind: 'start' }
  | { readonly kind: 'selectLevel'; readonly level: number }
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'toTitle' }
  | { readonly kind: 'toggleMute' }
  | { readonly kind: 'toggleFullscreen' };

/** Starts a run from the title, or restarts one from the game-over card. */
export const START: Command = { kind: 'start' };
export const TO_TITLE: Command = { kind: 'toTitle' };
const TOGGLE_PAUSE: Command = { kind: 'togglePause' };
const TOGGLE_MUTE: Command = { kind: 'toggleMute' };
/** The full-screen chip's command. The F key does not use it: see `attachFullscreenKey`. */
export const TOGGLE_FULLSCREEN: Command = { kind: 'toggleFullscreen' };
/** The arrow keys are left out: on the title they move menu focus, as on every other card. */
const START_KEYS: ReadonlySet<string> = new Set([...GAME_KEY_CODES, 'Enter'].filter((code) => arrowDirection(code) === null));
const PAUSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyP']);
const MUTE_KEY = 'KeyM';
const RESTART_KEY = 'KeyR';
const TITLE_KEY = 'Escape';

function levelForKey(code: string): number | null {
  const level = Number(/^Digit(\d)$/.exec(code)?.[1]);
  return isPracticeLevel(level) ? level : null;
}

/** What a key press (`KeyboardEvent.code`) asks the app to do in `mode`, if anything. */
export function commandForKey(mode: AppMode, code: string): Command | null {
  if (code === MUTE_KEY) return TOGGLE_MUTE;
  switch (mode) {
    case 'title': {
      const level = levelForKey(code);
      if (level !== null) return { kind: 'selectLevel', level };
      return START_KEYS.has(code) ? START : null;
    }
    case 'playing':
    case 'paused':
      return PAUSE_KEYS.has(code) ? TOGGLE_PAUSE : null;
    case 'gameOver':
      if (code === RESTART_KEY) return START;
      return code === TITLE_KEY ? TO_TITLE : null;
  }
}

/**
 * What a pad button asks for in `mode` when no menu button is focused. Back does what Esc does, except in play, where
 * a stray B must not pause; Start starts from the title and game over, and pauses or resumes otherwise.
 */
export function commandForPad(mode: AppMode, button: 'confirm' | 'back' | 'pause'): Command | null {
  const idle = mode === 'title' || mode === 'gameOver';
  switch (button) {
    case 'confirm':
      return idle ? START : mode === 'paused' ? TOGGLE_PAUSE : null;
    case 'back':
      return mode === 'playing' ? null : commandForKey(mode, TITLE_KEY);
    case 'pause':
      return idle ? START : TOGGLE_PAUSE;
  }
}
