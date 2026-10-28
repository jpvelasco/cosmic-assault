import type { EndCommandKind } from '../app/commands';
import { freeNext, runDef, type ClearResult, type FlowState } from '../app/flow';
import { galaxyLabel } from '../content/galaxies';
import type { NewBest } from '../meta/bests';
import { clearBonuses, dimensionMultiplier, galaxyPoints } from '../sim/scoring';
import { DAILY_CLEARED, dailyTitle, targetLine } from './dailyCopy';
import { button, cardPanel, element, PRIMARY, starRow, withTestId, type Act } from './dom';

export interface ResultsState {
  readonly flow: FlowState;
  /** The galaxy's score: the clear's total on results, what was won before the last life went on game over. */
  readonly score: number;
  /** The line on how to play again after a game over, for keys or taps. */
  readonly restartHint: string;
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
  { kind: 'title', label: 'Title', testId: 'rank-title', shows: (flow) => flow.mode !== 'free' },
];

/** The test ids of the buttons the end card shows for `flow`, in order. */
export const endButtons = (flow: FlowState): string[] => END_BUTTONS.filter(({ shows }) => shows(flow)).map(({ testId }) => testId);

/**
 * The end of a run: the galaxy (or the Daily), the heading, the stars won (lit one after another as the card pops in), the
 * score, a Daily's target, a "New best!" badge, the bonus lines, the Rank run's total, and the buttons for what comes next. Enter and pad A take
 * the first button shown, so that one wears the primary style.
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
  const buttons = END_BUTTONS.map(({ kind, label, testId, shows }) => [withTestId(button('menu-button', label, act({ kind })), testId), shows] as const);
  const row = element('div', 'end-buttons');
  row.append(...buttons.map(([el]) => el));
  const receipt = element('div', 'end-lines');
  receipt.append(points.el, clearBonus.el, noDeathBonus.el, rankFactor.el, runTotal.el);
  card.append(galaxy, heading, stars.el, score, target, newBest, newLook, receipt, hint, row);

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
    update({ flow, score: value, restartHint, target: toBeat }) {
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
      hint.textContent = screen === 'gameOver' ? restartHint : '';
      hint.hidden = hint.textContent === '';
      let first = true;
      for (const [el, shows] of buttons) {
        el.hidden = !shows(flow);
        el.classList.toggle(PRIMARY, first && !el.hidden);
        if (!el.hidden) first = false;
      }
    },
  };
}
