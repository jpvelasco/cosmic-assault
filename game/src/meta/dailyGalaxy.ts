import { eventSeconds, threatBudget } from '../content/curves';
import {
  DAILY_ANCHORS,
  DAILY_GRID_SECONDS,
  DAILY_LABEL,
  DAILY_LOOKS,
  DAILY_MAX_SHOWER_INTENSITY,
  DAILY_SHOWER_COUNTS,
  DAILY_TWISTS,
  DAILY_WELL_CHANCE,
  TARGET_K,
  TARGET_ROUNDING,
  TARGET_SPREAD,
  type DailyTwist,
  type DailyTwistId,
} from '../content/daily';
import { galaxyById, tierOf } from '../content/galaxies';
import { HAZARD_RULES } from '../content/hazards';
import { lullStart, OPENING_SECONDS } from '../content/pacingRules';
import { poolFor } from '../content/pickups';
import type { GalaxyDef, GalaxyEvent, ThreatKind } from '../content/types';
import { galaxyProblems, scheduleProblems, STORM_INTENSITIES } from '../content/validity';
import { createRng, deriveSeed, hashString, type Rng } from '../sim/rng';
import { assertCalendarDate, FIRST_DATE, LAST_DATE, nextDate, previousDate } from './calendar';

/** A date's Daily Galaxy: the galaxy, its twist and target, and the seed its World runs on. */
export interface DailyGalaxy {
  readonly date: string;
  /** The World seed: the date's alone, so every player meets the same Daily. */
  readonly seed: number;
  readonly def: GalaxyDef;
  readonly twist: DailyTwistId;
  readonly target: number;
}

const dailySeed = (date: string): number => hashString(`cosmic-assault.daily:${date}`) >>> 0;
/** The generator's own stream for a date, apart from every stream the World draws. */
const dailyStream = (date: string): Rng => createRng(deriveSeed(dailySeed(date), 'daily'));
const rollTwist = (rng: Rng): DailyTwist => rng.pick(DAILY_TWISTS);

/** The twist `date` rolls, its stream's first draw, before the rule that no twist plays two days running. */
export function rolledTwist(date: string): DailyTwistId {
  return rollTwist(dailyStream(date)).id;
}

/**
 * The twist `date` plays: the one it `rolled`, unless the day before rolled the same. In a run of days that roll alike,
 * every second day plays one of the twists that neither it nor the day after rolled, picked by `reroll` (0 to 1). So no
 * two days running play alike, and a day needs only the rolls of its run and of the day after.
 */
function twistFor(date: string, rolled: DailyTwist, reroll: number): DailyTwist {
  let place = 0;
  for (let day = date; day !== FIRST_DATE && rolledTwist(previousDate(day)) === rolled.id; day = previousDate(day)) place++;
  if (place % 2 === 0) return rolled;
  const after = date === LAST_DATE ? null : rolledTwist(nextDate(date));
  const others = DAILY_TWISTS.filter((t) => t.id !== rolled.id && t.id !== after);
  return others[Math.floor(reroll * others.length)] ?? rolled;
}

/** The anchors a twist can play on: from its least Dimension, fielding every kind it scales. */
function anchorsFor(twist: DailyTwist): GalaxyDef[] {
  const scaled = Object.keys(twist.rampScale) as ThreatKind[];
  return DAILY_ANCHORS.map(galaxyById).filter((g) => g.dimension >= twist.minDimension && scaled.every((kind) => g.kinds[kind].max > 0));
}

/** `kinds` with each ramp the twist scales `times` as likely at its base and its max, the max no higher than its cap. */
function scaledRamps(kinds: GalaxyDef['kinds'], twist: DailyTwist): GalaxyDef['kinds'] {
  const out = { ...kinds };
  for (const kind of Object.keys(twist.rampScale) as ThreatKind[]) {
    const by = twist.rampScale[kind];
    if (by === undefined) continue;
    const ramp = kinds[kind];
    out[kind] = { ...ramp, base: Math.min(by.cap, ramp.base * by.times), max: Math.min(by.cap, ramp.max * by.times) };
  }
  return out;
}

