/** The kind of input the player used last: it decides which keys, taps or pad buttons the hints name. */
export type InputKind = 'keys' | 'mouse' | 'touch' | 'pad';

/** The guess before any input: a screen with no hover and a coarse pointer is a phone or tablet. */
export const TOUCH_STYLE_QUERY = '(hover: none) and (pointer: coarse)';

/** The slice of `Window` the tracker listens on, so tests can supply a fake. */
export type InputKindTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface InputKindTracker {
  /** The kind used last; before any input, the guess `TOUCH_STYLE_QUERY` makes. */
  readonly read: () => InputKind;
  /** A pad press, which no event announces: the frame that reads the pad reports it. */
  notePad(): void;
  dispose(): void;
}

/** What a `PointerEvent.pointerType` says: a pen is held like a finger. Null for a type the browser leaves empty. */
export function pointerKind(pointerType: string): InputKind | null {
  if (pointerType === 'mouse') return 'mouse';
  return pointerType === 'touch' || pointerType === 'pen' ? 'touch' : null;
}

/**
 * Tracks the last input kind from key presses and pointer releases on `win` (both in the capture phase, so no card's
 * handler can hide them) and the pad presses the frame reports. A pointer counts as it lets go, so a press never
 * changes the card under the finger or the mouse before its click lands. `onChange` hears each change of kind.
 */
export function trackInputKind(win: InputKindTarget, guessTouch: () => boolean, onChange: () => void): InputKindTracker {
  let used: InputKind | null = null;
  const read = (): InputKind => used ?? (guessTouch() ? 'touch' : 'keys');

  function note(kind: InputKind): void {
    const before = read();
    used = kind;
    if (kind !== before) onChange();
  }

  const onKey = (): void => {
    note('keys');
  };
  const onPointerUp = (e: Event): void => {
    const kind = pointerKind((e as PointerEvent).pointerType);
    if (kind !== null) note(kind);
  };
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('pointerup', onPointerUp, true);

  return {
    read,
    notePad() {
      note('pad');
    },
    dispose() {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('pointerup', onPointerUp, true);
    },
  };
}
