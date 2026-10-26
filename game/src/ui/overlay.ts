import type { Command } from '../app/commands';
import type { FlowState, Screen } from '../app/flow';
import { currentBuildLabel } from '../buildLabel';
import type { SaveData } from '../meta/save';
import type { RankLock } from '../app/runController';
import type { InstallOffer } from '../platform/install';
import { button, cardPanel, chip, element, focusableControls, showSoundState, withTestId } from './dom';
import { createFlowCards } from './flowCards';
import { hintCopy, IOS_INSTALL_HINT, type InputStyle } from './hints';

export interface OverlayActions {
  /** A screen command from a button: the router applies it, through its cover table and the end-card guard. */
  readonly command: (command: Command) => void;
  readonly resume: () => void;
  readonly quit: () => void;
  readonly toggleMute: () => void;
  readonly toggleFullscreen: () => void;
  readonly openSettings: () => void;
  /** The title card's Install chip: shows the browser's install prompt. */
  readonly install: () => void;
}

export interface OverlayState {
  readonly flow: FlowState;
  readonly save: SaveData;
  /** Whether the saved Rank run is being checked, or played in another tab, so it cannot be resumed here. */
  readonly rankLock: RankLock;
  readonly score: number;
  readonly muted: boolean;
  /** Whether the page is in full screen; null where the browser cannot, which hides the chip. */
  readonly fullscreen: boolean | null;
  /** While another card (settings, or the rotate prompt) is over the screen, the cards beneath it ignore taps, keys and Tab. */
  readonly covered: boolean;
  /** Decides whether the start and restart hints name keys or taps. */
  readonly inputStyle: InputStyle;
  /** What the title card offers for installing the game: an Install chip, the iOS steps, or nothing. */
  readonly installOffer: InstallOffer;
}

export interface Overlay {
  update(state: OverlayState): void;
  /** Puts keyboard focus on the Settings chip of the visible card, as the settings card closes. */
  focusSettingsChip(): void;
  /** The controls of the card for `screen` that can take focus now, in document order; none while another card covers it. */
  controls(screen: Screen): HTMLElement[];
  dispose(): void;
}

const INSTALL_TEST_ID = 'install-offer';

/**
 * Adds `el` with `attach` while `shown` and removes it otherwise. A shown element stays where it is, so it keeps
 * focus; a focused one that goes hands focus to its neighbour in the row, so it never drops to the page.
 */
function mountWhen(shown: boolean, el: HTMLElement, attach: (el: HTMLElement) => void): void {
  if (shown) {
    if (el.parentElement === null) attach(el);
    return;
  }
  if (el === document.activeElement) {
    const neighbour = el.nextElementSibling ?? el.previousElementSibling;
    if (neighbour instanceof HTMLElement) neighbour.focus();
  }
  el.remove();
}

/** Calls `onTap` for clicks on `panel` that are not on one of its buttons. */
function onTapOutsideButtons(panel: HTMLElement, onTap: () => void): void {
  panel.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button') !== null) return;
    onTap();
  });
}

function titlePanel(rank: readonly HTMLElement[], chipRow: HTMLElement, startHint: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('title');
  const build = withTestId(element('p', 'build', currentBuildLabel()), 'build-label');
  card.append(element('h1', 'title', 'Cosmic Assault'), ...rank, startHint, chipRow, build);
  return panel;
}

function pausePanel(actions: OverlayActions, quit: HTMLButtonElement, chipRow: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('pause');
  card.append(element('h2', 'heading', 'Paused'), button('menu-button menu-button--primary', 'Resume', actions.resume), quit, chipRow);
  return panel;
}

/** In Rank a Quit mid-galaxy forfeits it, so the button says what it costs. */
const quitLabel = (flow: FlowState): string => (flow.mode === 'rank' ? 'Quit (costs a life)' : 'Quit');
/** A lost run (no lives) can only go on through a Continue, which resets the score. */
const resumeLabel = (save: SaveData): string => (save.rankRun?.lives === 0 ? 'Continue Rank (score resets)' : 'Resume Rank');

