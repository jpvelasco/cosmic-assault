import type { GalaxyMode } from '../sim/scoring';
import { button, element, menuCard, PRIMARY_BUTTON, withTestId, type Act, type MenuCard } from './dom';

export interface ModeSelect {
  readonly modeSelect: MenuCard;
  readonly confirmNewRank: MenuCard;
  /** Where the title's Resume Rank group sits while mode select shows. */
  readonly resumeSlot: HTMLElement;
  /** The last row, under the mode cards: the Records chip, then the shared Back. */
  readonly chipRow: HTMLElement;
  /** Sets the line on how to choose, for keys or taps. */
  setHint(text: string): void;
}

interface ModeSpec {
  readonly mode: GalaxyMode;
  readonly name: string;
  readonly text: string;
  /** The glyph on the card's badge. */
  readonly badge: string;
}

const MODES: readonly ModeSpec[] = [
  { mode: 'rank', name: 'Rank', text: 'One run through every Dimension', badge: '★' },
  { mode: 'free', name: 'Free play', text: "Replay any galaxy you've unlocked", badge: '∞' },
];

/** A large glass card for `spec`, named by its title alone and described by its line, so its accessible name stays the mode's. */
function modeCard(spec: ModeSpec, act: Act): HTMLButtonElement {
  const id = `mode-${spec.mode}`;
  const card = withTestId(button(`mode-card mode-card--${spec.mode}`, '', act({ kind: 'chooseMode', mode: spec.mode })), id);
  const name = element('span', 'mode-card__name', spec.name);
  const text = element('span', 'mode-card__text', spec.text);
  name.id = `${id}-name`;
  text.id = `${id}-text`;
  card.setAttribute('aria-labelledby', name.id);
  card.setAttribute('aria-describedby', text.id);
  const badge = element('span', 'mode-card__badge', spec.badge);
  badge.setAttribute('aria-hidden', 'true');
  card.append(badge, name, text);
  return card;
}

/** Mode select (two large cards, Rank and Free play) and the card that confirms a new Rank run over a saved one. */
export function createModeSelect(act: Act): ModeSelect {
  const hint = element('p', 'hint');
  const resumeSlot = element('div', 'resume-slot');
  const cards = element('div', 'mode-cards');
  cards.append(...MODES.map((spec) => modeCard(spec, act)));
  const start = withTestId(button(PRIMARY_BUTTON, 'Start new run', act({ kind: 'chooseMode', mode: 'rank' })), 'confirm-new-rank');
  const chipRow = element('div', 'chips');
  return {
    modeSelect: menuCard('modes', 'Choose a mode', resumeSlot, cards, hint, chipRow),
    confirmNewRank: menuCard('confirm', 'Start a new run?', element('p', 'hint', 'Your saved run will end.'), start),
    resumeSlot,
    chipRow,
    setHint(text) {
      hint.textContent = text;
    },
  };
}
