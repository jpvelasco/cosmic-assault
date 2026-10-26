import { freeNext, type FlowState } from '../app/flow';
import { galaxyById, galaxyLabel } from '../content/galaxies';
import { clearBonuses, dimensionMultiplier, galaxyPoints } from '../sim/scoring';
import { button, cardPanel, element, PRIMARY, starRow, withTestId, type Act } from './dom';

export interface ResultsState {
  readonly flow: FlowState;
  /** The galaxy's score: the clear's total on results, what was won before the last life went on game over. */
  readonly score: number;
  /** The line on how to play again after a game over, for keys or taps. */
  readonly restartHint: string;
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
 * The end of a run: the galaxy, the heading, the stars won (lit one after another as the card pops in), the score, a
 * "New best!" badge, the bonus lines, the Rank run's total, and the buttons for what comes next. Enter and pad A take
 * the first button shown, so that one wears the primary style.
 */
export function createResultsCard(act: Act): ResultsCard {
  const { panel, card } = cardPanel('game-over');
  card.classList.add('card--end');
  const galaxy = element('p', 'label');
  const heading = element('h2', 'heading');
  const stars = starRow('stars--big');
  const score = element('p', 'score');
  const newBest = element('p', 'badge new-best', 'New best!');
  const points = line();
  const clearBonus = line();
  const noDeathBonus = line();
  const rankFactor = line();
  const runTotal = line();
  runTotal.el.classList.add('end-line--total');
  const hint = element('p', 'hint');
  const buttons: readonly [HTMLButtonElement, (flow: FlowState) => boolean][] = [
    [withTestId(button('menu-button', 'Next', act({ kind: 'next' })), 'results-next'), (flow) => flow.screen === 'results' && (flow.mode === 'rank' || freeNext(flow) !== null)],
    [withTestId(button('menu-button', 'Continue', act({ kind: 'continue' })), 'rank-continue'), (flow) => flow.screen === 'gameOver' && flow.mode === 'rank'],
    [withTestId(button('menu-button', 'Retry', act({ kind: 'retry' })), 'results-retry'), (flow) => flow.mode === 'free' && flow.screen !== 'rankComplete'],
    [withTestId(button('menu-button', 'Map', act({ kind: 'map' })), 'results-map'), (flow) => flow.mode === 'free' && flow.screen !== 'rankComplete'],
    [withTestId(button('menu-button', 'Title', act({ kind: 'title' })), 'rank-title'), (flow) => flow.mode === 'rank'],
  ];
  const row = element('div', 'end-buttons');
  row.append(...buttons.map(([el]) => el));
  const receipt = element('div', 'end-lines');
  receipt.append(points.el, clearBonus.el, noDeathBonus.el, rankFactor.el, runTotal.el);
  card.append(galaxy, heading, stars.el, score, newBest, receipt, hint, row);

  /**
   * The clear's bonuses and, in Rank, the Dimension's multiplier and the run total. After a game over only a Rank run
   * has a line: its total, the score it carried in plus this galaxy's `score`, as the board posted it.
   */
  function setLines({ screen, result, galaxy: id, mode, rankRun }: FlowState, score: number): void {
    const rank = mode === 'rank';
    if (screen === 'gameOver' || result === null || id === null) {
      for (const part of [points, clearBonus, noDeathBonus, rankFactor]) part.set('', '');
      runTotal.set('Run total', rank && screen === 'gameOver' && rankRun !== null ? String(rankRun.score + score) : '');
      receipt.hidden = runTotal.el.hidden;
      return;
    }
    receipt.hidden = false;
    const { dimension } = galaxyById(id);
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
    update({ flow, score: value, restartHint }) {
      const { screen, result } = flow;
      const won = screen !== 'gameOver' && result !== null;
      heading.textContent = screen === 'results' ? 'Galaxy cleared' : screen === 'rankComplete' ? 'Rank complete' : 'Game over';
      galaxy.textContent = flow.galaxy === null ? '' : `Galaxy ${galaxyLabel(flow.galaxy)}`;
      stars.el.hidden = !won;
      stars.set(won ? result.report.stars : 0);
      score.textContent = `Score ${String(value)}`;
      newBest.hidden = !won || !result.newBest;
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
