import type { Command } from '../app/commands';
import type { FlowState, Screen } from '../app/flow';
import { currentBuildLabel } from '../buildLabel';
import type { SaveData } from '../meta/save';
import type { RankLock } from '../app/runController';
import { galaxyLabel } from '../content/galaxies';
import type { InstallOffer } from '../platform/install';
import type { SimEvent } from '../sim/events';
import { createBossAnnouncer } from './bossAnnouncer';
import { createDimensionMap } from './dimensionMap';
import { button, cardPanel, chip, element, focusableControls, PRIMARY, PRIMARY_BUTTON, showSoundState, withTestId, type Act, type MenuCard } from './dom';
import { createGalaxySelect } from './galaxySelect';
import { hintCopy, IOS_INSTALL_HINT, type InputStyle } from './hints';
import { createModeSelect } from './modeSelect';
import { createResultsCard } from './resultsCard';

export interface OverlayActions {
  /** A screen command from a button: the router applies it, through its cover table and the end-card guard. */
  readonly command: (command: Command) => void;
  readonly resume: () => void;
  readonly quit: () => void;
  readonly toggleMute: () => void;
  readonly toggleFullscreen: () => void;
  readonly openSettings: () => void;
  /** The Records chip on the title and mode select. */
  readonly openRecords: () => void;
  /** The Hangar chip on the title and mode select. */
  readonly openHangar: () => void;
  /** The title card's Install chip: shows the browser's install prompt. */
  readonly install: () => void;
}

export interface OverlayState {
  readonly flow: FlowState;
  readonly save: SaveData;
  /** Whether the saved Rank run is being checked, or played in another tab, so it cannot be resumed here. */
  readonly rankLock: RankLock;
  /** The galaxy's score, which the end cards show. */
  readonly score: number;
  readonly muted: boolean;
  /** Whether the page is in full screen; null where the browser cannot, which hides the chip. */
  readonly fullscreen: boolean | null;
  /** While another card (settings, records, Hangar or the rotate prompt) is over the screen, the cards beneath it ignore taps, keys and Tab. */
  readonly covered: boolean;
  /** Decides whether the start and restart hints name keys or taps. */
  readonly inputStyle: InputStyle;
  /** What the title card offers for installing the game: an Install chip, the iOS steps, or nothing. */
  readonly installOffer: InstallOffer;
}

