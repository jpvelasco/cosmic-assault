import { describe, expect, it } from 'vitest';
import { localDate } from '../../src/app/date';
import { compareDates, dayNumber, isCalendarDate, nextDate, previousDate } from '../../src/meta/calendar';
import { CLOCK_CHANGES, inZone } from '../helpers/dates';

const HOUR_MS = 3_600_000;

describe('isCalendarDate', () => {
  it.each(['2026-10-27', '2000-02-29', '2028-02-29', '1999-12-31', '0000-02-29', '9999-12-31'])('accepts %s', (text) => {
    expect(isCalendarDate(text)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2027-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-1-05',
    '26-10-27',
    '2026-10-27T00:00',
    ' 2026-10-27',
    '',
    20261027,
    null,
    undefined,
  ])('rejects %j', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});

describe('previousDate and nextDate', () => {
  it.each([
    ['2026-10-01', '2026-09-30'],
    ['2026-03-01', '2026-02-28'],
    ['2027-03-01', '2027-02-28'],
    ['2028-03-01', '2028-02-29'],
    ['2027-01-01', '2026-12-31'],
    ['2000-03-01', '2000-02-29'],
    ['1900-03-01', '1900-02-28'],
    ['0001-01-01', '0000-12-31'],
  ])('the day before %s is %s', (day, before) => {
    expect(previousDate(day)).toBe(before);
    expect(nextDate(before)).toBe(day);
  });

  it.each([
    ['2026-01-31', '2026-02-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'],
    ['2028-02-29', '2028-03-01'],
    ['2027-02-28', '2027-03-01'],
  ])('the day after %s is %s', (day, after) => {
    expect(nextDate(day)).toBe(after);
    expect(previousDate(after)).toBe(day);
  });

  it('walks a long run of days, one calendar day at a time', () => {
    let day = '1999-12-01';
    for (let i = 0; i < 3000; i++) {
      const after = nextDate(day);
      expect(isCalendarDate(after)).toBe(true);
      expect(previousDate(after)).toBe(day);
      expect(dayNumber(after) - dayNumber(day)).toBe(1);
      day = after;
    }
  });

  it('has no neighbour beyond the calendar years 0000 to 9999', () => {
    expect(() => previousDate('0000-01-01')).toThrow(RangeError);
    expect(() => nextDate('9999-12-31')).toThrow(RangeError);
  });
});

describe('dayNumber', () => {
  it('counts days from 1970-01-01', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('1969-12-31')).toBe(-1);
  });

  it('gives consecutive numbers across month ends, year ends and leap days', () => {
    expect(dayNumber('2026-03-01') - dayNumber('2026-02-28')).toBe(1);
    expect(dayNumber('2027-01-01') - dayNumber('2026-12-31')).toBe(1);
    expect(dayNumber('2028-03-01') - dayNumber('2028-02-28')).toBe(2);
    expect(dayNumber('2027-03-01') - dayNumber('2027-02-28')).toBe(1);
  });
});

describe('compareDates', () => {
  it('orders calendar dates', () => {
    expect(compareDates('2026-10-26', '2026-10-27')).toBe(-1);
    expect(compareDates('2026-10-27', '2026-10-27')).toBe(0);
    expect(compareDates('2027-01-01', '2026-12-31')).toBe(1);
    expect(compareDates('2028-02-29', '2028-03-01')).toBe(-1);
    expect(compareDates('2026-09-30', '2026-10-01')).toBe(-1);
    expect(compareDates('2026-01-01', '2026-12-31')).toBe(-1);
    expect(compareDates('2026-12-31', '2026-01-01')).toBe(1);
    expect(compareDates('1970-01-01', '2026-10-27')).toBe(-1);
  });
});

describe('malformed dates', () => {
  const readers: Record<string, (date: string) => unknown> = {
    dayNumber,
    previousDate,
    nextDate,
    compareDates: (date) => compareDates(date, '2026-10-27'),
  };

  for (const [name, read] of Object.entries(readers)) {
    it(`${name} throws a RangeError that names YYYY-MM-DD`, () => {
      for (const bad of ['2026-02-30', '2026-10-27T00:00', '']) {
        expect(() => read(bad)).toThrow(RangeError);
        expect(() => read(bad)).toThrow(/YYYY-MM-DD/);
      }
    });
  }
});

describe('localDate across daylight saving changes', () => {

  /** A local wall-clock time; a date-time with no offset is read as local time. */
  const at = (day: string, time: string): Date => new Date(`${day}T${time}`);

  it.each(CLOCK_CHANGES)('$zone: the clocks really change on $day, and 23:30 and 00:30 either side fall on the right dates', ({ zone, day, hours }) => {
    const [before, after] = [previousDate(day), nextDate(day)];
    inZone(zone, () => {
      const hoursInDay = (at(after, '00:00').getTime() - at(day, '00:00').getTime()) / HOUR_MS;
      expect(hoursInDay).toBe(hours);
      expect(localDate(at(before, '23:30'))).toBe(before);
      expect(localDate(at(day, '00:30'))).toBe(day);
      expect(localDate(at(day, '23:30'))).toBe(day);
      expect(localDate(at(after, '00:30'))).toBe(after);
    });
  });
});
