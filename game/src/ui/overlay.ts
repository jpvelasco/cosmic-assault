import type { AppMode } from '../app/game';
import { formatBuildLabel } from '../buildLabel';
import { MAX_PRACTICE_LEVEL, MIN_PRACTICE_LEVEL } from '../sim/world';

export interface OverlayActions {
  /** A tap on the title screen outside its buttons, or the game-over Restart button. */
  readonly start: () => void;
  readonly selectLevel: (level: number) => void;
  readonly resume: () => void;
  readonly quit: () => void;
  readonly toTitle: () => void;
  readonly toggleMute: () => void;
}

export interface OverlayState {
  readonly mode: AppMode;
  readonly practiceLevel: number;
  readonly score: number;
  readonly muted: boolean;
}

export interface Overlay {
  update(state: OverlayState): void;
  dispose(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = element('button', className, text);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

/** Calls `onTap` for clicks on `panel` that are not on one of its buttons. */
function onTapOutsideButtons(panel: HTMLElement, onTap: () => void): void {
  panel.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button') !== null) return;
    onTap();
  });
}

function levelChips(selectLevel: (level: number) => void): HTMLButtonElement[] {
  const chips: HTMLButtonElement[] = [];
  for (let level = MIN_PRACTICE_LEVEL; level <= MAX_PRACTICE_LEVEL; level++) {
    chips.push(
      button('level-chip', String(level), () => {
        selectLevel(level);
      }),
    );
  }
  return chips;
}

/** A panel holding one glass card. */
function cardPanel(modifier: string): { panel: HTMLElement; card: HTMLElement } {
  const panel = element('section', `overlay overlay--${modifier}`);
  const card = element('div', 'card');
  panel.append(card);
  return { panel, card };
}

function titlePanel(chips: readonly HTMLButtonElement[], soundSlot: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('title');
  const label = element('p', 'label', 'Practice level');
  label.id = 'practice-level-label';
  const group = element('div', 'chips');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', label.id);
  group.append(...chips);
  const build = element('p', 'build', formatBuildLabel(__BUILD_SHA__ || undefined, __BUILD_DATE__));
  build.dataset['testid'] = 'build-label';
  card.append(
    element('h1', 'title', 'Cosmic Assault'),
    label,
    group,
    element('p', 'hint', 'Press Space or tap to start'),
    soundSlot,
    build,
  );
  return panel;
}

function pausePanel(actions: OverlayActions, soundSlot: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('pause');
  card.append(
    element('h2', 'heading', 'Paused'),
    button('menu-button menu-button--primary', 'Resume', actions.resume),
    button('menu-button', 'Quit', actions.quit),
    soundSlot,
  );
  return panel;
}

/** Only its buttons act, so taps that were aimed at the ship cannot skip the score. */
function gameOverPanel(score: HTMLElement, actions: OverlayActions): HTMLElement {
  const { panel, card } = cardPanel('game-over');
  card.append(
    element('h2', 'heading', 'Game over'),
    score,
    element('p', 'hint', 'Press R to restart'),
    button('menu-button menu-button--primary', 'Restart', actions.start),
    button('menu-button', 'Title', actions.toTitle),
  );
  return panel;
}

/** The title, pause and game-over screens as DOM layers over the canvas; one is visible per mode. */
export function createOverlay(root: HTMLElement, actions: OverlayActions): Overlay {
  const chips = levelChips(actions.selectLevel);
  const score = element('p', 'score');
  // One sound chip serves the title and pause cards; `update` moves it into the visible card's slot.
  const sound = button('sound-toggle', '', actions.toggleMute);
  sound.dataset['testid'] = 'sound-toggle';
  const titleSlot = element('div', 'sound-slot');
  const pauseSlot = element('div', 'sound-slot');
  const soundSlots: Partial<Record<AppMode, HTMLElement>> = { title: titleSlot, paused: pauseSlot };
  const title = titlePanel(chips, titleSlot);
  const gameOver = gameOverPanel(score, actions);
  onTapOutsideButtons(title, actions.start);
  const panels: Partial<Record<AppMode, HTMLElement>> = { title, paused: pausePanel(actions, pauseSlot), gameOver };
  const all = Object.values(panels);
  root.append(...all);

  return {
    update({ mode, practiceLevel, score: points, muted }) {
      for (const panel of all) panel.hidden = panel !== panels[mode];
      const slot = soundSlots[mode];
      // Moved only on a card change: re-inserting it would drop keyboard focus after a toggle.
      if (slot !== undefined && sound.parentElement !== slot) slot.append(sound);
      sound.textContent = `Sound: ${muted ? 'off' : 'on'}`;
      sound.setAttribute('aria-pressed', String(muted));
      for (const [i, chip] of chips.entries()) {
        chip.setAttribute('aria-pressed', String(i + MIN_PRACTICE_LEVEL === practiceLevel));
      }
      score.textContent = `Score ${String(points)}`;
    },
    dispose() {
      for (const panel of all) panel.remove();
    },
  };
}
