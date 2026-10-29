import { createRecordsCard, type RecordsCard } from '../ui/recordsCard';
import { createMenuCardToggle, type CardToggle, type CardToggleDeps } from './cardToggle';

/** The records card and whether it is up: it opens from the title and mode select, and Back or Esc closes it. */
export type Records = CardToggle<RecordsCard>;

export function createRecords(root: HTMLElement, deps: Omit<CardToggleDeps, 'opensOn'>): Records {
  return createMenuCardToggle((close) => createRecordsCard(root, close), deps);
}
