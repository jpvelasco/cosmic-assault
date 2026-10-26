export type KeyEventLike = Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'preventDefault'>;

/** Whether a shortcut modifier is down; browser shortcuts like Ctrl+F are never game keys. */
export function hasShortcutModifier(e: Pick<KeyEventLike, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

/**
 * Whether `target` takes typed or arrow-key input of its own (an input, select, textarea or editable element).
 * The game's key handling stands down for it, so arrow keys can move a slider. Duck-typed rather than `instanceof Element`
 * so it also holds for events from other windows and for unit tests without a DOM.
 */
export function isFormControlTarget(target: EventTarget | null): boolean {
  const { tagName, isContentEditable } = (target ?? {}) as Partial<Pick<HTMLElement, 'tagName' | 'isContentEditable'>>;
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || isContentEditable === true;
}