/** The hazard a Daily schedules, if any: the twist's set piece, or by `wellDraw` a plain gravity well, each from its Dimension on. */
function hazardFor(twist: DailyTwist, anchor: GalaxyDef, wellDraw: number, intensityDraw: number): GalaxyEvent | null {
  const { setPiece } = twist;
  if (setPiece !== null) {
    const intensity = STORM_INTENSITIES[Math.floor(intensityDraw * STORM_INTENSITIES.length)] ?? 1;
    return anchor.dimension >= HAZARD_RULES[setPiece].from ? { at: 0, type: setPiece, intensity } : null;
  }
  return anchor.dimension >= HAZARD_RULES.gravityWell.from && wellDraw < DAILY_WELL_CHANCE ? { at: 0, type: 'gravityWell', intensity: 1 } : null;
}

/** `items` in an order shuffled by `rng`. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The times on the grid from the opening's end to `latest`, from `from` on and then the earlier ones. */
function gridFrom(from: number, latest: number): number[] {
  const times: number[] = [];
  for (let at = OPENING_SECONDS; at <= latest; at += DAILY_GRID_SECONDS) times.push(at);
  return [...times.filter((at) => at >= from), ...times.filter((at) => at < from)];
}

/**
 * The `wanted` events placed in turn, each at the first time on the grid where the schedule still keeps every content
 * rule and the event ends by the lull, looking from `start` (0 to 1 of the way through the window) on and then before
 * it, so a Daily's events do not all crowd its opening. One with no such time is left out.
 */
function placed(def: GalaxyDef, wanted: readonly GalaxyEvent[], start: number): GalaxyEvent[] {
  const window = lullStart(def) - OPENING_SECONDS;
  const from = OPENING_SECONDS + DAILY_GRID_SECONDS * Math.floor((start * window) / DAILY_GRID_SECONDS);
  let events: GalaxyEvent[] = [];
  for (const e of wanted) {
    for (const at of gridFrom(from, lullStart(def) - eventSeconds(e))) {
      const tried = [...events, { ...e, at }].sort((a, b) => a.at - b.at);
      if (scheduleProblems({ ...def, events: tried }).length > 0) continue;
      events = tried;
      break;
    }
  }
  return events;
}

/** The score a Daily sets to beat: its anchor's length and budget, its twist's scale and a `spread` (0 to 1) about them. */
function targetFor(anchor: GalaxyDef, twist: DailyTwist, spread: number): number {
  const target = TARGET_K * anchor.duration * threatBudget(tierOf(anchor)) * twist.targetScale * (TARGET_SPREAD.low + TARGET_SPREAD.width * spread);
  return Math.round(target / TARGET_ROUNDING) * TARGET_ROUNDING;
}

/**
 * The Daily Galaxy of `date` (`YYYY-MM-DD`): the same for everyone who plays that date, from the date alone. It is a
 * survival galaxy built on an anchor from The Drift or Ion Reach, whose id, Dimension, index, length and ramps it keeps,
 * in a look of its own, with its own showers and hazard and one twist; the twist never repeats two days running. Throws
 * on a date that is not a calendar date, and on a Daily that would break a content rule, naming the date.
 */
export function dailyGalaxy(date: string): DailyGalaxy {
  assertCalendarDate(date);
  const rng = dailyStream(date);
  const twist = twistFor(date, rollTwist(rng), rng.next());
  const anchor = rng.pick(anchorsFor(twist));
  const look = rng.pick(DAILY_LOOKS);
  const showerCount = rng.pick(DAILY_SHOWER_COUNTS) * twist.showerFactor;
  const hazard = hazardFor(twist, anchor, rng.next(), rng.next());
  const spread = rng.next();
  const start = rng.next();
  const shower: GalaxyEvent = { at: 0, type: 'meteorShower', intensity: Math.min(DAILY_MAX_SHOWER_INTENSITY, anchor.dimension) as GalaxyEvent['intensity'] };
  const wanted = [...Array<GalaxyEvent>(showerCount).fill(shower), ...(hazard === null ? [] : [hazard])];
  const base: GalaxyDef = { ...anchor, kinds: scaledRamps(anchor.kinds, twist), events: [], pickups: poolFor(anchor.dimension), featured: [], ...look, label: DAILY_LABEL };
  const def: GalaxyDef = { ...base, events: placed(base, shuffled(wanted, rng), start) };
  const problems = galaxyProblems(def);
  if (problems.length > 0) throw new Error(`The Daily Galaxy for ${date} breaks the content rules (${problems.join('; ')}): fix the Daily tables in content/daily.ts`);
  return { date, seed: dailySeed(date), def, twist: twist.id, target: targetFor(anchor, twist, spread) };
}
