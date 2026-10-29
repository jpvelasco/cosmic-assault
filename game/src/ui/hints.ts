import type { InputKind } from '../input/inputKind';

/** Which inputs the hints name: keys (also for a mouse, which sits beside a keyboard), taps, or pad buttons. */
export type InputStyle = 'touch' | 'keys' | 'pad';

/** The hint style for the input kind used last. */
export function inputStyle(kind: InputKind): InputStyle {
  return kind === 'mouse' ? 'keys' : kind;
}

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
  /** The key worn by the button Enter or pad A takes (an end card's first), or empty. */
  readonly confirmKey: string;
  /** The key worn by an end card's Retry when it is not the first button, or empty. */
  readonly retryKey: string;
  /** The key worn by the button Back leads through (Back, or an end card's Map or Title), or empty. */
  readonly backKey: string;
  /** A Rank end card's line on the run that Back leaves saved, or empty. */
  readonly suspend: string;
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
    confirmKey: 'Enter',
    retryKey: 'R',
    backKey: 'Esc',
    suspend: 'Esc suspends the run: pick it up from the title',
  },
  pad: {
    start: 'Press A to start',
    restart: 'Press A to play again',
    choose: 'D-pad to choose, A to go, B back',
    controls: 'Fly with the left stick or D-pad · fire with A, RB or RT',
    resumeKey: 'Start',
    paused: 'Start or B to resume',
    pauseTip: 'Pause (Start or B)',
    confirmKey: 'A',
    retryKey: '',
    backKey: 'B',
    suspend: 'B suspends the run: pick it up from the title',
  },
  touch: {
    start: 'Tap to start',
    restart: 'Tap Retry or Continue to play again',
    choose: 'Tap a mode',
    controls: '',
    resumeKey: '',
    paused: '',
    pauseTip: '',
    confirmKey: '',
    retryKey: '',
    backKey: '',
    suspend: '',
  },
};

export function hintCopy(style: InputStyle): HintCopy {
  return HINTS[style];
}

/** What `pick` reads from the copy of every style: the texts a line may show, whose space it keeps (`reserveSpace`). */
export function hintVariants(pick: (hints: HintCopy) => string): string[] {
  return Object.values(HINTS).map(pick);
}

/** iOS Safari cannot install from a button, so the title card names the steps instead. */
export const IOS_INSTALL_HINT = 'Add to Home Screen: tap Share, then Add to Home Screen';

/** A pad press is no user activation, so browsers keep sound off until a tap or key press; the toast says so once. */
export const SOUND_GESTURE_HINT = 'Tap or press a key to enable sound';
