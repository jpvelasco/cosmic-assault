/**
 * The local calendar date as `YYYY-MM-DD`: the only place a `Date` becomes a calendar date. Rank start dates, board
 * entries and the Daily all take their "today" from here, so the calendar rules in `meta/` never see a clock.
 */
export function localDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The app's "today": `pinned` (a `?today=` date in e2e and dev builds) when set, else the local date as of the call. */
export function appToday(pinned: string | undefined): () => string {
  return () => pinned ?? localDate(new Date());
}
