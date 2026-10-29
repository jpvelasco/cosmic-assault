import type { Command } from '../app/commands';
import type { GalaxyId } from '../content/types';

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

/** Adds `listener` to `target` (in the capture phase with `capture`) and returns the function that removes it. */
export function listen(target: EventTarget, type: string, listener: (e: Event) => void, capture = false): () => void {
  target.addEventListener(type, listener, capture);
  return () => {
    target.removeEventListener(type, listener, capture);
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
 * Enter and Space pressed on a focused button inside `panel` do that button's action only, as a click does: they never
 * reach the window's key handling, which would start, resume or leave a run. A key held down from before (Space firing
 * as the run pauses onto a focused Resume) presses nothing: its repeats and its release go on to the window, so the
 * game hears it let go. A mouse press on a button leaves no control of the card focused, neither that button nor one the
 * keys or pad had reached, so after a click Space still starts a run.
 */
function keepActivationKeysLocal(panel: HTMLElement): void {
  /** The activation keys pressed down on one of the panel's buttons and not yet let go there; focus leaving forgets them. */
  const pressedHere = new Set<string>();
  panel.addEventListener('keydown', (e) => {
    if ((e.code !== 'Enter' && e.code !== 'Space') || !onButton(e)) return;
    if (!e.repeat) pressedHere.add(e.code);
    if (pressedHere.has(e.code)) e.stopPropagation();
    else e.preventDefault();
  });
  panel.addEventListener('keyup', (e) => {
    if (pressedHere.delete(e.code) && onButton(e)) e.stopPropagation();
  });
  panel.addEventListener('focusout', () => {
    pressedHere.clear();
  });
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

/** The class of a card's primary action, which wears the accent gradient; Enter and pad A take it on the end cards. */
export const PRIMARY = 'menu-button--primary';
/** A primary menu button's classes. */
export const PRIMARY_BUTTON = `menu-button ${PRIMARY}`;

/** A glass card on its own panel, with a heading and its body; `kind` adds a `card--kind` class for its layout. */
export interface MenuCard {
  readonly panel: HTMLElement;
  readonly card: HTMLElement;
  readonly title: HTMLElement;
}

export function menuCard(kind: string, heading: string, ...body: HTMLElement[]): MenuCard {
  const { panel, card } = cardPanel('menu');
  card.classList.add(`card--${kind}`);
  const title = element('h2', 'heading', heading);
  card.append(title, ...body);
  return { panel, card, title };
}

/** Makes the click handler that sends `command`, so every card button goes through the router like a key. */
export type Act = (command: Command) => () => void;

const SPOKEN_NUMBER = new Intl.NumberFormat();

/** How a galaxy is read aloud: `1-3`, or `Dimension 1 boss` for `1-★`, whose glyph a screen reader would name. */
export const spokenGalaxy = (id: GalaxyId): string => (id.endsWith('-6') ? `Dimension ${id.slice(0, 1)} boss` : id);

/** A score as read aloud, with its thousands grouped. */
export const spokenScore = (score: number): string => SPOKEN_NUMBER.format(score);

/** Stars won, as read aloud: "2 of 3 stars". */
export const spokenStars = (count: number): string => `${String(count)} of 3 stars`;

/** A row of three stars, the first `count` lit; the row reads as one image, "2 of 3 stars". */
export interface StarRow {
  readonly el: HTMLElement;
  set(count: number): void;
}

export function starRow(className: string): StarRow {
  const el = element('span', `stars ${className}`);
  el.setAttribute('role', 'img');
  const stars = [0, 1, 2].map((i) => {
    const star = element('span', 'star', '★');
    star.style.setProperty('--i', String(i));
    return star;
  });
  el.append(...stars);
  return {
    el,
    set(count) {
      el.setAttribute('aria-label', spokenStars(count));
      stars.forEach((star, i) => star.classList.toggle('star--earned', i < count));
    },
  };
}

/** A padlock drawn in CSS, for locked Dimensions and galaxies. */
export const lockIcon = (): HTMLElement => element('span', 'lock');

/** Gives `el` the `data-testid` the e2e specs find it by, and returns it. */
export function withTestId<T extends HTMLElement>(el: T, testId: string): T {
  el.dataset['testid'] = testId;
  return el;
}

/**
 * Gives `host` a key worn in its right padding, drawn only: the button's name stays its label, and `aria-keyshortcuts`
 * names its keys. The padding is the button's whether a key shows or not, so no key moves or resizes it. Returns the
 * setter for the key shown; an empty key hides the mark.
 */
export function wearKey(host: HTMLElement): (key: string) => void {
  host.classList.add('wears-key');
  const mark = element('span', 'key-hint');
  mark.setAttribute('aria-hidden', 'true');
  host.append(mark);
  return (key) => {
    mark.textContent = key;
    mark.hidden = key === '';
  };
}

/**
 * Wraps `line` with a copy of each text it may show (`texts`), stacked in one grid cell with it and never seen, so the
 * wrap is as large as the largest of them whatever `line` shows, or when it hides: a card keeps its size, and its
 * buttons their places, when the input kind changes its words. CSS draws the copies from `data-text`, so no reader,
 * search or text match finds them. Add the wrap where `line` would go; hide the wrap to drop the line.
 */
export function reserveSpace(line: HTMLElement, texts: readonly string[]): HTMLElement {
  const wrap = element('div', 'reserve');
  for (const text of new Set(texts)) {
    if (text === '') continue;
    const copy = element('span', `${line.className} reserve__copy`);
    copy.dataset['text'] = text;
    copy.setAttribute('aria-hidden', 'true');
    wrap.append(copy);
  }
  wrap.append(line);
  return wrap;
}

/** A glass chip with the classes `chip` and `className` and a test id (the class unless given). */
export function chip(className: string, onClick: () => void, testId = className): HTMLButtonElement {
  return withTestId(button(`chip ${className}`, '', onClick), testId);
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
