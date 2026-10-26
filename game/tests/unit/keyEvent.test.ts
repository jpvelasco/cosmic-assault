import { describe, expect, it } from 'vitest';
import { hasShortcutModifier, isFormControlTarget } from '../../src/input/keyEvent';

/** The slice of an element the check reads; vitest runs in Node, which has no DOM. */
const element = (tagName: string, isContentEditable = false): EventTarget => ({ tagName, isContentEditable }) as unknown as EventTarget;

describe('isFormControlTarget', () => {
  it.each(['INPUT', 'SELECT', 'TEXTAREA'])('is true for %s', (tag) => {
    expect(isFormControlTarget(element(tag))).toBe(true);
  });

  it('is true for an editable element', () => {
    expect(isFormControlTarget(element('DIV', true))).toBe(true);
  });

  it.each(['BUTTON', 'DIV', 'CANVAS', 'BODY', 'A'])('is false for %s', (tag) => {
    expect(isFormControlTarget(element(tag))).toBe(false);
  });

  it('is false with no target, for the window and for a plain event target', () => {
    expect(isFormControlTarget(null)).toBe(false);
    expect(isFormControlTarget(new EventTarget())).toBe(false);
  });
});

describe('hasShortcutModifier', () => {
  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('is true when %s is down', (key) => {
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: false, altKey: false, [key]: true })).toBe(true);
  });

  it('is false with none down', () => {
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});
