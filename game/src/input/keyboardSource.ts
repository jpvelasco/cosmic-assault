import { GAME_KEY_CODES } from './keyboard';

type KeyEventLike = Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'preventDefault'>;

/** The slice of `Window` the adapter needs, so tests can supply a fake. */
export interface KeyboardTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (e: KeyEventLike) => void): void;
  addEventListener(type: 'blur', listener: () => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (e: KeyEventLike) => void): void;
  removeEventListener(type: 'blur', listener: () => void): void;
}

export interface KeyboardSource {
  /** `KeyboardEvent.code`s currently held. */
  readonly held: ReadonlySet<string>;
  /** Codes pressed (not auto-repeat) since the last drain, in order; clears them. */
  drainPressed(): readonly string[];
  dispose(): void;
}

/** Releasing these can swallow the keyups of keys pressed while they were down (macOS Cmd). */
const MODIFIER_CODES: ReadonlySet<string> = new Set(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight']);

export function attachKeyboard(target: KeyboardTarget): KeyboardSource {
  const held = new Set<string>();
  let pressed: string[] = [];

  const onKeyDown = (e: KeyEventLike): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (GAME_KEY_CODES.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (!e.repeat) pressed.push(e.code);
  };
  const onKeyUp = (e: KeyEventLike): void => {
    if (MODIFIER_CODES.has(e.code)) held.clear();
    if (GAME_KEY_CODES.has(e.code)) e.preventDefault();
    held.delete(e.code);
  };
  const onBlur = (): void => {
    held.clear();
    pressed = [];
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    held,
    drainPressed() {
      const drained = pressed;
      pressed = [];
      return drained;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      onBlur();
    },
  };
}
