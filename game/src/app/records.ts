import { createRecordsCard, type RecordsCard } from '../ui/recordsCard';
import { createCardToggle, type CardToggle, type CardToggleDeps } from './cardToggle';

/** The records card and whether it is up: it opens from the title and mode select, and Back or Esc closes it. */
export type Records = CardToggle<RecordsCard>;

export function createRecords(root: HTMLElement, deps: Omit<CardToggleDeps, 'opensOn'>): Records {
  const card = createRecordsCard(root, () => {
    records.close();
  });
  const records = createCardToggle(card, { ...deps, opensOn: ['title', 'modeSelect'] });
  return records;
}