export interface Overlay {
  update(state: OverlayState): void;
  /** One step's events: a boss's arrival, phases and fall are announced to screen readers. */
  handle(events: readonly SimEvent[]): void;
  /** Puts keyboard focus on the visible card's Settings, Records or Hangar chip, as the card it opened closes. */
  focusChip(which: 'settings' | 'records' | 'hangar'): void;
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

function titlePanel(play: HTMLElement, resumeSlot: HTMLElement, chipRow: HTMLElement, startHint: HTMLElement, controlsHint: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('title');
  const build = withTestId(element('p', 'build', currentBuildLabel()), 'build-label');
  card.append(element('h1', 'title', 'Cosmic Assault'), play, resumeSlot, startHint, controlsHint, chipRow, build);
  return panel;
}

function pausePanel(actions: OverlayActions, quit: HTMLButtonElement, chipRow: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('pause');
  card.append(element('h2', 'heading', 'Paused'), button(PRIMARY_BUTTON, 'Resume', actions.resume), quit, chipRow);
  return panel;
}

/** In Rank a Quit mid-galaxy forfeits it, so the button says what it costs. */
const quitLabel = (flow: FlowState): string => (flow.mode === 'rank' ? 'Quit (costs a life)' : 'Quit');
/** A lost run (no lives) can only go on through a Continue, which resets the score. */
const resumeLabel = (save: SaveData): string => (save.rankRun?.lives === 0 ? 'Continue Rank (score resets)' : 'Resume Rank');

/** Where the saved run stands, under its Resume button. */
function savedRunText(save: SaveData): string {
  const run = save.rankRun;
  if (run === null) return '';
  if (run.lives === 0) return `Run lost at ${galaxyLabel(run.next)}`;
  return `${galaxyLabel(run.next)} · ${String(run.lives)} ${run.lives === 1 ? 'life' : 'lives'} · ${String(run.score)}`;
}

/** Moves `el` into `host` if it is elsewhere: only on a screen change, so a focused control keeps its focus. */
function keepIn(host: HTMLElement | undefined, el: HTMLElement): void {
  if (host !== undefined && el.parentElement !== host) host.append(el);
}

/**
 * The screens as DOM layers over the canvas, one visible per screen: the title and pause cards here, mode select, the
 * Dimension map, galaxy select and the end card from their own modules. Every card button sends a command, so the
 * router's cover table and the end-card guard apply to taps as to keys. The end cards act only on their buttons, so
 * taps that were aimed at the ship cannot skip the score.
 */
export function createOverlay(root: HTMLElement, actions: OverlayActions): Overlay {
  const send: Act = (command: Command) => (): void => {
    actions.command(command);
  };
  const play = withTestId(button(PRIMARY_BUTTON, 'Play', send({ kind: 'start' })), 'play');
  const quit = withTestId(button('menu-button', '', actions.quit), 'quit');
  // One Resume Rank group, with where the run stands and whether another tab plays it, on the title and mode select.
  const resumeRank = withTestId(button('menu-button', '', send({ kind: 'resumeRank' })), 'resume-rank');
  const savedRun = element('p', 'hint resume-summary');
  const elsewhere = withTestId(element('p', 'hint', 'This run is playing in another tab'), 'rank-elsewhere');
  const resumeGroup = element('div', 'resume-group');
  resumeGroup.append(resumeRank, savedRun, elsewhere);
  const titleResumeSlot = element('div', 'resume-slot');
  // One shared Back, moved into the menu card shown, so its test id stays unique.
  const back = withTestId(button('menu-button', 'Back', send({ kind: 'back' })), 'back');
  const modes = createModeSelect(send);
  const dimensionMap = createDimensionMap(send);
  const galaxySelect = createGalaxySelect(send);
  const results = createResultsCard(send);
  /** The menu cards, which take the shared Back. */
  const menus: Partial<Record<Screen, MenuCard>> = { modeSelect: modes.modeSelect, confirmNewRank: modes.confirmNewRank, map: dimensionMap, galaxySelect };
  const resumeSlots: Partial<Record<Screen, HTMLElement>> = { title: titleResumeSlot, modeSelect: modes.resumeSlot };
  // One set of chips serves the title and pause cards; `update` moves it into the visible card's row.
  const sound = chip('sound-toggle', actions.toggleMute);
  const fullscreen = chip('fullscreen-toggle', actions.toggleFullscreen);
  const settings = chip('settings-open', actions.openSettings);
  settings.textContent = 'Settings';
  const records = chip('records-open', actions.openRecords);
  records.textContent = 'Records';
  const hangar = chip('hangar-open', actions.openHangar);
  hangar.textContent = 'Hangar';
  const coverChips = { settings, records, hangar };
  // Only the title card offers to install, and only while the browser can (see src/platform/install.ts).
  const installChip = chip('install-chip', actions.install, INSTALL_TEST_ID);
  installChip.textContent = 'Install';
  const iosHint = withTestId(element('p', 'install-hint', IOS_INSTALL_HINT), INSTALL_TEST_ID);
  const titleRow = element('div', 'chips');
  const pauseRow = element('div', 'chips');
  const chipRows: Partial<Record<Screen, HTMLElement>> = { title: titleRow, paused: pauseRow };
  const startHint = element('p', 'hint');
  const controlsHint = withTestId(element('p', 'hint'), 'controls-hint');
  const title = titlePanel(play, titleResumeSlot, titleRow, startHint, controlsHint);
  onTapOutsideButtons(title, send({ kind: 'start' }));
  const panels: Partial<Record<Screen, HTMLElement>> = {
    title,
    paused: pausePanel(actions, quit, pauseRow),
    results: results.panel,
    gameOver: results.panel,
    rankComplete: results.panel,
  };
  for (const [screen, menu] of Object.entries(menus) as [Screen, MenuCard][]) panels[screen] = menu.panel;
  const all = [...new Set(Object.values(panels))];
  root.append(...all);
  const announcer = createBossAnnouncer(root);

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
      // Records and Hangar sit after Settings on the title, and ahead of Back in the last row of mode select.
      if (screen === 'title' && records.previousElementSibling !== settings) settings.after(records, hangar);
      else if (screen === 'modeSelect' && records.parentElement !== modes.chipRow) modes.chipRow.prepend(records, hangar);
      mountWhen(installOffer === 'prompt', installChip, (el) => {
        titleRow.append(el);
      });
      mountWhen(installOffer === 'iosHint', iosHint, (el) => {
        titleRow.after(el);
      });
      showSoundState(sound, muted);
      fullscreen.hidden = fullscreenState === null;
      fullscreen.textContent = fullscreenState === true ? 'Exit full screen' : 'Full screen';
      keepIn(screen === 'modeSelect' ? modes.chipRow : menus[screen]?.card, back);
      keepIn(resumeSlots[screen], resumeGroup);
      resumeGroup.hidden = save.rankRun === null;
      resumeRank.textContent = resumeLabel(save);
      resumeRank.disabled = rankLock !== 'free';
      // On mode select Resume leads, ahead of the two mode cards.
      resumeRank.classList.toggle(PRIMARY, screen === 'modeSelect');
      savedRun.textContent = savedRunText(save);
      elsewhere.hidden = rankLock !== 'elsewhere';
      quit.textContent = quitLabel(flow);
      const hints = hintCopy(inputStyle);
      startHint.textContent = hints.start;
      controlsHint.textContent = hints.controls;
      controlsHint.hidden = hints.controls === '';
      modes.setHint(hints.choose);
      dimensionMap.update(save);
      galaxySelect.update(flow.dimension, save);
      results.update({ flow, score, restartHint: hints.restart });
    },
    handle(events) {
      announcer.handle(events);
    },
    focusChip(which) {
      coverChips[which].focus();
    },
    controls(screen) {
      const panel = panels[screen];
      return panel === undefined ? [] : focusableControls(panel);
    },
    dispose() {
      for (const panel of all) panel.remove();
      announcer.dispose();
    },
  };
}
