import type { CoverCard } from '../ui/coverCard';
import type { Screen } from './flow';

/** Where the Records and Hangar chips are, so where their cards open. */
const MENU_CARD_SCREENS: readonly Screen[] = ['title', 'modeSelect'];

/**
 * The cards a player opens over a screen from its chips, bottom first, with the screens each opens on: where its chip
 * is. Settings sits beside Records and Hangar, and on the pause card too. The one list of them, which the router, the
 * game and the view read.
 */
export const COVER_CARD_SCREENS = {
  settings: [...MENU_CARD_SCREENS, 'paused'],
  records: MENU_CARD_SCREENS,
  hangar: MENU_CARD_SCREENS,
} as const satisfies Readonly<Record<string, readonly Screen[]>>;

export type CoverCardId = keyof typeof COVER_CARD_SCREENS;

/** Every cover card, bottom first. */
export const COVER_CARD_IDS = Object.keys(COVER_CARD_SCREENS) as readonly CoverCardId[];

export interface CardToggleDeps {
  screen(): Screen;
  syncView(): void;
  /** Puts focus back on the chip that opened the card. */
  focusOpener(): void;
}

/** What the table needs of every cover card: showing, hiding, its controls, and the rotate prompt's cover. */
type CoverCardView = Pick<CoverCard, 'show' | 'hide' | 'cover' | 'controls'>;

/** A cover card, whether it is up, and the one way it opens and closes. */
export interface CardToggle<C> {
  readonly card: C;
  readonly open: boolean;
  /** Shows the card over a screen that offers it; the run behind it, if any, stays as it was. */
  readonly show: () => void;
  /** Back, Done, Esc and pad B: back to the card that opened it, with focus on its chip. */
  readonly close: () => void;
}

/** The cover card `id`, built by `makeCard` with the close its own Back or Done calls. */
export function createCardToggle<C extends CoverCardView>(id: CoverCardId, makeCard: (close: () => void) => C, deps: CardToggleDeps): CardToggle<C> {
  const opensOn: readonly Screen[] = COVER_CARD_SCREENS[id];
  let open = false;
  const close = (): void => {
    if (!open) return;
    open = false;
    card.hide();
    deps.syncView();
    deps.focusOpener();
  };
  const card = makeCard(close);
  return {
    card,
    get open() {
      return open;
    },
    show() {
      if (open || !opensOn.includes(deps.screen())) return;
      open = true;
      deps.syncView();
      card.show();
    },
    close,
  };
}

/** The cover cards as one table: which are up, the one on top, and the rotate prompt over all of them. */
export interface CoverCards {
  isOpen(id: CoverCardId): boolean;
  /** The topmost card that is up, or null. Only one is ever up: each opens from a chip on an uncovered screen. */
  top(): CardToggle<CoverCardView> | null;
  /** Esc and pad B: closes the topmost card, and only that one. */
  readonly closeTop: () => void;
  cover(covered: boolean): void;
}

export function createCoverCards(toggles: Readonly<Record<CoverCardId, CardToggle<CoverCardView>>>): CoverCards {
  const top = (): CardToggle<CoverCardView> | null => {
    const id = COVER_CARD_IDS.findLast((card) => toggles[card].open);
    return id === undefined ? null : toggles[id];
  };
  return {
    isOpen: (id) => toggles[id].open,
    top,
    closeTop() {
      top()?.close();
    },
    cover(covered) {
      for (const id of COVER_CARD_IDS) toggles[id].card.cover(covered);
    },
  };
}
