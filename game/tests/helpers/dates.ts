import { nextDate } from '../../src/meta/calendar';

/** Runs `body` with `process.env.TZ` set to `zone`, restoring the previous value afterwards. */
export function inZone(zone: string, body: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/**
 * The clock changes of 2026 in three zones: the zone, the day its clocks change and that day's length in hours. The
 * calendar, streak and Daily suites all cross them.
 */
export const CLOCK_CHANGES: readonly Readonly<{ zone: string; day: string; hours: number }>[] = [
  { zone: 'America/New_York', day: '2026-03-08', hours: 23 },
  { zone: 'America/New_York', day: '2026-11-01', hours: 25 },
  { zone: 'Europe/London', day: '2026-03-29', hours: 23 },
  { zone: 'Europe/London', day: '2026-10-25', hours: 25 },
  { zone: 'Australia/Lord_Howe', day: '2026-04-05', hours: 24.5 },
  { zone: 'Australia/Lord_Howe', day: '2026-10-04', hours: 23.5 },
];

/** `count` consecutive dates from `from`. */
export function datesFrom(from: string, count: number): string[] {
  const dates = [from];
  while (dates.length < count) dates.push(nextDate(dates[dates.length - 1] ?? from));
  return dates;
}
