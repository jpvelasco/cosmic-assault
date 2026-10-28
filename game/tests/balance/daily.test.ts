import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyGalaxy } from '../../src/meta/dailyGalaxy';
import { MAX_ASPECT, MIN_ASPECT } from '../../src/sim/config';
import {
  ASPECT_DATES,
  byTwist,
  formatDailyTable,
  formatHardest,
  playDaily,
  playDate,
  ratesOf,
  SUITE_DATES,
  type DailyPlay,
} from '../helpers/dailyRuns';

/**
 * Every Daily is beatable and in band: the bots play each of the suite's dates once on its own World seed, and the
 * table of rates per twist prints after every run. The bands are initial values, for the owner to tune.
 */
const CASUAL_CLEAR_BAND = { low: 50, high: 85 } as const;
/** How far a twist's casual clear rate may stray from the rate over every date, in points: no twist is a spike. */
const TWIST_SPREAD = 15;
const STATUE_SECONDS = 15;
const EXPERT_TARGET_PERCENT = 90;
const CASUAL_TARGET_BAND = { low: 15, high: 60 } as const;
/** How many of the hardest dates a failure lists. */
const HARDEST_SHOWN = 10;
/** Every date played by three bots takes minutes on a loaded host. */
const SUITE_TIMEOUT_MS = 900_000;

/** The dates of `plays` that `fail`, for a failure message. */
const datesWhere = (plays: readonly DailyPlay[], fail: (p: DailyPlay) => boolean): string => plays.filter(fail).map((p) => p.daily.date).join(', ') || 'none';

describe(`the Daily Galaxy, played by the bots on ${String(SUITE_DATES.length)} dates`, { timeout: SUITE_TIMEOUT_MS }, () => {
  let plays: DailyPlay[] = [];
  /** The table and the hardest dates, for every failure message. */
  let shown = '';

  beforeAll(() => {
    plays = SUITE_DATES.map(playDate);
    shown = `\n${formatDailyTable(plays)}\n\nThe hardest dates:\n${formatHardest(plays, HARDEST_SHOWN)}`;
  }, SUITE_TIMEOUT_MS);

  afterAll(() => {
    if (plays.length > 0) console.log(`\nThe Daily over ${String(plays.length)} dates:${shown}\n`);
  });

  it('has the expert clear every date', () => {
    expect(ratesOf(plays).expertClears, `lost on ${datesWhere(plays, (p) => !p.expert.cleared)}${shown}`).toBe(SUITE_DATES.length);
  });

  it(`has the expert clear ${String(ASPECT_DATES.length)} of the dates at 4:3 and at 21:9 too`, () => {
    for (const aspect of [MIN_ASPECT, MAX_ASPECT]) {
      const lost = ASPECT_DATES.filter((date) => !playDaily(dailyGalaxy(date), 'expert', aspect).cleared);
      expect(lost, `lost at ${aspect.toFixed(2)}`).toEqual([]);
    }
  }, SUITE_TIMEOUT_MS);

  it(`keeps the casual's clear rate from ${String(CASUAL_CLEAR_BAND.low)}% to ${String(CASUAL_CLEAR_BAND.high)}%`, () => {
    const { casual } = ratesOf(plays);
    expect(casual, shown).toBeGreaterThanOrEqual(CASUAL_CLEAR_BAND.low);
    expect(casual, shown).toBeLessThanOrEqual(CASUAL_CLEAR_BAND.high);
  });

  it(`keeps each twist's casual clear rate within ${String(TWIST_SPREAD)} points of the rate over every date`, () => {
    const overall = ratesOf(plays).casual;
    for (const [twist, of] of byTwist(plays)) {
      expect(of.length, twist).toBeGreaterThan(0);
      expect(Math.abs(ratesOf(of).casual - overall), `${twist}${shown}`).toBeLessThanOrEqual(TWIST_SPREAD);
    }
  });

  it(`keeps an idle ship alive at least ${String(STATUE_SECONDS)} s on every date`, () => {
    expect(datesWhere(plays, (p) => p.statue.time < STATUE_SECONDS), shown).toBe('none');
  });

  it(`sets a target the expert beats on ${String(EXPERT_TARGET_PERCENT)}% of dates or more, and the casual on ${String(CASUAL_TARGET_BAND.low)}% to ${String(CASUAL_TARGET_BAND.high)}%`, () => {
    const { expertTarget, casualTarget } = ratesOf(plays);
    expect(expertTarget, shown).toBeGreaterThanOrEqual(EXPERT_TARGET_PERCENT);
    expect(casualTarget, shown).toBeGreaterThanOrEqual(CASUAL_TARGET_BAND.low);
    expect(casualTarget, shown).toBeLessThanOrEqual(CASUAL_TARGET_BAND.high);
  });

  it('plays a date the same the second time', () => {
    const [first] = plays;
    if (first === undefined) throw new Error('no date played');
    expect(playDate(first.daily.date)).toEqual(first);
  });
});
