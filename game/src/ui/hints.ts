/** How the player is most likely to be controlling the game; it decides which hints name keys and which name taps. */
export type InputStyle = 'touch' | 'keys';

/** The one media query that decides the style: a screen with no hover and a coarse pointer is a phone or tablet. */
export const TOUCH_STYLE_QUERY = '(hover: none) and (pointer: coarse)';

export interface HintCopy {
  readonly start: string;
  readonly restart: string;
  /** Mode select: what to press to choose, since nothing is focused until a key or tap moves there. */
  readonly choose: string;
  /** Title: how to fly and fire, or empty where the touch controls speak for themselves. */
  readonly controls: string;
  /** The key worn beside the pause card's Resume, or empty where there are no keys to name. */
  readonly resumeKey: string;
  /** The pause card's line on the keys that resume, or empty. */
  readonly paused: string;
  /** The pause button's tooltip in play, naming its keys, or empty where a tooltip never shows. */
  readonly pauseTip: string;
}

const HINTS: Readonly<Record<InputStyle, HintCopy>> = {
  keys: {
    start: 'Press Space to start',
    restart: 'Press R to play again',
    choose: 'Arrow keys to choose, Enter to go',
    controls: 'Fly with the arrows or WASD · fire with Space, Z or X',
    resumeKey: 'Esc',
    paused: 'Esc or P to resume',
    pauseTip: 'Pause (Esc or P)',
  },
  touch: { start: 'Tap to start', restart: 'Tap Retry or Continue to play again', choose: 'Tap a mode', controls: '', resumeKey: '', paused: '', pauseTip: '' },
};

export function hintCopy(style: InputStyle): HintCopy {
  return HINTS[style];
}

/** iOS Safari cannot install from a button, so the title card names the steps instead. */
export const IOS_INSTALL_HINT = 'Add to Home Screen: tap Share, then Add to Home Screen';

/** A pad press is no user activation, so browsers keep sound off until a tap or key press; the toast says so once. */
export const SOUND_GESTURE_HINT = 'Tap or press a key to enable sound';