/**
 * The screens as DOM layers over the canvas, one visible per screen: the title and pause cards here, the rest from
 * `createFlowCards`. The end cards act only on their buttons, so taps that were aimed at the ship cannot skip the score.
 */
export function createOverlay(root: HTMLElement, actions: OverlayActions): Overlay {
  const send = (command: Command) => (): void => {
    actions.command(command);
  };
  const play = withTestId(button('menu-button menu-button--primary', 'Play', send({ kind: 'start' })), 'play');
  const resumeRank = withTestId(button('menu-button', '', send({ kind: 'resumeRank' })), 'resume-rank');
  const quit = withTestId(button('menu-button', '', actions.quit), 'quit');
  const elsewhere = withTestId(element('p', 'hint', 'This run is playing in another tab'), 'rank-elsewhere');
  const flowCards = createFlowCards(actions.command);
  // One set of chips serves the title and pause cards; `update` moves it into the visible card's row.
  const sound = chip('sound-toggle', actions.toggleMute);
  const fullscreen = chip('fullscreen-toggle', actions.toggleFullscreen);
  const settings = chip('settings-open', actions.openSettings);
  settings.textContent = 'Settings';
  // Only the title card offers to install, and only while the browser can (see src/platform/install.ts).
  const installChip = chip('install-chip', actions.install, INSTALL_TEST_ID);
  installChip.textContent = 'Install';
  const iosHint = withTestId(element('p', 'install-hint', IOS_INSTALL_HINT), INSTALL_TEST_ID);
  const titleRow = element('div', 'chips');
  const pauseRow = element('div', 'chips');
  const chipRows: Partial<Record<Screen, HTMLElement>> = { title: titleRow, paused: pauseRow };
  const startHint = element('p', 'hint');
  const title = titlePanel([play, resumeRank, elsewhere], titleRow, startHint);
  onTapOutsideButtons(title, send({ kind: 'start' }));
  const panels: Partial<Record<Screen, HTMLElement>> = { title, paused: pausePanel(actions, quit, pauseRow), ...flowCards.panels };
  const all = [...new Set(Object.values(panels))];
  root.append(...all);

  return {
    update({ flow, save, rankLock, score, muted, fullscreen: fullscreenState, covered, inputStyle, installOffer }) {
      const { screen } = flow;
      for (const panel of all) {
        panel.hidden = panel !== panels[screen];
        panel.inert = covered;
      }
      const row = chipRows[screen];
      // Moved only on a card change: re-inserting a chip would drop keyboard focus after a toggle. Prepended, so they
      // stay ahead of the title's Install chip.
      if (row !== undefined && sound.parentElement !== row) row.prepend(sound, fullscreen, settings);
      mountWhen(installOffer === 'prompt', installChip, (el) => {
        titleRow.append(el);
      });
      mountWhen(installOffer === 'iosHint', iosHint, (el) => {
        titleRow.after(el);
      });
      showSoundState(sound, muted);
      fullscreen.hidden = fullscreenState === null;
      fullscreen.textContent = fullscreenState === true ? 'Exit full screen' : 'Full screen';
      resumeRank.hidden = save.rankRun === null;
      resumeRank.textContent = resumeLabel(save);
      resumeRank.disabled = rankLock !== 'free';
      elsewhere.hidden = rankLock !== 'elsewhere';
      quit.textContent = quitLabel(flow);
      const hints = hintCopy(inputStyle);
      startHint.textContent = hints.start;
      flowCards.update({ flow, save, score, hints });
    },
    focusSettingsChip() {
      settings.focus();
    },
    controls(screen) {
      const panel = panels[screen];
      return panel === undefined ? [] : focusableControls(panel);
    },
    dispose() {
      for (const panel of all) panel.remove();
    },
  };
}
