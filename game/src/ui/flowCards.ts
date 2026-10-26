import type { Command } from '../app/commands';
import { freeNext, type FlowState, type Screen } from '../app/flow';
import { DIMENSION_NUMBERS, DIMENSIONS, GALAXY_INDEXES, galaxyIdOf, galaxyLabel } from '../content/galaxies';
import type { Dimension, GalaxyId } from '../content/types';
import { dimensionStars, isUnlocked } from '../meta/progress';
import type { SaveData } from '../meta/save';
import { button, cardPanel, element, withTestId } from './dom';
import type { HintCopy } from './hints';

/** What the mode select, map, galaxy select and end cards show. */
export interface FlowCardsState {
  readonly flow: FlowState;
  readonly save: SaveData;
  /** The run's score: the galaxy's, on its end card. */
  readonly score: number;
  /** The lines on how to choose (mode select) and play again (game over), for keys or taps. */
  readonly hints: HintCopy;
}

export interface FlowCards {
  /** The panel each screen shows; results, game over and Rank complete share one. */
  readonly panels: Readonly<Partial<Record<Screen, HTMLElement>>>;
  update(state: FlowCardsState): void;
}

const PRIMARY = 'menu-button--primary';

const starsText = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(3 - stars);

/** A card with a heading, its body and (moved in when shown) the shared Back button. */
function menuCard(heading: string, ...body: HTMLElement[]): { panel: HTMLElement; card: HTMLElement; title: HTMLElement } {
  const { panel, card } = cardPanel('menu');
  const title = element('h2', 'heading', heading);
  card.append(title, ...body);
  return { panel, card, title };
}

function modeSelectCard(act: (command: Command) => () => void, hint: HTMLElement): ReturnType<typeof menuCard> {
  const rank = withTestId(button(`menu-button ${PRIMARY}`, 'Rank', act({ kind: 'chooseMode', mode: 'rank' })), 'mode-rank');
  const free = withTestId(button('menu-button', 'Free play', act({ kind: 'chooseMode', mode: 'free' })), 'mode-free');
  return menuCard(
    'Choose a mode',
    rank,
    element('p', 'hint', 'One run through every Dimension'),
    free,
    element('p', 'hint', "Replay any galaxy you've unlocked"),
    hint,
  );
}

/** Rank while a run is saved: starting over ends that run, so it asks. Back keeps it. */
function confirmNewRankCard(act: (command: Command) => () => void): ReturnType<typeof menuCard> {
  const start = withTestId(button(`menu-button ${PRIMARY}`, 'Start new run', act({ kind: 'chooseMode', mode: 'rank' })), 'confirm-new-rank');
  return menuCard('Start a new run?', element('p', 'hint', 'Your saved run will end.'), start);
}

/**
 * The plain glass cards for mode select, the Dimension map, galaxy select and the end of a run. Every button sends a
 * command, so the router's cover table and the end-card guard apply to taps as to keys.
 */
