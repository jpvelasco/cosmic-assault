import type { AppMode } from '../app/game';
import { currentBuildLabel } from '../buildLabel';
import { MAX_PRACTICE_LEVEL, MIN_PRACTICE_LEVEL } from '../sim/world';
import { button, cardPanel, chip, element, showSoundState } from './dom';
import { hintCopy, type InputStyle } from './hints';

export interface OverlayActions {
  /** A tap on the title screen outside its buttons, or the game-over Restart button. */
  readonly start: () => void;
  readonly selectLevel: (level: number) => void;
  readonly resume: () => void;
  readonly quit: () => void;
  readonly toTitle: () => void;
  readonly toggleMute: () => void;
  readonly toggleFullscreen: () => void;
  readonly openSettings: () => void;
}

export interface OverlayState {
  readonly mode: AppMode;
  readonly practiceLevel: number;
  readonly score: number;
  readonly muted: boolean;
  /** Whether the page is in full screen; null where the browser cannot, which hides the chip. */
  readonly fullscreen: boolean | null;
  /** While another card (settings, or the rotate prompt) is over the screen, the cards beneath it ignore taps, keys and Tab. */
  readonly covered: boolean;
  /** Decides whether the start and restart hints name keys or taps. */
  readonly inputStyle: InputStyle;
}

export interface Overlay {
  update(state: OverlayState): void;
  /** Puts keyboard focus on the Settings chip of the visible card, as the settings card closes. */
  focusSettingsChip(): void;
  dispose(): void;
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

function titlePanel(chips: readonly HTMLButtonElement[], chipRow: HTMLElement, startHint: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('title');
  const label = element('p', 'label', 'Practice level');
  label.id = 'practice-level-label';
  const group = element('div', 'chips');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', label.id);
  group.append(...chips);
  const build = element('p', 'build', currentBuildLabel());
  build.dataset['testid'] = 'build-label';
  card.append(
    element('h1', 'title', 'Cosmic Assault'),
    label,
    group,
    startHint,
    chipRow,
    build,
  );
  return panel;
}

function pausePanel(actions: OverlayActions, chipRow: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('pause');
  card.append(
    element('h2', 'heading', 'Paused'),
    button('menu-button menu-button--primary', 'Resume', actions.resume),
    button('menu-button', 'Quit', actions.quit),
    chipRow,
  );
  return panel;
}

/** Only its buttons act, so taps that were aimed at the ship cannot skip the score. */
function gameOverPanel(score: HTMLElement, restartHint: HTMLElement, actions: OverlayActions): HTMLElement {
  const { panel, card } = cardPanel('game-over');
  card.append(
    element('h2', 'heading', 'Game over'),
    score,
    restartHint,
    button('menu-button menu-button--primary', 'Restart', actions.start),
    button('menu-button', 'Title', actions.toTitle),
  );
  return panel;
}

/** The title, pause and game-over screens as DOM layers over the canvas; one is visible per mode. */
export function createOverlay(root: HTMLElement, actions: OverlayActions): Overlay {
  const chips = levelChips(actions.selectLevel);
  const score = element('p', 'score');
  // One set of chips serves the title and pause cards; `update` moves it into the visible card's row.
  const sound = chip('sound-toggle', actions.toggleMute);
  const fullscreen = chip('fullscreen-toggle', actions.toggleFullscreen);
  const settings = chip('settings-open', actions.openSettings);
  settings.textContent = 'Settings';
  const titleRow = element('div', 'chips');
  const pauseRow = element('div', 'chips');
  const chipRows: Partial<Record<AppMode, HTMLElement>> = { title: titleRow, paused: pauseRow };
  const startHint = element('p', 'hint');
  const restartHint = element('p', 'hint');
  const title = titlePanel(chips, titleRow, startHint);
  const gameOver = gameOverPanel(score, restartHint, actions);
  onTapOutsideButtons(title, actions.start);
  const panels: Partial<Record<AppMode, HTMLElement>> = { title, paused: pausePanel(actions, pauseRow), gameOver };
  const all = Object.values(panels);
  root.append(...all);

  return {
    update({ mode, practiceLevel, score: points, muted, fullscreen: fullscreenState, covered, inputStyle }) {
      for (const panel of all) {
        panel.hidden = panel !== panels[mode];
        panel.inert = covered;
      }
      const row = chipRows[mode];
      // Moved only on a card change: re-inserting a chip would drop keyboard focus after a toggle.
      if (row !== undefined && sound.parentElement !== row) row.append(sound, fullscreen, settings);
      showSoundState(sound, muted);
      fullscreen.hidden = fullscreenState === null;
      fullscreen.textContent = fullscreenState === true ? 'Exit full screen' : 'Full screen';
      for (const [i, chip] of chips.entries()) {
        chip.setAttribute('aria-pressed', String(i + MIN_PRACTICE_LEVEL === practiceLevel));
      }
      score.textContent = `Score ${String(points)}`;
      const hints = hintCopy(inputStyle);
      startHint.textContent = hints.start;
      restartHint.textContent = hints.restart;
    },
    focusSettingsChip() {
      settings.focus();
    },
    dispose() {
      for (const panel of all) panel.remove();
    },
  };
}
