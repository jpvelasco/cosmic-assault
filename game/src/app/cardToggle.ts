import type { CoverCard } from '../ui/coverCard';
import type { Screen } from './flow';
import { actsUnder, type Cover } from './inputRouting';

export interface CardToggleDeps {
  /** The screens whose cards offer the card. */
  readonly opensOn: readonly Screen[];
  screen(): Screen;
  covers(): readonly Cover[];
  syncView(): void;
  /** Puts focus back on the chip that opened the card. */
  focusOpener(): void;
}

/** A cover card, whether it is up, and the one way it opens and closes. */
export interface CardToggle<C> {
  readonly card: C;
  readonly open: boolean;
  /** Shows the card over a screen that offers it; the run behind it, if any, stays as it was. */
  readonly show: () => void;
  /** Back, Done, Esc and pad Back: back to the card that opened it, with focus on its chip. */
  readonly close: () => void;
}

/** A card a player opens from the title or mode select, built with the close its own Back or Esc calls. */
export function createMenuCardToggle<C extends Pick<CoverCard, 'show' | 'hide'>>(
  makeCard: (close: () => void) => C,
  deps: Omit<CardToggleDeps, 'opensOn'>,
): CardToggle<C> {
  const toggle = createCardToggle(
    makeCard(() => {
      toggle.close();
    }),
    { ...deps, opensOn: ['title', 'modeSelect'] },
  );
  return toggle;
}

export function createCardToggle<C extends Pick<CoverCard, 'show' | 'hide'>>(card: C, deps: CardToggleDeps): CardToggle<C> {
  let open = false;
  return {
    card,
    get open() {
      return open;
    },
    show() {
      if (open || !deps.opensOn.includes(deps.screen())) return;
      open = true;
      deps.syncView();
      card.show();
    },
    close() {
      // A card under the rotate prompt is covered and stays put, however closing is asked.
      if (!open || !actsUnder('closeCard', deps.covers())) return;
      open = false;
      card.hide();
      deps.syncView();
      deps.focusOpener();
    },
  };
}
