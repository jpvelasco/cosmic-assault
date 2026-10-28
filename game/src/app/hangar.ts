import { createHangarCard, type HangarCard } from '../ui/hangarCard';
import { createMenuCardToggle, type CardToggle, type CardToggleDeps } from './cardToggle';
import type { Settings } from './settings';

/** The Hangar card and whether it is up: it opens from the title and mode select, and Back, Esc or pad B closes it. */
export type Hangar = CardToggle<HangarCard>;

export function createHangar(root: HTMLElement, deps: Omit<CardToggleDeps, 'opensOn'>, choose: (patch: Partial<Settings>) => void): Hangar {
  return createMenuCardToggle((back) => createHangarCard(root, { choose, back }), deps);
}
