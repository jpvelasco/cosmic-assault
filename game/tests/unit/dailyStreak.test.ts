import { describe, expect, it } from 'vitest';
import { localDate } from '../../src/app/date';
import { nextDate, previousDate } from '../../src/meta/calendar';
import { dailyBestBefore, recordDailyClear, shownStreak } from '../../src/meta/daily';
import { defaultSave, mergeSaves, type SaveData } from '../../src/meta/save';
import { createRng, type Rng } from '../../src/sim/rng';

/** Clears each date in turn, all scoring 100. */
function clearAll(dates: readonly string[], save: SaveData = defaultSave()): SaveData {
  return dates.reduce((s, date) => recordDailyClear(s, date, 100), save);
}

describe('recordDailyClear', () => {
  it('starts the streak at 1 on a first clear, and sets the best streak, the last date and the best', () => {
    const save = recordDailyClear(defaultSave(), '2026-10-27', 250);
    expect(save.daily).toEqual({ lastCleared: '2026-10-27', streak: 1, bestStreak: 1, best: { date: '2026-10-27', score: 250 } });
  });

  it('continues the streak from the day before', () => {
    expect(clearAll(['2026-10-26', '2026-10-27']).daily).toMatchObject({ lastCleared: '2026-10-27', streak: 2, bestStreak: 2 });
  });

  it('restarts at 1 after a missed day, and keeps the best streak', () => {
    const save = clearAll(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-25']);
    expect(save.daily).toMatchObject({ lastCleared: '2026-10-25', streak: 1, bestStreak: 4 });
  });

  it.each([
    [['2026-01-31', '2026-02-01'], 2],
    [['2026-12-31', '2027-01-01'], 2],
    [['2028-02-28', '2028-02-29', '2028-03-01'], 3],
    [['2027-02-28', '2027-03-01'], 2],
    [['2027-02-27', '2027-03-01'], 1],
    [['2026-02-28', '2026-03-01'], 2],
  ])('crosses the boundaries in %j with a streak of %i', (dates, streak) => {
    expect(clearAll(dates).daily.streak).toBe(streak);
  });

  it('counts a long run across a leap day as unbroken', () => {
    const dates: string[] = [];
    let day = '2028-02-20';
    for (let i = 0; i < 20; i++) {
      dates.push(day);
      day = nextDate(day);
    }
    expect(clearAll(dates).daily).toMatchObject({ streak: 20, bestStreak: 20 });
  });

  it('changes nothing for a date already counted, and returns the same save', () => {
    const once = recordDailyClear(clearAll(['2026-10-26']), '2026-10-27', 300);
    expect(recordDailyClear(once, '2026-10-27', 300)).toBe(once);
    expect(recordDailyClear(once, '2026-10-27', 10)).toBe(once);
  });

  it('changes nothing when the clock is set back, and returns the same save', () => {
    const save = clearAll(['2026-10-25', '2026-10-26', '2026-10-27']);
    expect(recordDailyClear(save, '2026-10-26', 9999)).toBe(save);
    expect(recordDailyClear(save, '2026-10-20', 9999)).toBe(save);
    expect(save.daily.streak).toBe(3);
  });

  it('keeps the streak when a new clear arrives after a clock set back', () => {
    const save = recordDailyClear(clearAll(['2026-10-25', '2026-10-26', '2026-10-27']), '2026-10-28', 100);
    expect(save.daily).toMatchObject({ lastCleared: '2026-10-28', streak: 4, bestStreak: 4 });
  });

  it('replaces the best score on the same date only with a higher one', () => {
    const first = recordDailyClear(defaultSave(), '2026-10-27', 300);
    const higher = recordDailyClear(first, '2026-10-27', 900);
    expect(higher.daily.best).toEqual({ date: '2026-10-27', score: 900 });
    expect(recordDailyClear(higher, '2026-10-27', 100)).toBe(higher);
  });

  it('lets a later date replace the best, whatever its score', () => {
    const save = recordDailyClear(recordDailyClear(defaultSave(), '2026-10-27', 900), '2026-10-28', 50);
    expect(save.daily.best).toEqual({ date: '2026-10-28', score: 50 });
  });

  it('never lets an earlier date replace the best', () => {
    const save = recordDailyClear(recordDailyClear(defaultSave(), '2026-10-28', 50), '2026-10-27', 9999);
    expect(save.daily.best).toEqual({ date: '2026-10-28', score: 50 });
  });

  it('throws a RangeError for a malformed date, before the streak is touched', () => {
    expect(() => recordDailyClear(defaultSave(), '2026-02-30', 1)).toThrow(RangeError);
    expect(() => recordDailyClear(clearAll(['2026-10-26']), '2026-10-27T00:00', 1)).toThrow(RangeError);
  });
});

describe('dailyBestBefore', () => {
  it('is null before any record, and null for a date other than the recorded one', () => {
    expect(dailyBestBefore(defaultSave(), '2026-10-27')).toBeNull();
    const save = recordDailyClear(defaultSave(), '2026-10-27', 400);
    expect(dailyBestBefore(save, '2026-10-28')).toBeNull();
  });

  it('is the recorded score on the recorded date', () => {
    expect(dailyBestBefore(recordDailyClear(defaultSave(), '2026-10-27', 400), '2026-10-27')).toBe(400);
  });
});

describe('shownStreak', () => {
  it('is 0 with no clear yet', () => {
    expect(shownStreak(defaultSave(), '2026-10-27')).toBe(0);
  });

  it('is the streak when the last clear was today or yesterday', () => {
    const save = clearAll(['2026-10-25', '2026-10-26']);
    expect(shownStreak(save, '2026-10-26')).toBe(2);
    expect(shownStreak(save, '2026-10-27')).toBe(2);
  });

  it('is 0 once a day has been missed, with no message about it', () => {
    expect(shownStreak(clearAll(['2026-10-25', '2026-10-26']), '2026-10-28')).toBe(0);
  });

  it('is 0 when the last clear is after today, as when the clock is set back', () => {
    expect(shownStreak(clearAll(['2026-10-27']), '2026-10-25')).toBe(0);
  });

  it('reads across a month end and a leap day', () => {
    expect(shownStreak(clearAll(['2028-02-28', '2028-02-29']), '2028-03-01')).toBe(2);
    expect(shownStreak(clearAll(['2027-02-28']), '2027-03-01')).toBe(1);
  });
});

describe('merging the daily record', () => {
  it('takes the later last clear with its streak, and the best streak of either side', () => {
    const later = clearAll(['2026-10-25', '2026-10-26', '2026-10-27']);
    const earlier = clearAll(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    for (const merged of [mergeSaves(later, earlier), mergeSaves(earlier, later)]) {
      expect(merged.daily).toMatchObject({ lastCleared: '2026-10-27', streak: 3, bestStreak: 5 });
    }
  });

  it('counts a date that two tabs both cleared once', () => {
    const base = clearAll(['2026-10-25', '2026-10-26']);
    const tabA = recordDailyClear(base, '2026-10-27', 100);
    const tabB = recordDailyClear(base, '2026-10-27', 300);
    expect(mergeSaves(tabA, tabB).daily).toMatchObject({ lastCleared: '2026-10-27', streak: 3, bestStreak: 3 });
    expect(mergeSaves(tabA, tabA).daily.streak).toBe(3);
  });

  it('keeps the later best date, or the higher score on the same date', () => {
    const high = recordDailyClear(defaultSave(), '2026-10-27', 900);
    const low = recordDailyClear(defaultSave(), '2026-10-27', 300);
    const next = recordDailyClear(defaultSave(), '2026-10-28', 10);
    for (const merged of [mergeSaves(high, low), mergeSaves(low, high)]) expect(merged.daily.best).toEqual({ date: '2026-10-27', score: 900 });
    for (const merged of [mergeSaves(high, next), mergeSaves(next, high)]) expect(merged.daily.best).toEqual({ date: '2026-10-28', score: 10 });
  });

  describe('over generated tab histories', () => {
    /** A history of clears from a boundary-heavy start: runs, gaps, repeats and clock set backs. */
    const START_DATES = ['2026-01-31', '2026-10-24', '2026-12-30', '2027-02-26', '2028-02-27', '2028-02-28'] as const;

    function randomHistory(rng: Rng): SaveData {
      let day: string = rng.pick(START_DATES);
      let save = defaultSave();
      const steps = rng.int(0, 9);
      for (let i = 0; i < steps; i++) {
        save = recordDailyClear(save, day, rng.int(0, 5) * 100);
        const move = rng.next();
        if (move < 0.6) day = nextDate(day);
        else if (move < 0.75) day = nextDate(nextDate(day));
        else if (move < 0.85) day = previousDate(day);
      }
      return save;
    }

    const rng = createRng(20261027);
    const pairs = Array.from({ length: 300 }, () => [randomHistory(rng), randomHistory(rng)] as const);

    it('is commutative', () => {
      for (const [a, b] of pairs) expect(mergeSaves(a, b).daily).toEqual(mergeSaves(b, a).daily);
    });

    it('is idempotent once merged', () => {
      for (const [a, b] of pairs) {
        const merged = mergeSaves(a, b);
        expect(mergeSaves(merged, merged).daily).toEqual(merged.daily);
        expect(mergeSaves(merged, a).daily).toEqual(merged.daily);
        expect(mergeSaves(merged, b).daily).toEqual(merged.daily);
      }
    });

    it('never leaves the best streak below the streak', () => {
      for (const [a, b] of pairs) {
        const { streak, bestStreak } = mergeSaves(a, b).daily;
        expect(bestStreak).toBeGreaterThanOrEqual(streak);
      }
    });
  });
});

describe('the streak across daylight saving changes', () => {
  const ZONES: readonly (readonly [zone: string, changes: readonly string[]])[] = [
    ['America/New_York', ['2026-03-08', '2026-11-01']],
    ['Europe/London', ['2026-03-29', '2026-10-25']],
    ['Australia/Lord_Howe', ['2026-04-05', '2026-10-04']],
  ];

  for (const [zone, changes] of ZONES) {
    for (const day of changes) {
      it(`${zone}: clears either side of ${day} at 23:30 and 00:30 make one unbroken streak`, () => {
        const before = process.env.TZ;
        process.env.TZ = zone;
        try {
          const dayBefore = localDate(new Date(`${previousDate(day)}T23:30`));
          const changeDay = localDate(new Date(`${day}T00:30`));
          const sameDayLater = localDate(new Date(`${day}T23:30`));
          const dayAfter = localDate(new Date(`${nextDate(day)}T00:30`));
          expect([dayBefore, changeDay, dayAfter]).toEqual([previousDate(day), day, nextDate(day)]);
          const save = clearAll([dayBefore, changeDay]);
          expect(save.daily).toMatchObject({ lastCleared: day, streak: 2 });
          expect(recordDailyClear(save, sameDayLater, 100)).toBe(save);
          expect(clearAll([dayBefore, changeDay, dayAfter]).daily).toMatchObject({ streak: 3, bestStreak: 3 });
        } finally {
          if (before === undefined) delete process.env.TZ;
          else process.env.TZ = before;
        }
      });
    }
  }
});
