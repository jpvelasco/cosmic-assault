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
