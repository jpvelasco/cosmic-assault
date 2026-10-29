import type { CoverCardId } from '../app/cardToggle';
import type { Command } from '../app/commands';
import { backTarget, type FlowState, type Screen } from '../app/flow';
import { currentBuildLabel } from '../buildLabel';
import type { DailyGalaxy } from '../meta/dailyGalaxy';
import type { SaveData } from '../meta/save';
import type { RankLock } from '../app/runController';
import { galaxyLabel } from '../content/galaxies';
import type { InstallOffer } from '../platform/install';
import type { RingLog } from '../platform/log';
import type { SimEvent } from '../sim/events';
import type { GalaxyMode } from '../sim/scoring';
import { createBossAnnouncer } from './bossAnnouncer';
import { createDimensionMap } from './dimensionMap';
import { button, cardPanel, chip, element, focusableControls, PRIMARY, PRIMARY_BUTTON, reserveSpace, showSoundState, wearKey, withTestId, type Act, type MenuCard } from './dom';
import { createGalaxySelect } from './galaxySelect';
import { hintCopy, hintVariants, IOS_INSTALL_HINT, type InputStyle } from './hints';
import { createModeSelect } from './modeSelect';
import { createPauseCard } from './pauseCard';
import { createResultsCard } from './resultsCard';

export interface OverlayActions {
  /** A screen command from a button: the router applies it, through its cover table and the end-card guard. */
  readonly command: (command: Command) => void;
  readonly resume: () => void;
  /** The pause card's Quit, once it has asked twice in Rank. */
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
  /** The app's date, whose Daily mode select offers. */
  readonly today: string;
  /** The Daily of the run in play or on its end card; null outside the Daily. */
  readonly daily: DailyGalaxy | null;
  /** Whether the saved Rank run is being checked, or played in another tab, so it cannot be resumed here. */
  readonly rankLock: RankLock;
  /** The galaxy's score, which the end cards show. */
  readonly score: number;
  readonly muted: boolean;
  /** Whether the page is in full screen; null where the browser cannot, which hides the chip. */
  readonly fullscreen: boolean | null;
  /** While another card (settings, records, Hangar or the rotate prompt) is over the screen, the cards beneath it ignore taps, keys and Tab. */
  readonly covered: boolean;
  /** Decides whether the hints name keys, taps or pad buttons: the style of the input used last. */
  readonly inputStyle: InputStyle;
  /** What the title card offers for installing the game: an Install chip, the iOS steps, or nothing. */
  readonly installOffer: InstallOffer;
  /** Whether the attract demo plays behind the title, which then shows the canvas through and dims its card. */
  readonly attract: boolean;
}

export interface Overlay {
  update(state: OverlayState): void;
  /** One step's events: a boss's arrival, phases and fall are announced to screen readers. */
  handle(events: readonly SimEvent[]): void;
  /** Puts keyboard focus on the visible card's Settings, Records or Hangar chip, as the card it opened closes; else on its first control. */
  focusChip(which: CoverCardId): void;
  /** Takes back a Rank Quit that asks to be pressed again; true if one did. Esc, P and the pad's Back and Start do this instead of resuming. */
  cancelQuit(): boolean;
  /** The controls of the card for `screen` that can take focus now, in document order; none while another card covers it. */
  controls(screen: Screen): HTMLElement[];
  /** Takes the demo's dimming and label off the title now, without an update: the game has stopped after a crash. */
  endAttract(): void;
  dispose(): void;
}

const INSTALL_TEST_ID = 'install-offer';
/** The title panel's class while the attract demo plays behind it. */
const ATTRACT_CLASS = 'title--attract';

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

function titlePanel(demoLabel: HTMLElement, play: HTMLElement, resumeSlot: HTMLElement, chipRow: HTMLElement, startHint: HTMLElement, controlsHint: HTMLElement): HTMLElement {
  const { panel, card } = cardPanel('title');
  const build = withTestId(element('p', 'build', currentBuildLabel()), 'build-label');
  const lines = [reserveSpace(startHint, hintVariants((hints) => hints.start)), reserveSpace(controlsHint, hintVariants((hints) => hints.controls))];
  card.append(demoLabel, element('h1', 'title', 'Cosmic Assault'), play, resumeSlot, ...lines, chipRow, build);
  return panel;
}

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
 * The screens as DOM layers over the canvas, one visible per screen: the title card here, the pause card, mode select,
 * the Dimension map, galaxy select and the end card from their own modules. Every card button sends a command, so the
 * router's cover table and the end-card guard apply to taps as to keys. The end cards act only on their buttons, so
 * taps that were aimed at the ship cannot skip the score.
 */
