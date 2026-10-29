import { TWISTS_BY_ID } from '../content/daily';
import { shownStreak } from '../meta/daily';
import { tryDailyGalaxy, type DailyOutcome } from '../meta/dailyGalaxy';
import type { SaveData } from '../meta/save';
import { errorMessage, type RingLog } from '../platform/log';
import type { GalaxyMode } from '../sim/scoring';
import { DAILY_BADGE, DAILY_NAME, DAILY_UNAVAILABLE, dailyCardLine, streakText } from './dailyCopy';
import { button, element, menuCard, PRIMARY_BUTTON, reserveSpace, withTestId, type Act, type MenuCard } from './dom';
import { hintVariants } from './hints';

export interface ModeSelect {
  readonly modeSelect: MenuCard;
  readonly confirmNewRank: MenuCard;
  /** Where the title's Resume Rank group sits while mode select shows. */
  readonly resumeSlot: HTMLElement;
  /** The last row, under the mode cards: the Settings, Records and Hangar chips, then the shared Back. */
  readonly chipRow: HTMLElement;
  /** Sets the line on how to choose, for keys or taps. */
  setHint(text: string): void;
  /** Shows the Daily of `today` on its card, with the streak `save` holds. */
  update(save: SaveData, today: string): void;
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

/** The third card; its line names the day's twist and target, set by `update`. */
const DAILY_MODE: ModeSpec = { mode: 'daily', name: DAILY_NAME, text: '', badge: DAILY_BADGE };

/** The streak the Daily card shows from. */
const CARD_STREAK_FROM = 2;

/** What the Daily card shows. */
export interface DailyCardView {
  readonly line: string;
  readonly blurb: string;
  readonly streak: string;
  /** Why the date's Daily cannot be built, as a log line, which leaves the card unavailable; null when it can be played. */
  readonly problem: string | null;
}

/** Builds a date's Daily, or says why it cannot be built. */
type DailyBuild = (date: string) => DailyOutcome;

/**
 * What the Daily card shows on `today`: its twist and target, the twist's blurb, and the streak from 2 on ('' below).
 * A date `build` cannot make a Daily of shows the card as unavailable instead, so mode select still offers every other mode.
 */
export function dailyCardView(save: SaveData, today: string, build: DailyBuild = tryDailyGalaxy): DailyCardView {
  const built = build(today);
  if (built.daily === null) {
    const problem = `The Daily Galaxy of ${today} could not be built (${errorMessage(built.error)}), so its card shows it as unavailable; Rank and Free play are unaffected. Check that the device's date is right, then open mode select again.`;
    return { line: DAILY_UNAVAILABLE, blurb: '', streak: '', problem };
  }
  const { name, blurb } = TWISTS_BY_ID[built.daily.twist];
  const streak = shownStreak(save, today);
  return { line: dailyCardLine(name, built.daily.target), blurb, streak: streak >= CARD_STREAK_FROM ? streakText(streak) : '', problem: null };
}

/**
 * A large glass card for `spec`, pressed with `press`, named by its title alone and described by its line and any `extra`
 * lines, so its accessible name stays the mode's. Returns the card and its line.
 */
function modeCard(spec: ModeSpec, press: () => void, ...extra: HTMLElement[]): { readonly card: HTMLButtonElement; readonly text: HTMLElement } {
  const id = `mode-${spec.mode}`;
  const card = withTestId(button(`mode-card mode-card--${spec.mode}`, '', press), id);
  const name = element('span', 'mode-card__name', spec.name);
  const text = element('span', 'mode-card__text', spec.text);
  name.id = `${id}-name`;
  text.id = `${id}-text`;
  extra.forEach((line, i) => {
    line.id = `${id}-line-${String(i + 1)}`;
  });
  card.setAttribute('aria-labelledby', name.id);
  card.setAttribute('aria-describedby', [text, ...extra].map((line) => line.id).join(' '));
  const badge = element('span', 'mode-card__badge', spec.badge);
  badge.setAttribute('aria-hidden', 'true');
  card.append(badge, name, text, ...extra);
  return { card, text };
}

/**
 * Mode select (three large cards, Rank, Free play and the Daily) and the card that confirms a new Rank run over a saved one.
 * A date whose Daily `build` cannot make is written to `log`, once per date.
 */
export function createModeSelect(act: Act, log: Pick<RingLog, 'add'>, build: DailyBuild = tryDailyGalaxy): ModeSelect {
  const hint = element('p', 'hint');
  const resumeSlot = element('div', 'resume-slot');
  const blurb = element('span', 'mode-card__blurb');
  const streak = withTestId(element('span', 'mode-card__streak'), 'daily-streak');
  let shown: { readonly save: SaveData; readonly today: string } | null = null;
  // The Daily card's press names the date it shows, read as it is pressed.
  const pressDaily = (): void => {
    act(shown === null ? { kind: 'chooseMode', mode: 'daily' } : { kind: 'chooseMode', mode: 'daily', date: shown.today })();
  };
  const dailyCard = modeCard(DAILY_MODE, pressDaily, blurb, streak);
  const cards = element('div', 'mode-cards');
  cards.append(...MODES.map((spec) => modeCard(spec, act({ kind: 'chooseMode', mode: spec.mode })).card), dailyCard.card);
  const start = withTestId(button(PRIMARY_BUTTON, 'Start new run', act({ kind: 'chooseMode', mode: 'rank' })), 'confirm-new-rank');
  const chipRow = element('div', 'chips');
  /** The last date whose Daily could not be built, already logged. */
  let loggedFor: string | null = null;
  return {
    modeSelect: menuCard('modes', 'Choose a mode', resumeSlot, cards, reserveSpace(hint, hintVariants((hints) => hints.choose)), chipRow),
    confirmNewRank: menuCard('confirm', 'Start a new run?', element('p', 'hint', 'Your saved run will end.'), start),
    resumeSlot,
    chipRow,
    setHint(text) {
      hint.textContent = text;
    },
    update(save, today) {
      if (shown?.save === save && shown.today === today) return;
      shown = { save, today };
      const view = dailyCardView(save, today, build);
      dailyCard.text.textContent = view.line;
      blurb.textContent = view.blurb;
      streak.textContent = view.streak;
      streak.hidden = view.streak === '';
      dailyCard.card.disabled = view.problem !== null;
      if (view.problem !== null && loggedFor !== today) {
        loggedFor = today;
        log.add('error', view.problem, performance.now());
      }
    },
  };
}
