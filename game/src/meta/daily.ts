import { assertCalendarDate, compareDates, previousDate } from './calendar';
import type { SaveData } from './save';

/** The best Daily score, on the latest date played. */
export interface DailyBest {
  readonly date: string;
  readonly score: number;
}

export interface DailySave {
  /** The latest date cleared, or null before the first clear. */
  readonly lastCleared: string | null;
  /** Consecutive dates cleared, ending on `lastCleared`; 0 before the first clear. */
  readonly streak: number;
  /** The longest streak so far; never below `streak`, and never lowered. */
  readonly bestStreak: number;
  readonly best: DailyBest | null;
}

export function defaultDaily(): DailySave {
  return { lastCleared: null, streak: 0, bestStreak: 0, best: null };
}

type Streak = Pick<DailySave, 'lastCleared' | 'streak'>;

/** The later of two nullable values under `order`; null comes first, and on a tie `a` is kept. */
function later<T>(a: T | null, b: T | null, order: (x: T, y: T) => number): T | null {
  if (a === null || b === null) return a ?? b;
  return order(b, a) > 0 ? b : a;
}

function compareBest(a: DailyBest, b: DailyBest): number {
  return compareDates(a.date, b.date) || a.score - b.score;
}

/** Orders streaks by their last clear, then their length; a streak with no clear comes first. */
function compareStreak(a: Streak, b: Streak): number {
  if (a.lastCleared === null) return b.lastCleared === null ? 0 : -1;
  if (b.lastCleared === null) return 1;
  return compareDates(a.lastCleared, b.lastCleared) || a.streak - b.streak;
}

/** The streak and its best after `date` is cleared, or null when `date` is already counted or lies before the latest clear. */
function countClear(daily: DailySave, date: string): Pick<DailySave, 'lastCleared' | 'streak' | 'bestStreak'> | null {
  if (daily.lastCleared !== null && compareDates(date, daily.lastCleared) <= 0) return null;
  const continues = daily.lastCleared !== null && previousDate(date) === daily.lastCleared;
  const streak = continues ? daily.streak + 1 : 1;
  return { lastCleared: date, streak, bestStreak: Math.max(daily.bestStreak, streak) };
}

/**
 * The save with a Daily cleared on `date` for `score`. A date counts on its first clear and continues the
 * streak only from the day before; an earlier or repeated date changes no streak. The best is the higher
 * score on the latest date played. Returns `save` itself when nothing changes.
 */
export function recordDailyClear(save: SaveData, date: string, score: number): SaveData {
  assertCalendarDate(date);
  if (!Number.isSafeInteger(score) || score < 0) {
    throw new RangeError(`Expected a Daily score as a whole number of points, 0 or more, but got ${String(score)}. Pass the run's final score.`);
  }
  const { daily } = save;
  const best = later(daily.best, { date, score }, compareBest);
  const counted = countClear(daily, date);
  if (counted === null && best === daily.best) return save;
  return { ...save, daily: { ...(counted ?? daily), best } };
}

/** The best Daily score on `date` before its clear is recorded, or null when that date has no record yet. */
export function dailyBestBefore(save: SaveData, date: string): number | null {
  const best = save.daily.best;
  return best !== null && best.date === date ? best.score : null;
}

/** The streak to show on `today`: the streak while the last clear was today or yesterday, else 0 (nothing is shown). */
export function shownStreak(save: SaveData, today: string): number {
  const { lastCleared, streak } = save.daily;
  if (lastCleared === null) return 0;
  return lastCleared === today || lastCleared === previousDate(today) ? streak : 0;
}

/**
 * Two Daily records as one. The later last clear keeps its streak (a tie keeps the longer one), the best
 * streak is the highest of either side, and the best score is the later date's, or the higher score on the
 * same date. Commutative, associative and idempotent, so two tabs that cleared the same date count it once.
 */
export function mergeDaily(a: DailySave, b: DailySave): DailySave {
  const run = compareStreak(b, a) > 0 ? b : a;
  return {
    lastCleared: run.lastCleared,
    streak: run.streak,
    bestStreak: Math.max(a.bestStreak, b.bestStreak, run.streak),
    best: later(a.best, b.best, compareBest),
  };
}
