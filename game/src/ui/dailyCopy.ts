import type { DailyBest } from '../meta/daily';
import { reachesTarget } from '../meta/dailyGalaxy';
import { spokenScore as grouped } from './dom';

/**
 * Every line the game shows about the Daily Galaxy, in one place: it invites and never presses, so nothing here speaks
 * of loss, missing out or a clock running down (tests/unit/dailyCopy.test.ts holds every line to that).
 */

/** The Daily's name on mode select and the records card. */
export const DAILY_NAME = 'Daily Galaxy';

/** The glyph on the Daily's mode card badge. */
export const DAILY_BADGE = '☼';

/** A Daily's title on its cards: "Daily Galaxy · 2026-10-26". */
export const dailyTitle = (date: string): string => `${DAILY_NAME} · ${date}`;

/** The results heading of a Daily clear. */
export const DAILY_CLEARED = 'Daily cleared';

/** "Target 14,500", its number joined to the word by a no-break space so it never wraps onto a line alone. */
export const targetText = (target: number): string => `Target\u00a0${grouped(target)}`;

/** The mode card's line: today's twist and its target. */
export const dailyCardLine = (twist: string, target: number): string => `${twist} · ${targetText(target)}`;

/** The streak, as mode select and the records card show it. */
export const streakText = (streak: number): string => `Streak ${String(streak)}`;

/** The longest streak so far, on the records card. */
export const bestStreakText = (streak: number): string => `Best streak ${String(streak)}`;

/** The toast as a Daily starts. */
export const twistToast = (twist: string): string => `Today's twist: ${twist}`;

/** The end card's target line: "Target 14,500 · beaten" once the score reaches it, else the target alone. */
export const targetLine = (target: number, score: number): string => (reachesTarget(score, target) ? `${targetText(target)} · beaten` : targetText(target));

/** The latest date's best, on the records card. */
export const dailyBestText = ({ date, score }: DailyBest): string => `Best on ${date}: ${grouped(score)}`;

/** The records card's Daily block before any Daily is cleared. */
export const NO_DAILY_YET = 'Clear a Daily Galaxy and its streak and best show here.';

/** The mode card's line when the day's Daily cannot be built: the other modes play on. */
export const DAILY_UNAVAILABLE = 'Daily unavailable';
