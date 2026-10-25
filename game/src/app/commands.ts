import { GAME_KEY_CODES } from '../input/keyboard';
import { isPracticeLevel } from '../sim/world';
import type { AppMode } from './game';

export type Command =
  | { readonly kind: 'start' }
  | { readonly kind: 'selectLevel'; readonly level: number }
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'toTitle' };

/** Starts a run from the title, or restarts one from the game-over card. */
export const START: Command = { kind: 'start' };
export const TO_TITLE: Command = { kind: 'toTitle' };
const TOGGLE_PAUSE: Command = { kind: 'togglePause' };
const START_KEYS: ReadonlySet<string> = new Set([...GAME_KEY_CODES, 'Enter']);
const PAUSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyP']);
const RESTART_KEY = 'KeyR';
const TITLE_KEY = 'Escape';

function levelForKey(code: string): number | null {
  const level = Number(/^Digit(\d)$/.exec(code)?.[1]);
  return isPracticeLevel(level) ? level : null;
}

/** What a key press (`KeyboardEvent.code`) asks the app to do in `mode`, if anything. */
export function commandForKey(mode: AppMode, code: string): Command | null {
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
