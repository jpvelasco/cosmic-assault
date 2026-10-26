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

/** Higher score first; on a tie the earlier date. `YYYY-MM-DD` strings order correctly as text. */
function ranksBefore(a: RankEntry, b: RankEntry): number {
  return b.score - a.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/** The board with `entry` added: best ten, ties kept in the order they were recorded. */
export function addEntry(board: readonly RankEntry[], entry: RankEntry): readonly RankEntry[] {
  return [...board, entry].sort(ranksBefore).slice(0, RANK_BOARD_SIZE);
}