export function createOverlay(root: HTMLElement, actions: OverlayActions, log: Pick<RingLog, 'add'>): Overlay {
  const send: Act = (command: Command) => (): void => {
    actions.command(command);
  };
  const play = withTestId(button(PRIMARY_BUTTON, 'Play', send({ kind: 'start' })), 'play');
  // One Resume Rank group, with where the run stands and whether another tab plays it, on the title and mode select.
  const resumeRank = withTestId(button('menu-button', '', send({ kind: 'resumeRank' })), 'resume-rank');
  const savedRun = element('p', 'hint resume-summary');
  const elsewhere = withTestId(element('p', 'hint', 'This run is playing in another tab'), 'rank-elsewhere');
  const resumeGroup = element('div', 'resume-group');
  resumeGroup.append(resumeRank, savedRun, elsewhere);
  const titleResumeSlot = element('div', 'resume-slot');
  // One shared Back, moved into the menu card shown, so its test id stays unique.
  const back = withTestId(button('menu-button', 'Back', send({ kind: 'back' })), 'back');
  back.setAttribute('aria-keyshortcuts', 'Escape');
  const showBackKey = wearKey(back);
  const modes = createModeSelect(send, log);
  const dimensionMap = createDimensionMap(send);
  const galaxySelect = createGalaxySelect(send);
  const results = createResultsCard(send);
  /** The menu cards, which take the shared Back. */
  const menus: Partial<Record<Screen, MenuCard>> = { modeSelect: modes.modeSelect, confirmNewRank: modes.confirmNewRank, map: dimensionMap, galaxySelect };
  const resumeSlots: Partial<Record<Screen, HTMLElement>> = { title: titleResumeSlot, modeSelect: modes.resumeSlot };
  // One set of chips serves the title, mode select and pause cards; `update` moves it into the visible card's row.
  const sound = chip('sound-toggle', actions.toggleMute);
  const fullscreen = chip('fullscreen-toggle', actions.toggleFullscreen);
  const settings = chip('settings-open', actions.openSettings);
  settings.textContent = 'Settings';
  const records = chip('records-open', actions.openRecords);
  records.textContent = 'Records';
  const hangar = chip('hangar-open', actions.openHangar);
  hangar.textContent = 'Hangar';
  /** The chips that open each cover card, and take focus back as it closes. */
  const coverChips: Readonly<Record<CoverCardId, HTMLButtonElement>> = { settings, records, hangar };
  // Only the title card offers to install, and only while the browser can (see src/platform/install.ts).
  const installChip = chip('install-chip', actions.install, INSTALL_TEST_ID);
  installChip.textContent = 'Install';
  const iosHint = withTestId(element('p', 'install-hint', IOS_INSTALL_HINT), INSTALL_TEST_ID);
  const titleRow = element('div', 'chips');
  const pauseRow = element('div', 'chips');
  const chipRows: Partial<Record<Screen, HTMLElement>> = { title: titleRow, paused: pauseRow };
  const pauseCard = createPauseCard(actions, pauseRow);
  const startHint = element('p', 'hint');
  const controlsHint = withTestId(element('p', 'hint'), 'controls-hint');
  const demoLabel = withTestId(element('p', 'label demo-label', 'Demo'), 'demo-label');
  demoLabel.hidden = true;
  // Decoration over the demo behind the card: a screen reader goes straight to the title.
  demoLabel.setAttribute('aria-hidden', 'true');
  const title = titlePanel(demoLabel, play, titleResumeSlot, titleRow, startHint, controlsHint);
  onTapOutsideButtons(title, send({ kind: 'start' }));
  /** The title control that had focus as the demo began, which gets it back as the demo ends. */
  let focusBeforeDemo: Element | null = null;
  /** The screen the last update showed, and its mode, so a screen entered can be told from one stayed on, and Back from forward. */
  let shown: { readonly screen: Screen; readonly mode: GalaxyMode | null } | null = null;
  /** The focus a screen entered asks for, given once nothing covers its card. */
  let focusDue: (() => void) | null = null;

  /**
   * Entering the pause card puts Quit back to its first step and asks for focus on Resume. A screen Back returns to (by
   * Esc, pad B or a button) asks for focus on the button that left it, if it is still there.
   */
  function enterScreen({ screen, mode }: FlowState): void {
    if (screen === shown?.screen) return;
    const cameBack = shown !== null && backTarget(shown.screen, shown.mode) === screen;
    shown = { screen, mode };
    if (screen === 'paused') {
      pauseCard.disarm();
      focusDue = () => {
        pauseCard.focusResume();
      };
    } else if (cameBack) {
      const opener = openers.get(panels[screen]);
      focusDue = () => {
        restoreFocus(screen, opener);
      };
    } else focusDue = null;
  }

  /** The one place focus goes back: to `control` while the card for `screen` still offers it, else to its first control. */
  function restoreFocus(screen: Screen, control: HTMLElement | undefined): void {
    const controls = overlayControls(screen);
    const target = control !== undefined && controls.includes(control) ? control : controls[0];
    target?.focus({ preventScroll: true });
  }

  const overlayControls = (screen: Screen): HTMLElement[] => {
    const panel = panels[screen];
    return panel === undefined ? [] : focusableControls(panel);
  };

  /** Dims the title card over the demo and shows its label; as the demo ends, focus goes back where it was on the title. */
  function showAttract(attract: boolean, covered: boolean): void {
    demoLabel.hidden = !attract;
    if (attract === title.classList.contains(ATTRACT_CLASS)) return;
    title.classList.toggle(ATTRACT_CLASS, attract);
    if (attract) {
      focusBeforeDemo = document.activeElement;
      return;
    }
    const before = focusBeforeDemo;
    focusBeforeDemo = null;
    if (before instanceof HTMLElement && title.contains(before) && !title.hidden && !covered) before.focus({ preventScroll: true });
  }
  const panels: Partial<Record<Screen, HTMLElement>> = {
    title,
    paused: pauseCard.panel,
    results: results.panel,
    gameOver: results.panel,
    rankComplete: results.panel,
  };
  for (const [screen, menu] of Object.entries(menus) as [Screen, MenuCard][]) panels[screen] = menu.panel;
  const all = [...new Set(Object.values(panels))];
  root.append(...all);
  /** The button last pressed on each card, by tap, click, Enter or pad A: Back to the card puts focus back on it. */
  const openers = new Map<HTMLElement | undefined, HTMLElement>();
  for (const panel of all) {
    // In the capture phase: the press may change the screen before the event bubbles back up.
    panel.addEventListener(
      'click',
      (e) => {
        const pressed = e.target instanceof Element ? e.target.closest('button') : null;
        if (pressed === null) openers.delete(panel);
        else openers.set(panel, pressed);
      },
      true,
    );
  }
  const announcer = createBossAnnouncer(root);

  return {
    update({ flow, save, today, daily, rankLock, score, muted, fullscreen: fullscreenState, covered, inputStyle, installOffer, attract }) {
      const { screen } = flow;
      for (const panel of all) {
        panel.hidden = panel !== panels[screen];
        panel.inert = covered;
      }
      showAttract(attract, covered);
      const row = chipRows[screen];
      // Moved only on a card change: re-inserting a chip would drop keyboard focus after a toggle. Prepended, so they
      // stay ahead of the title's Install chip.
      if (row !== undefined && settings.parentElement !== row) row.prepend(sound, fullscreen, settings);
      // Records and Hangar sit after Settings on the title; on mode select Settings leads them, ahead of Back in its last row.
      if (screen === 'title' && records.previousElementSibling !== settings) settings.after(records, hangar);
      else if (screen === 'modeSelect' && settings.parentElement !== modes.chipRow) modes.chipRow.prepend(settings, records, hangar);
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
      // On mode select Resume leads, ahead of the mode cards.
      resumeRank.classList.toggle(PRIMARY, screen === 'modeSelect');
      savedRun.textContent = savedRunText(save);
      elsewhere.hidden = rankLock !== 'elsewhere';
      const hints = hintCopy(inputStyle);
      pauseCard.update(flow.mode, hints);
      enterScreen(flow);
      showBackKey(hints.backKey);
      startHint.textContent = hints.start;
      controlsHint.textContent = hints.controls;
      controlsHint.hidden = hints.controls === '';
      modes.setHint(hints.choose);
      if (screen === 'modeSelect') modes.update(save, today);
      dimensionMap.update(save);
      galaxySelect.update(flow.dimension, save);
      results.update({ flow, score, hints, target: daily?.target ?? null });
      // Last, once the card shows what it will: the control to focus may only now be there.
      if (focusDue !== null && !covered) {
        const focus = focusDue;
        focusDue = null;
        focus();
      }
    },
    handle(events) {
      announcer.handle(events);
    },
    focusChip(which) {
      if (shown !== null) restoreFocus(shown.screen, coverChips[which]);
    },
    cancelQuit() {
      return pauseCard.disarm();
    },
    controls: overlayControls,
    endAttract() {
      showAttract(false, true);
    },
    dispose() {
      for (const panel of all) panel.remove();
      announcer.dispose();
    },
  };
}
