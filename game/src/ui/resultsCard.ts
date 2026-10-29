import type { EndCommandKind } from '../app/commands';
import { backTarget, freeNext, runDef, type ClearResult, type FlowState } from '../app/flow';
import { galaxyLabel } from '../content/galaxies';
import type { NewBest } from '../meta/bests';
import { clearBonuses, dimensionMultiplier, galaxyPoints } from '../sim/scoring';
import { DAILY_CLEARED, dailyTitle, targetLine } from './dailyCopy';
import { button, cardPanel, element, PRIMARY, reserveSpace, starRow, wearKey, withTestId, type Act } from './dom';
import { hintVariants, type HintCopy } from './hints';

export interface ResultsState {
  readonly flow: FlowState;
  /** The galaxy's score: the clear's total on results, what was won before the last life went on game over. */
  readonly score: number;
  /** The hints in the style of the input used last: how to play again after a game over, and the buttons' keys. */
  readonly hints: HintCopy;
  /** The score the run set to beat (a Daily's target); null for none. */
  readonly target: number | null;
}

export interface ResultsCard {
  /** The one panel results, game over and Rank complete share. */
  readonly panel: HTMLElement;
  update(state: ResultsState): void;
}

/** A label and its amount, as on a receipt. */
function line(): { el: HTMLElement; set(label: string, amount: string): void } {
  const el = element('p', 'end-line');
  const label = element('span', 'end-line__label');
  const amount = element('span', 'end-line__amount');
  el.append(label, amount);
  return {
    el,
    set(text, value) {
      el.hidden = value === '';
      label.textContent = text;
      amount.textContent = value;
    },
  };
}

/**
 * The "New best!" badge's text, or '' when the run beat no record. It names the recorded number whenever that differs
 * from the `shown` score, as a Rank galaxy's best (at Free play scale) does beside the multiplied total.
 */
export function newBestText(newBest: NewBest | null, shown: number): string {
  if (newBest === null) return '';
  return newBest.score === shown ? 'New best!' : `New best! ${String(newBest.score)}`;
}

/** The line naming the looks the clear unlocked, or '' when it unlocked none. */
export function newLookLabel(result: ClearResult | null): string {
  const names = result?.newLooks ?? [];
  return names.length === 0 ? '' : `New look unlocked: ${names.join(', ')}`;
}

/** The end card's heading. */
export function endHeading({ screen, mode }: FlowState): string {
  if (screen === 'results') return mode === 'daily' ? DAILY_CLEARED : 'Galaxy cleared';
  return screen === 'rankComplete' ? 'Rank complete' : 'Game over';
}

/** The line over the heading: the Daily's title, or the galaxy played. */
export function endLabel({ galaxy, daily }: FlowState): string {
  if (daily !== null) return dailyTitle(daily);
  return galaxy === null ? '' : `Galaxy ${galaxyLabel(galaxy)}`;
}

/** Stars show for a galaxy cleared; a Daily shows its target instead. */
export const showsStars = ({ screen, result, mode }: FlowState): boolean => screen !== 'gameOver' && result !== null && mode !== 'daily';

interface EndButton {
  readonly kind: EndCommandKind;
  readonly label: string;
  readonly testId: string;
  readonly shows: (flow: FlowState) => boolean;
}

/** The end card's buttons, in order; Enter and pad A take the first one shown. */
const END_BUTTONS: readonly EndButton[] = [
  { kind: 'next', label: 'Next', testId: 'results-next', shows: (flow) => flow.screen === 'results' && (flow.mode === 'rank' || freeNext(flow) !== null) },
  { kind: 'continue', label: 'Continue', testId: 'rank-continue', shows: (flow) => flow.screen === 'gameOver' && flow.mode === 'rank' },
  // The Daily's Retry plays the same date again.
  { kind: 'retry', label: 'Retry', testId: 'results-retry', shows: (flow) => flow.mode !== 'rank' && flow.screen !== 'rankComplete' },
  { kind: 'map', label: 'Map', testId: 'results-map', shows: (flow) => flow.mode === 'free' && flow.screen !== 'rankComplete' },
  { kind: 'title', label: 'Title', testId: 'rank-title', shows: (flow) => flow.mode === 'rank' },
  { kind: 'title', label: 'Title', testId: 'daily-title', shows: (flow) => flow.mode === 'daily' },
];

/** The test ids of the buttons the end card shows for `flow`, in order. */
export const endButtons = (flow: FlowState): string[] => END_BUTTONS.filter(({ shows }) => shows(flow)).map(({ testId }) => testId);

/** The shortcut an end button answers to: Back (Esc, pad B), the first button's confirm (Enter, pad A) or R's retry. */
export type EndKey = 'back' | 'confirm' | 'retry';

/** The keys each `EndKey` is pressed with, for `aria-keyshortcuts`. */
const ARIA_KEYS: Readonly<Record<EndKey, string>> = { back: 'Escape', confirm: 'Enter', retry: 'R' };

/**
 * The shortcut each button shown for `flow` wears, by test id: the one Back leads through (where `backTarget` goes)
 * wears Back's, so the player can tell where Esc goes; else the first wears confirm's, and a Retry after it R's.
 */
export function endKeys(flow: FlowState): ReadonlyMap<string, EndKey> {
  const target = backTarget(flow.screen, flow.mode);
  const keys = new Map<string, EndKey>();
  END_BUTTONS.filter(({ shows }) => shows(flow)).forEach(({ kind, testId }, i) => {
    if (kind === target) keys.set(testId, 'back');
    else if (i === 0) keys.set(testId, 'confirm');
    else if (kind === 'retry') keys.set(testId, 'retry');
  });
  return keys;
}

