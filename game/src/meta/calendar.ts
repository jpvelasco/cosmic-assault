/**
 * Calendar dates as `YYYY-MM-DD` text in the proleptic Gregorian calendar. Every rule works on calendar
 * fields and whole days, never on milliseconds, and never reads a clock or a time zone, so a date means
 * the same thing wherever it is read. `meta/` bans the `Date` global, so the day count comes from the
 * civil-calendar formulas (Howard Hinnant's `days_from_civil` and `civil_from_days`) rather than `Date.UTC`.
 */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The first and last dates the calendar holds: a date beyond either has no four-digit year. */
export const FIRST_DATE = '0000-01-01';
export const LAST_DATE = '9999-12-31';

interface CivilDate {
  readonly year: number;
  /** 1 (January) to 12 (December). */
  readonly month: number;
  readonly day: number;
}

/** Days from 1970-01-01 to `date`: negative before it. */
function daysFromCivil({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const marchFirstMonth = (month + 9) % 12; // March is 0, so the leap day ends the year.
  const dayOfYear = Math.floor((153 * marchFirstMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The calendar date `days` days after 1970-01-01: the inverse of `daysFromCivil`. */
function civilFromDays(days: number): CivilDate {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const marchFirstMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * marchFirstMonth + 2) / 5) + 1;
  const month = marchFirstMonth < 10 ? marchFirstMonth + 3 : marchFirstMonth - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function formatDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The fields of `text` when it is a real calendar date, else null: a day that overflows its month reads back as another date. */
function fieldsOf(text: string): CivilDate | null {
  if (!CALENDAR_DATE.test(text)) return null;
  const date = { year: Number(text.slice(0, 4)), month: Number(text.slice(5, 7)), day: Number(text.slice(8, 10)) };
  return formatDate(civilFromDays(daysFromCivil(date))) === text ? date : null;
}

function requireFields(text: string): CivilDate {
  const date = fieldsOf(text);
  if (date === null) throw new RangeError(`Expected a calendar date as YYYY-MM-DD, such as 2026-10-27, but got ${JSON.stringify(text)}.`);
  return date;
}

/** True for a real `YYYY-MM-DD` date: 2026-02-30 and 2027-02-29 are not. */
export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && fieldsOf(value) !== null;
}

/** Throws a RangeError naming the expected form unless `date` is a real calendar date. */
export function assertCalendarDate(date: string): void {
  requireFields(date);
}

/** Days from 1970-01-01 to `date`. */
export function dayNumber(date: string): number {
  return daysFromCivil(requireFields(date));
}

function shiftDate(date: string, days: number): string {
  const shifted = civilFromDays(dayNumber(date) + days);
  if (shifted.year < 0 || shifted.year > 9999) throw new RangeError(`Calendar dates run from ${FIRST_DATE} to ${LAST_DATE}, so ${date} has no neighbour beyond that.`);
  return formatDate(shifted);
}

export function previousDate(date: string): string {
  return shiftDate(date, -1);
}

export function nextDate(date: string): string {
  return shiftDate(date, 1);
}

/** -1, 0 or 1 as `a` is before, the same as or after `b`. */
export function compareDates(a: string, b: string): number {
  return Math.sign(dayNumber(a) - dayNumber(b));
}
