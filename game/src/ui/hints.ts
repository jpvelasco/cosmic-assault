/** How the player is most likely to be controlling the game; it decides which hints name keys and which name taps. */
export type InputStyle = 'touch' | 'keys';

/** The one media query that decides the style: a screen with no hover and a coarse pointer is a phone or tablet. */
export const TOUCH_STYLE_QUERY = '(hover: none) and (pointer: coarse)';

export interface HintCopy {
  readonly start: string;
  readonly restart: string;
  /** Mode select: what to press to choose, since nothing is focused until a key or tap moves there. */
  readonly choose: string;
}

const HINTS: Readonly<Record<InputStyle, HintCopy>> = {
  keys: { start: 'Press Space to start', restart: 'Press R to play again', choose: 'Arrow keys to choose, Enter to go' },
  touch: { start: 'Tap to start', restart: 'Tap Retry or Continue to play again', choose: 'Tap a mode' },
};

export function hintCopy(style: InputStyle): HintCopy {
  return HINTS[style];
}

/** iOS Safari cannot install from a button, so the title card names the steps instead. */
export const IOS_INSTALL_HINT = 'Add to Home Screen: tap Share, then Add to Home Screen';

/** A pad press is no user activation, so browsers keep sound off until a tap or key press; the toast says so once. */
export const SOUND_GESTURE_HINT = 'Tap or press a key to enable sound';
