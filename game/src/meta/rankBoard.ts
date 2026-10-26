import { galaxyById } from '../content/galaxies';
import type { GalaxyId } from '../content/types';

export const RANK_BOARD_SIZE = 10;

export interface RankEntry {
  readonly score: number;
  /** Where the run ended: `"D3 · G4"`, or `"D5 · ★"` in a boss galaxy. */
  readonly reached: string;
  /** `YYYY-MM-DD` */
  readonly date: string;
  readonly continued: boolean;
}

/** `"D3 · G4"`, or `"D5 · ★"` for a Dimension's boss galaxy. */
export function reachedLabel(id: GalaxyId): string {
  const { dimension, index, kind } = galaxyById(id);
  return `D${String(dimension)} · ${kind === 'boss' ? '★' : `G${String(index)}`}`;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Higher score first; on a tie the earlier date. `YYYY-MM-DD` strings order correctly as text. */
function ranksBefore(a: RankEntry, b: RankEntry): number {
  return b.score - a.score || compareText(a.date, b.date);
}

/** The board with `entry` added: best ten, ties kept in the order they were recorded. */
export function addEntry(board: readonly RankEntry[], entry: RankEntry): readonly RankEntry[] {
  return [...board, entry].sort(ranksBefore).slice(0, RANK_BOARD_SIZE);
}

/**
 * Two boards as one: every entry once (an entry held by both is the same run), best ten. Full ties
 * order by `reached`, then Continue not used first, so the result is the same whichever board is first.
 */
export function mergeBoards(a: readonly RankEntry[], b: readonly RankEntry[]): readonly RankEntry[] {
  const key = (e: RankEntry): string => `${String(e.score)}|${e.reached}|${e.date}|${String(e.continued)}`;
  const once = new Map([...a, ...b].map((e) => [key(e), e]));
  return [...once.values()]
    .sort((x, y) => ranksBefore(x, y) || compareText(x.reached, y.reached) || Number(x.continued) - Number(y.continued))
    .slice(0, RANK_BOARD_SIZE);
}
