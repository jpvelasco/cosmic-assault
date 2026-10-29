import { createHangarCard, type HangarCard } from '../ui/hangarCard';
import { createCardToggle, type CardToggle, type CardToggleDeps } from './cardToggle';
import type { Settings } from './settings';

/** The Hangar card and whether it is up: it opens from the title and mode select, and Back, Esc or pad B closes it. */
export type Hangar = CardToggle<HangarCard>;

export function createHangar(root: HTMLElement, deps: CardToggleDeps, choose: (patch: Partial<Settings>) => void): Hangar {
  return createCardToggle('hangar', (back) => createHangarCard(root, { choose, back }), deps);
}
