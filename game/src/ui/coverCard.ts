import { cardPanel, element, focusableControls } from './dom';

/** A dialog card that opens over the title or another card: the settings card and the records card. */
export interface CoverCard {
  readonly card: HTMLElement;
  /** Shows the card and moves keyboard focus to its first control. */
  show(): void;
  hide(): void;
  /** While another card covers it (the rotate prompt), it ignores taps, keys and Tab. */
  cover(covered: boolean): void;
  /** The controls that can take focus now, in document order; none while the card is hidden or covered. */
  controls(): HTMLElement[];
  dispose(): void;
}

/**
 * A hidden glass dialog card on an `overlay--modifier` panel in `root`, headed and named by `title`; the caller adds
 * its body. Esc and pad B close it through the input router, which closes the topmost cover card from any focus.
 */
export function createCoverCard(root: HTMLElement, modifier: string, title: string): CoverCard {
  const { panel, card } = cardPanel(modifier);
  panel.hidden = true;
  const heading = element('h2', 'heading', title);
  heading.id = `${modifier}-heading`;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', heading.id);
  card.append(heading);
  root.append(panel);

  const controls = (): HTMLElement[] => focusableControls(panel);

  return {
    card,
    show() {
      panel.hidden = false;
      controls()[0]?.focus();
    },
    hide() {
      panel.hidden = true;
    },
    cover(covered) {
      panel.inert = covered;
    },
    controls,
    dispose() {
      panel.remove();
    },
  };
}
