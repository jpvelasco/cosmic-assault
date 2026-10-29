import type { BotProfile } from '../../src/bot/create';
import { runGalaxy, type RunResult } from '../../src/bot/run';
import { DAILY_TWISTS, type DailyTwistId } from '../../src/content/daily';
import { nextDate, previousDate } from '../../src/meta/calendar';
import { dailyGalaxy, reachesTarget, type DailyGalaxy } from '../../src/meta/dailyGalaxy';
import { fixed, formatColumns, percent } from './botRuns';
import { CLOCK_CHANGES, datesFrom } from './dates';

const RUN = datesFrom('2027-01-01', 200);
/**
 * The calendar's edges: every month's end in 2027, the next leap day, and each clock change with the days either side of
 * it. Those already in the run of 200 (the month ends to June) play once.
 */
const EDGES: readonly string[] = [
  ...datesFrom('2027-01-01', 365).filter((date) => nextDate(date).endsWith('-01')),
  '2028-02-29',
  ...CLOCK_CHANGES.flatMap(({ day }) => [previousDate(day), day, nextDate(day)]),
];

/** The dates the Daily suite plays: 200 running from 2027-01-01, and the calendar's edges. */
export const SUITE_DATES: readonly string[] = [...new Set([...RUN, ...EDGES])];

/** Forty of the suite's dates, spread evenly through it, that the expert also plays at 4:3 and at 21:9. */
export const ASPECT_DATES: readonly string[] = Array.from({ length: 40 }, (_, i) => SUITE_DATES[Math.floor((i * SUITE_DATES.length) / 40)] ?? '');

/** `profile` playing `daily` once, on its own World seed, as a Daily, on a field of `aspect` (16:9 by default). */
export const playDaily = (daily: DailyGalaxy, profile: BotProfile, aspect?: number): RunResult =>
  runGalaxy({ galaxy: daily.def, seed: daily.seed, profile, mode: 'daily', ...(aspect === undefined ? {} : { aspect }) });

/** What the three bots did on one date's Daily at 16:9. */
export interface DailyPlay {
  readonly daily: DailyGalaxy;
  readonly casual: RunResult;
  readonly expert: RunResult;
  readonly statue: RunResult;
}

/** Every bot playing `date`'s Daily once. */
export function playDate(date: string): DailyPlay {
  const daily = dailyGalaxy(date);
  return { daily, casual: playDaily(daily, 'casual'), expert: playDaily(daily, 'expert'), statue: playDaily(daily, 'statue') };
}

/** Whether `run` scored the Daily's target or more. */
const beatTarget = (play: DailyPlay, run: RunResult): boolean => reachesTarget(run.score, play.daily.target);
const share = (plays: readonly DailyPlay[], keep: (p: DailyPlay) => boolean): number => percent(plays.filter(keep).length, plays.length);

/** The rates the suite pins over a set of dates. */
export interface DailyRates {
  readonly dates: number;
  readonly casual: number;
  readonly expertClears: number;
  readonly expertTarget: number;
  readonly casualTarget: number;
}

export function ratesOf(plays: readonly DailyPlay[]): DailyRates {
  return {
    dates: plays.length,
    casual: share(plays, (p) => p.casual.cleared),
    expertClears: plays.filter((p) => p.expert.cleared).length,
    expertTarget: share(plays, (p) => beatTarget(p, p.expert)),
    casualTarget: share(plays, (p) => beatTarget(p, p.casual)),
  };
}

/** The plays of each twist, in the table's order. */
export const byTwist = (plays: readonly DailyPlay[]): [DailyTwistId, DailyPlay[]][] => DAILY_TWISTS.map(({ id }) => [id, plays.filter((p) => p.daily.twist === id)]);

/** The table of rates per twist and over every date, columns padded to line up. */
export function formatDailyTable(plays: readonly DailyPlay[]): string {
  const head = ['twist', 'dates', 'casual %', 'expert clears', 'expert ≥ target %', 'casual ≥ target %'];
  const row = (name: string, of: readonly DailyPlay[]): string[] => {
    const r = ratesOf(of);
    return [name, String(r.dates), fixed(r.casual), `${String(r.expertClears)}/${String(r.dates)}`, fixed(r.expertTarget), fixed(r.casualTarget)];
  };
  return formatColumns(head, [...byTwist(plays).map(([id, of]) => row(id, of)), row('all', plays)]);
}

/** How hard a date played: an expert loss above all, then a casual loss, then how far short of the target the casual fell. */
const hardness = (p: DailyPlay): number => (p.expert.cleared ? 0 : 4) + (p.casual.cleared ? 0 : 2) + Math.max(0, 1 - p.casual.score / p.daily.target);

/** A Daily's schedule, as "meteorShower 2 at 25 s, gravityWell 1 at 40 s". */
const scheduleOf = ({ def }: DailyGalaxy): string => def.events.map((e) => `${e.type} ${String(e.intensity)} at ${String(e.at)} s`).join(', ') || 'no events';

/** How a run ended, and its score. */
const outcome = (r: RunResult): string => `${r.cleared ? 'cleared' : `lost at ${fixed(r.time)} s`}, ${String(r.score)}`;

/** The `count` hardest dates, hardest first, with their twist, anchor, schedule, target and what the bots did. */
export function formatHardest(plays: readonly DailyPlay[], count: number): string {
  return [...plays]
    .sort((a, b) => hardness(b) - hardness(a))
    .slice(0, count)
    .map(({ daily, casual, expert, statue }) =>
      `${daily.date} ${daily.twist} on ${daily.def.id}, target ${String(daily.target)}: ${scheduleOf(daily)}; casual ${outcome(casual)}; expert ${outcome(expert)}; idle ship ${fixed(statue.time)} s`)
    .join('\n');
}
