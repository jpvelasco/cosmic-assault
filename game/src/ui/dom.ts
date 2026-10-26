export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/** Adds `listener` to `target` and returns the function that removes it. */
export function listen(target: EventTarget, type: string, listener: (e: Event) => void): () => void {
  target.addEventListener(type, listener);
  return () => {
    target.removeEventListener(type, listener);
  };
}

export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = element('button', className, text);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

const onButton = (e: Event): boolean => e.target instanceof Element && e.target.closest('button') !== null;

/**
 * Enter and Space on a focused button inside `panel` do that button's action only, as a click does: they never reach
 * the window's key handling, which would start, resume or leave a run. A mouse press on a button leaves no control of
 * the card focused, neither that button nor one the keys or pad had reached, so after a click Space still starts a run.
 */
function keepActivationKeysLocal(panel: HTMLElement): void {
  const stop = (e: KeyboardEvent): void => {
    if ((e.code === 'Enter' || e.code === 'Space') && onButton(e)) e.stopPropagation();
  };
  panel.addEventListener('keydown', stop);
  panel.addEventListener('keyup', stop);
  panel.addEventListener('mousedown', (e) => {
    if (!onButton(e)) return;
    e.preventDefault();
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && panel.contains(focused)) focused.blur();
  });
}

/** A panel holding one glass card, whose buttons keep Enter and Space to themselves. */
export function cardPanel(modifier: string): { panel: HTMLElement; card: HTMLElement } {
  const panel = element('section', `overlay overlay--${modifier}`);
  const card = element('div', 'card');
  panel.append(card);
  keepActivationKeysLocal(panel);
  return { panel, card };
}

/** A glass chip with the classes `chip` and `className` and a test id (the class unless given). */
export function chip(className: string, onClick: () => void, testId = className): HTMLButtonElement {
  const el = button(`chip ${className}`, '', onClick);
  el.dataset['testid'] = testId;
  return el;
}

/** Labels a sound chip with the state it will switch away from. */
export function showSoundState(soundChip: HTMLElement, muted: boolean): void {
  soundChip.textContent = `Sound: ${muted ? 'off' : 'on'}`;
  soundChip.classList.toggle('sound-toggle--muted', muted);
}

/** The buttons and inputs inside `panel` that can take focus right now: not disabled, hidden, covered (inert) or undrawn. */
export function focusableControls(panel: HTMLElement): (HTMLButtonElement | HTMLInputElement)[] {
  return [...panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')].filter(
    (el) => !el.disabled && el.closest('[hidden], [inert]') === null && el.getClientRects().length > 0,
  );
}
