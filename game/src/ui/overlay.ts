import type { AppMode } from '../app/game';
import { formatBuildLabel } from '../buildLabel';
import { MAX_PRACTICE_LEVEL, MIN_PRACTICE_LEVEL } from '../sim/world';

export interface OverlayActions {
  /** A tap on the title or game-over screen outside its buttons. */
  readonly tap: () => void;
  readonly selectLevel: (level: number) => void;
  readonly resume: () => void;
  readonly quit: () => void;
  readonly toTitle: () => void;
}

export interface OverlayState {
  readonly mode: AppMode;
  readonly practiceLevel: number;
  readonly score: number;
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
      button('chip', String(level), () => {
        selectLevel(level);
      }),
    );
  }
  return chips;
}

function titlePanel(chips: readonly HTMLButtonElement[]): HTMLElement {
  const panel = element('section', 'overlay overlay--title');
  const label = element('p', 'label', 'Practice level');
  label.id = 'practice-level-label';
  const group = element('div', 'chips');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', label.id);
  group.append(...chips);
  const build = element('p', 'build', formatBuildLabel(__BUILD_SHA__ || undefined, __BUILD_DATE__));
  build.dataset['testid'] = 'build-label';
  panel.append(
    element('h1', 'title', 'Cosmic Assault'),
    label,
    group,
    element('p', 'hint', 'Press a key or tap to start'),
    build,
  );
  return panel;
}

function pausePanel(actions: OverlayActions): HTMLElement {
  const panel = element('section', 'overlay overlay--pause');
  const card = element('div', 'card');
  card.append(
    element('h2', 'heading', 'Paused'),
    button('menu-button', 'Resume', actions.resume),
    button('menu-button', 'Quit', actions.quit),
  );
  panel.append(card);
  return panel;
}

function gameOverPanel(score: HTMLElement, toTitle: () => void): HTMLElement {
  const panel = element('section', 'overlay overlay--game-over');
  const card = element('div', 'card');
  card.append(
    element('h2', 'heading', 'Game over'),
    score,
    element('p', 'hint', 'Press R or tap to restart'),
    button('menu-button', 'Title', toTitle),
  );
  panel.append(card);
  return panel;
}

/** The title, pause and game-over screens as DOM layers over the canvas; one is visible per mode. */
export function createOverlay(root: HTMLElement, actions: OverlayActions): Overlay {
  const chips = levelChips(actions.selectLevel);
  const score = element('p', 'score');
  const title = titlePanel(chips);
  const gameOver = gameOverPanel(score, actions.toTitle);
  onTapOutsideButtons(title, actions.tap);
  onTapOutsideButtons(gameOver, actions.tap);
  const panels: Partial<Record<AppMode, HTMLElement>> = { title, paused: pausePanel(actions), gameOver };
  const all = Object.values(panels);
  root.append(...all);

  return {
    update({ mode, practiceLevel, score: points }) {
      for (const panel of all) panel.hidden = panel !== panels[mode];
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
