import { hasShortcutModifier } from '../input/keyEvent';
import { listen } from '../ui/dom';

/** What a pointer press leads to: none of it may act once that press has ended an attract demo. */
const POINTER_FOLLOW_UPS = ['mousedown', 'mouseup', 'click'] as const;

/** Keeps `e` from the game's own handlers and from its browser action (a focused button's press). */
function swallow(e: Event): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

/** The keys whose browser action would act on the page: a focused button's press, a focus move, a scroll. */
const PAGE_ACTION_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', 'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** The keys that press a focused button, whatever modifier is held with them. */
const PRESS_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', 'Space']);

/**
 * Keeps a key from the game's own handlers, and from its browser action where that would act on the page; every other
 * key (F5, F12, a media key) keeps its browser action.
 */
function swallowKey(e: KeyboardEvent): void {
  if (PAGE_ACTION_KEYS.has(e.code)) e.preventDefault();
  e.stopImmediatePropagation();
}

/**
 * Keeps the input that ends an attract demo from doing anything else, listening on `win` in the capture phase, ahead of
 * every other handler. A key press is swallowed with its repeats and its release, so a key held from it never counts as
 * pressed on the title; a pointer press with the mouse presses and click it leads to, until any other input comes.
 * Returns what the pad's frame reading calls, and the function that detaches it all.
 */
export function swallowDemoEnders(win: Window, interrupt: () => boolean, onPointerDown: () => void): { readonly padTouched: () => boolean; readonly dispose: () => void } {
  const heldKeys = new Set<string>();
  let pointerPress = false;

  const onKeyDown = (e: Event): void => {
    pointerPress = false;
    const key = e as KeyboardEvent;
    if (key.repeat && heldKeys.has(key.code)) {
      swallowKey(key);
      return;
    }
    heldKeys.delete(key.code);
    if (!interrupt()) return;
    // A browser shortcut ends a demo too, but keeps its browser action; only a press of the focused button is refused.
    if (hasShortcutModifier(key)) {
      if (PRESS_KEYS.has(key.code)) key.preventDefault();
      return;
    }
    heldKeys.add(key.code);
    swallowKey(key);
  };
  const onKeyUp = (e: Event): void => {
    const key = e as KeyboardEvent;
    if (heldKeys.delete(key.code)) swallowKey(key);
  };
  const onPointer = (): void => {
    onPointerDown();
    pointerPress = interrupt();
  };
  const onFollowUp = (e: Event): void => {
    if (!pointerPress) return;
    swallow(e);
    if (e.type === 'click') pointerPress = false;
  };
  const onBlur = (): void => {
    heldKeys.clear();
    pointerPress = false;
  };
  const unlisteners = [
    listen(win, 'keydown', onKeyDown, true),
    listen(win, 'keyup', onKeyUp, true),
    listen(win, 'pointerdown', onPointer, true),
    ...POINTER_FOLLOW_UPS.map((type) => listen(win, type, onFollowUp, true)),
    listen(win, 'blur', onBlur),
  ];
  return {
    padTouched: () => {
      pointerPress = false;
      return interrupt();
    },
    dispose: () => {
      for (const unlisten of unlisteners) unlisten();
    },
  };
}
