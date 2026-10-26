import type { RankEntry } from '../meta/rankBoard';
import type { SaveData } from '../meta/save';
import { createCoverCard, type CoverCard } from './coverCard';
import { button, element, PRIMARY_BUTTON, withTestId } from './dom';

export interface RecordsCard extends CoverCard {
  /** Shows the save's Rank board and Classic best. */
  update(save: SaveData): void;
}

/** One board row: its place, score, how far the run got, when, and a mark if it used Continue. */
function boardRow(entry: RankEntry, place: number): HTMLElement {
  const row = element('li', 'records-row');
  row.append(
    element('span', 'records-row__place', String(place)),
    element('span', 'records-row__score', String(entry.score)),
    element('span', 'records-row__reached', entry.reached),
    element('span', 'records-row__date', entry.date),
  );
  if (entry.continued) row.append(element('span', 'records-row__mark', 'continued'));
  return row;
}

/**
 * The records screen: a glass card over the title or mode select with the local Rank top 10 (score, how far the run
 * got, the date, and a mark on runs that used Continue) and the classic game's best, once imported. Back or Esc closes
 * it. `update` redraws the board only when it changed, as after another tab posts a run.
 */
export function createRecordsCard(root: HTMLElement, back: () => void): RecordsCard {
  const cover = createCoverCard(root, 'records', 'Records', back);
  withTestId(cover.card, 'records');
  const board = element('ol', 'records-board');
  const empty = element('p', 'hint', 'No Rank runs yet: finish or lose one and its score goes here.');
  const classic = element('p', 'records-classic');
  cover.card.append(element('p', 'label', 'Rank top 10'), board, empty, classic, withTestId(button(PRIMARY_BUTTON, 'Back', back), 'records-back'));
  let shown: SaveData['rankBoard'] | null = null;

  return {
    ...cover,
    update({ rankBoard, classicBest }) {
      if (rankBoard !== shown) {
        shown = rankBoard;
        board.replaceChildren(...rankBoard.map((entry, i) => boardRow(entry, i + 1)));
      }
      board.hidden = rankBoard.length === 0;
      empty.hidden = rankBoard.length > 0;
      classic.hidden = classicBest === null;
      classic.textContent = classicBest === null ? '' : `Classic best: ${String(classicBest)}`;
    },
  };
}