/** The key `hints` name for each `EndKey`, or empty where they name none. */
const keyText = (hints: HintCopy, key: EndKey): string => ({ back: hints.backKey, confirm: hints.confirmKey, retry: hints.retryKey })[key];

/** A Rank run that Back leaves saved (between galaxies, or lost and waiting for a Continue) says so. */
export const suspends = ({ mode, rankRun }: FlowState): boolean => mode === 'rank' && rankRun !== null;

/**
 * The end of a run: the galaxy (or the Daily), the heading, the stars won (lit one after another as the card pops in), the
 * score, a Daily's target, a "New best!" badge, the bonus lines, the Rank run's total, and the buttons for what comes next. Enter and pad A take
 * the first button shown, so that one wears the primary style; with keys or a pad, the buttons wear their keys (`endKeys`).
 */
export function createResultsCard(act: Act): ResultsCard {
  const { panel, card } = cardPanel('game-over');
  card.classList.add('card--end');
  const galaxy = element('p', 'label');
  const heading = element('h2', 'heading');
  const stars = starRow('stars--big');
  const score = element('p', 'score');
  const newBest = element('p', 'badge new-best');
  const newLook = element('p', 'hint new-look');
  const points = line();
  const clearBonus = line();
  const noDeathBonus = line();
  const rankFactor = line();
  const runTotal = line();
  runTotal.el.classList.add('end-line--total');
  const target = withTestId(element('p', 'end-target'), 'end-target');
  const hint = element('p', 'hint');
  const hintLine = reserveSpace(hint, hintVariants((hints) => hints.restart));
  const suspendHint = withTestId(element('p', 'hint'), 'end-suspend');
  const suspendLine = reserveSpace(suspendHint, hintVariants((hints) => hints.suspend));
  const buttons = END_BUTTONS.map(({ kind, label, testId, shows }) => {
    const el = withTestId(button('menu-button', label, act({ kind })), testId);
    return { el, testId, shows, showKey: wearKey(el) };
  });
  const row = element('div', 'end-buttons');
  row.append(...buttons.map(({ el }) => el));
  const receipt = element('div', 'end-lines');
  receipt.append(points.el, clearBonus.el, noDeathBonus.el, rankFactor.el, runTotal.el);
  card.append(galaxy, heading, stars.el, score, target, newBest, newLook, receipt, hintLine, suspendLine, row);

  /**
   * The clear's bonuses and, in Rank, the Dimension's multiplier and the run total. After a game over only a Rank run
   * has a line: its total, the score it carried in plus this galaxy's `score`, as the board posted it.
   */
  function setLines(flow: FlowState, score: number): void {
    const { screen, result, mode, rankRun } = flow;
    const rank = mode === 'rank';
    const played = runDef(flow);
    if (screen === 'gameOver' || result === null || played === null) {
      for (const part of [points, clearBonus, noDeathBonus, rankFactor]) part.set('', '');
      runTotal.set('Run total', rank && screen === 'gameOver' && rankRun !== null ? String(rankRun.score + score) : '');
      receipt.hidden = runTotal.el.hidden;
      return;
    }
    receipt.hidden = false;
    const { dimension } = played;
    const { clear, noDeath } = clearBonuses(dimension, result.report.deaths);
    const factor = dimensionMultiplier(dimension);
    // What the score is made of: the kills, the bonuses, then in Rank the Dimension's multiplier over both.
    points.set('Galaxy score', String(galaxyPoints(result.report, dimension, mode ?? 'free')));
    clearBonus.set('Clear bonus', `+${String(clear)}`);
    noDeathBonus.set('No-death bonus', noDeath > 0 ? `+${String(noDeath)}` : '');
    rankFactor.set('Dimension bonus', rank && factor > 1 ? `×${factor.toFixed(1)}` : '');
    runTotal.set('Run total', rank ? String(result.total) : '');
  }

  return {
    panel,
    update({ flow, score: value, hints, target: toBeat }) {
      const { screen, result } = flow;
      const won = screen !== 'gameOver' && result !== null;
      heading.textContent = endHeading(flow);
      galaxy.textContent = endLabel(flow);
      stars.el.hidden = !showsStars(flow);
      stars.set(won ? result.report.stars : 0);
      score.textContent = `Score ${String(value)}`;
      target.textContent = toBeat === null ? '' : targetLine(toBeat, value);
      target.hidden = toBeat === null;
      newBest.textContent = newBestText(flow.newBest, value);
      newBest.hidden = newBest.textContent === '';
      newLook.textContent = won ? newLookLabel(result) : '';
      newLook.hidden = newLook.textContent === '';
      setLines(flow, value);
      // Each line shows or goes by the card's state alone; its space holds its longest wording in any input style.
      hintLine.hidden = screen !== 'gameOver';
      hint.textContent = hints.restart;
      suspendLine.hidden = !suspends(flow);
      suspendHint.textContent = hints.suspend;
      suspendHint.hidden = hints.suspend === '';
      const keys = endKeys(flow);
      let first = true;
      for (const { el, testId, shows, showKey } of buttons) {
        el.hidden = !shows(flow);
        el.classList.toggle(PRIMARY, first && !el.hidden);
        if (!el.hidden) first = false;
        const key = keys.get(testId);
        showKey(key === undefined ? '' : keyText(hints, key));
        if (key === undefined) el.removeAttribute('aria-keyshortcuts');
        else el.setAttribute('aria-keyshortcuts', ARIA_KEYS[key]);
      }
    },
  };
}