export function createFlowCards(send: (command: Command) => void): FlowCards {
  const act = (command: Command) => (): void => {
    send(command);
  };
  const back = withTestId(button('menu-button', 'Back', act({ kind: 'back' })), 'back');

  const modeHint = element('p', 'hint');
  const modeSelect = modeSelectCard(act, modeHint);
  const confirmNewRank = confirmNewRankCard(act);
  const dimensionButtons = DIMENSION_NUMBERS.map((d) => ({
    el: withTestId(button('chip', '', act({ kind: 'openDimension', dimension: d })), `dimension-${String(d)}`),
    d,
  }));
  const map = menuCard('Dimensions', withChips(dimensionButtons.map(({ el }) => el)));
  /** Rebuilt for the open Dimension on each update: the buttons stay, their galaxy changes. */
  let galaxyButtons: { el: HTMLButtonElement; id: GalaxyId }[] = [];
  const galaxyRow = element('div', 'chips');
  const galaxySelect = menuCard('', galaxyRow);
  const menus: Partial<Record<Screen, HTMLElement>> = {
    modeSelect: modeSelect.card,
    confirmNewRank: confirmNewRank.card,
    map: map.card,
    galaxySelect: galaxySelect.card,
  };

  const end = cardPanel('game-over');
  const endHeading = element('h2', 'heading');
  const endGalaxy = element('p', 'label');
  const endScore = element('p', 'score');
  const endDetail = element('p', 'hint');
  const endHint = element('p', 'hint');
  const endButtons: readonly [HTMLButtonElement, (state: FlowCardsState) => boolean][] = [
    [withTestId(button('menu-button', 'Next', act({ kind: 'next' })), 'results-next'), ({ flow }) => flow.screen === 'results' && (flow.mode === 'rank' || freeNext(flow) !== null)],
    [withTestId(button('menu-button', 'Continue', act({ kind: 'continue' })), 'rank-continue'), ({ flow }) => flow.screen === 'gameOver' && flow.mode === 'rank'],
    [withTestId(button('menu-button', 'Retry', act({ kind: 'retry' })), 'results-retry'), ({ flow }) => flow.mode === 'free' && flow.screen !== 'rankComplete'],
    [withTestId(button('menu-button', 'Map', act({ kind: 'map' })), 'results-map'), ({ flow }) => flow.mode === 'free' && flow.screen !== 'rankComplete'],
    [withTestId(button('menu-button', 'Title', act({ kind: 'title' })), 'rank-title'), ({ flow }) => flow.mode === 'rank'],
  ];
  end.card.append(endHeading, endGalaxy, endScore, endDetail, endHint, ...endButtons.map(([el]) => el));

  function setGalaxies(d: Dimension, save: SaveData): void {
    galaxySelect.title.textContent = `D${String(d)} · ${DIMENSIONS[d]}`;
    if (galaxyButtons[0]?.id !== galaxyIdOf(d, 1)) {
      galaxyButtons = GALAXY_INDEXES.map((g) => {
        const id = galaxyIdOf(d, g);
        return { el: withTestId(button('chip', '', act({ kind: 'openGalaxy', id })), `galaxy-${id}`), id };
      });
      galaxyRow.replaceChildren(...galaxyButtons.map(({ el }) => el));
    }
    for (const { el, id } of galaxyButtons) {
      const open = isUnlocked(save, id);
      const best = save.galaxies[id];
      el.disabled = !open;
      el.textContent = open ? `${galaxyLabel(id)} ${starsText(best?.stars ?? 0)} ${String(best?.bestScore ?? 0)}` : `${galaxyLabel(id)} · Clear the previous galaxy`;
    }
  }

  function setDimensions(save: SaveData): void {
    for (const { el, d } of dimensionButtons) {
      const open = isUnlocked(save, galaxyIdOf(d, 1));
      el.disabled = !open;
      el.textContent = open ? `D${String(d)} ${DIMENSIONS[d]} ★ ${String(dimensionStars(save, d))}/18` : `D${String(d)} · Clear ${String(d - 1)}-★ to unlock`;
    }
  }

  function setEnd(state: FlowCardsState): void {
    const { flow, score } = state;
    const { screen, galaxy, result } = flow;
    endHeading.textContent = screen === 'results' ? 'Galaxy cleared' : screen === 'rankComplete' ? 'Rank complete' : 'Game over';
    endGalaxy.textContent = galaxy === null ? '' : `Galaxy ${galaxyLabel(galaxy)}`;
    endScore.textContent = `Score ${String(score)}`;
    const total = screen === 'gameOver' ? null : (result?.total ?? null);
    const stars = screen === 'gameOver' || result === null ? '' : `${starsText(result.report.stars)} · Bonus ${String(result.report.bonus)}`;
    endDetail.textContent = flow.mode === 'rank' && total !== null ? `${stars} · Run total ${String(total)}` : stars;
    endHint.textContent = screen === 'gameOver' ? state.hints.restart : '';
    let first = true;
    for (const [el, shows] of endButtons) {
      el.hidden = !shows(state);
      // Enter and pad A take the first button shown, so it wears the primary style.
      el.classList.toggle(PRIMARY, first && !el.hidden);
      if (!el.hidden) first = false;
    }
  }

  return {
    panels: { modeSelect: modeSelect.panel, confirmNewRank: confirmNewRank.panel, map: map.panel, galaxySelect: galaxySelect.panel, results: end.panel, gameOver: end.panel, rankComplete: end.panel },
    update(state) {
      const { screen, dimension } = state.flow;
      const menu = menus[screen];
      // Moved only on a screen change, so a focused Back keeps its focus.
      if (menu !== undefined && back.parentElement !== menu) menu.append(back);
      modeHint.textContent = state.hints.choose;
      setDimensions(state.save);
      setGalaxies(dimension, state.save);
      setEnd(state);
    },
  };
}

function withChips(buttons: readonly HTMLButtonElement[]): HTMLElement {
  const row = element('div', 'chips');
  row.append(...buttons);
  return row;
}
