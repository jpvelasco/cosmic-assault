import { GAME_KEY_CODES } from '../input/keyboard';
import { MAX_PRACTICE_LEVEL, MIN_PRACTICE_LEVEL } from '../sim/world';
import type { AppMode } from './game';

export type Command =
  | { readonly kind: 'start' }
  | { readonly kind: 'selectLevel'; readonly level: number }
  | { readonly kind: 'togglePause' };

const START: Command = { kind: 'start' };
const TOGGLE_PAUSE: Command = { kind: 'togglePause' };
const START_KEYS: ReadonlySet<string> = new Set([...GAME_KEY_CODES, 'Enter']);
const PAUSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyP']);
const RESTART_KEY = 'KeyR';

function levelForKey(code: string): number | null {
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  const level = Number(digit);
  return level >= MIN_PRACTICE_LEVEL && level <= MAX_PRACTICE_LEVEL ? level : null;
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
      return code === RESTART_KEY ? START : null;
  }
}
