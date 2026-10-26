/** How the player is most likely to be controlling the game; it decides which hints name keys and which name taps. */
export type InputStyle = 'touch' | 'keys';

/** The one media query that decides the style: a screen with no hover and a coarse pointer is a phone or tablet. */
export const TOUCH_STYLE_QUERY = '(hover: none) and (pointer: coarse)';

export interface HintCopy {
  readonly start: string;
  readonly restart: string;
}

const HINTS: Readonly<Record<InputStyle, HintCopy>> = {
  keys: { start: 'Press Space to start', restart: 'Press R to restart' },
  touch: { start: 'Tap to start', restart: 'Tap Restart to play again' },
};

export function hintCopy(style: InputStyle): HintCopy {
  return HINTS[style];
}

/** The style for the result of `matchMedia(TOUCH_STYLE_QUERY).matches`. */
export function inputStyleFor(touchStyleMatches: boolean): InputStyle {
  return touchStyleMatches ? 'touch' : 'keys';
}
