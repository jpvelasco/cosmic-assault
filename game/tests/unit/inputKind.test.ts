import { describe, expect, it, vi } from 'vitest';
import { pointerKind, trackInputKind } from '../../src/input/inputKind';

const pointerUp = (pointerType: string): Event => Object.assign(new Event('pointerup'), { pointerType });

function tracker(touchScreen = false) {
  const win = new EventTarget();
  const guess = { touch: touchScreen };
  const onChange = vi.fn();
  return { win, guess, onChange, kind: trackInputKind(win, () => guess.touch, onChange) };
}

describe('pointerKind', () => {
  it('reads a mouse as a mouse, and a finger or a pen as touch', () => {
    expect(pointerKind('mouse')).toBe('mouse');
    expect(pointerKind('touch')).toBe('touch');
    expect(pointerKind('pen')).toBe('touch');
  });

  it('reads nothing into a type the browser left empty', () => {
    expect(pointerKind('')).toBeNull();
  });
});

describe('trackInputKind', () => {
  it('guesses from the media query before any input, and follows it while nothing has been used', () => {
    const { kind, guess } = tracker(true);
    expect(kind.read()).toBe('touch');
    guess.touch = false;
    expect(kind.read()).toBe('keys');
  });

  it('follows the last input used, whatever the media query says', () => {
    const { win, kind, guess } = tracker(true);
    win.dispatchEvent(new Event('keydown'));
    expect(kind.read()).toBe('keys');
    guess.touch = true;
    expect(kind.read()).toBe('keys');
    kind.notePad();
    expect(kind.read()).toBe('pad');
    win.dispatchEvent(pointerUp('touch'));
    expect(kind.read()).toBe('touch');
    win.dispatchEvent(pointerUp('mouse'));
    expect(kind.read()).toBe('mouse');
  });

  it('counts a pointer as it lets go, not as it presses', () => {
    const { win, kind } = tracker(false);
    win.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'touch' }));
    expect(kind.read()).toBe('keys');
    win.dispatchEvent(pointerUp('touch'));
    expect(kind.read()).toBe('touch');
  });

  it('keeps the kind it has for a pointer of no known type', () => {
    const { win, kind, onChange } = tracker(false);
    kind.notePad();
    win.dispatchEvent(pointerUp(''));
    expect(kind.read()).toBe('pad');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('tells of each change of kind once, and of nothing that keeps the kind, the guess confirmed included', () => {
    const { win, kind, onChange } = tracker(false);
    win.dispatchEvent(new Event('keydown'));
    expect(onChange).not.toHaveBeenCalled();
    kind.notePad();
    kind.notePad();
    expect(onChange).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('keydown'));
    win.dispatchEvent(new Event('keydown'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
