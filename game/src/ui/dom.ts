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

export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = element('button', className, text);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

/** A panel holding one glass card. */
export function cardPanel(modifier: string): { panel: HTMLElement; card: HTMLElement } {
  const panel = element('section', `overlay overlay--${modifier}`);
  const card = element('div', 'card');
  panel.append(card);
  return { panel, card };
}

/**
 * Enter and Space on a focused chip act on that chip only: they never reach the window's key handling, which would
 * start a run. A click does not focus it, so after one Space still starts a run.
 */
export function keepActivationKeysLocal(el: HTMLElement): void {
  const stop = (e: KeyboardEvent): void => {
    if (e.code === 'Enter' || e.code === 'Space') e.stopPropagation();
  };
  el.addEventListener('keydown', stop);
  el.addEventListener('keyup', stop);
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
}

/** A glass chip with the classes `chip` and `className` and a test id (the class unless given) that stays out of the game's key handling. */
export function chip(className: string, onClick: () => void, testId = className): HTMLButtonElement {
  const el = button(`chip ${className}`, '', onClick);
  el.dataset['testid'] = testId;
  keepActivationKeysLocal(el);
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
