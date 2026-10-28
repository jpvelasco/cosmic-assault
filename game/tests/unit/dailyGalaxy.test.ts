import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { threatBudget } from '../../src/content/curves';
import { DAILY_ANCHORS, DAILY_TWISTS, TARGET_K, TARGET_SPREAD, type DailyTwistId } from '../../src/content/daily';
import { GALAXIES, galaxyById, tierOf } from '../../src/content/galaxies';
import { HAZARD_RULES } from '../../src/content/hazards';
import { OPENING_SECONDS } from '../../src/content/pacingRules';
import { poolFor } from '../../src/content/pickups';
import type { GalaxyDef, GalaxyEvent, ThreatKind } from '../../src/content/types';
import { galaxyProblems } from '../../src/content/validity';
import { compareDates, dayNumber, nextDate } from '../../src/meta/calendar';
import { dailyGalaxy, rolledTwist, type DailyGalaxy } from '../../src/meta/dailyGalaxy';
import { hashString } from '../../src/sim/rng';
import { datesFrom } from '../helpers/dailyRuns';
import { importClosure } from '../helpers/sourceImports';

const DATES = datesFrom('2026-01-01', 1000);
const DAILIES: readonly DailyGalaxy[] = DATES.map(dailyGalaxy);
const twistOf = (id: DailyTwistId) => DAILY_TWISTS.find((t) => t.id === id);
const ofTwist = (id: DailyTwistId): DailyGalaxy[] => DAILIES.filter((d) => d.twist === id);
const anchorOf = (d: DailyGalaxy): GalaxyDef => galaxyById(d.def.id);
const eventsOf = (d: DailyGalaxy, type: GalaxyEvent['type']): GalaxyEvent[] => d.def.events.filter((e) => e.type === type);
/** A thousand dates take about a second to build and check. */
const SWEEP_TIMEOUT_MS = 20_000;
/** Eleven years of dates take a few seconds. */
const RANGE_TIMEOUT_MS = 60_000;

/** The D1–D2 survival galaxies, the only material a Daily may use. */
const EARLY = GALAXIES.filter((g) => g.dimension <= 2 && g.kind === 'survival');

/**
 * A few dates' Dailies, pinned whole, one of each twist among them: a change to the generator's draws, its tables or its
 * placement changes what these dates play, so it must update them on purpose.
 */
const GOLDEN = [
  { date: '2026-10-26', seed: 1692440299, twist: 'gravityStorm', anchor: '2-2', palette: 'drift', target: 55150,
    events: [{ at: 20, type: 'gravityStorm', intensity: 2 }, { at: 30, type: 'meteorShower', intensity: 2 }] },
  { date: '2026-10-27', seed: 1675662680, twist: 'doubleMeteors', anchor: '1-3', palette: 'ionReach', target: 41050,
    events: [{ at: 15, type: 'meteorShower', intensity: 1 }, { at: 30, type: 'meteorShower', intensity: 1 }, { at: 45, type: 'meteorShower', intensity: 1 }] },
  { date: '2026-10-28', seed: 1658885061, twist: 'splitterField', anchor: '2-2', palette: 'ionReach', target: 51950,
    events: [{ at: 15, type: 'gravityWell', intensity: 1 }, { at: 25, type: 'meteorShower', intensity: 2 }, { at: 40, type: 'meteorShower', intensity: 2 }] },
  { date: '2027-01-01', seed: 1475997049, twist: 'droneSwarm', anchor: '2-2', palette: 'ionReach', target: 53400,
    events: [{ at: 15, type: 'gravityWell', intensity: 1 }, { at: 25, type: 'meteorShower', intensity: 2 }, { at: 60, type: 'meteorShower', intensity: 2 }] },
  { date: '2027-12-31', seed: 4250186330, twist: 'doubleMeteors', anchor: '2-3', palette: 'ionReach', target: 55800,
    events: [{ at: 20, type: 'meteorShower', intensity: 2 }, { at: 35, type: 'meteorShower', intensity: 2 }, { at: 45, type: 'gravityWell', intensity: 1 }, { at: 55, type: 'meteorShower', intensity: 2 }] },
] as const;

describe('dailyGalaxy', () => {
  it('builds the same Daily for a date every time: the same galaxy, twist, target and World seed', () => {
    for (const [i, date] of DATES.entries()) expect(JSON.stringify(dailyGalaxy(date)), date).toBe(JSON.stringify(DAILIES[i]));
  }, SWEEP_TIMEOUT_MS);

  it.each(GOLDEN)('builds the pinned Daily for $date', ({ date, seed, twist, anchor, palette, target, events }) => {
    const d = dailyGalaxy(date);
    expect({ seed: d.seed, twist: d.twist, anchor: d.def.id, palette: d.def.palette, target: d.target, events: d.def.events }).toEqual({ seed, twist, anchor, palette, target, events });
  });

  it('pins a Daily of every twist', () => {
    expect(new Set(GOLDEN.map((g) => g.twist))).toEqual(new Set(DAILY_TWISTS.map((t) => t.id)));
  });

  it('seeds the World from the date alone, and gives every date its own seed', () => {
    for (const d of DAILIES) {
      expect(d.seed, d.date).toBe(hashString(`cosmic-assault.daily:${d.date}`) >>> 0);
      expect(Number.isInteger(d.seed) && d.seed >= 0 && d.seed <= 0xffffffff).toBe(true);
    }
    expect(new Set(DAILIES.map((d) => d.seed)).size).toBe(DAILIES.length);
    expect(new Set(DAILIES.map((d) => JSON.stringify(d.def))).size).toBeGreaterThan(100);
  });

  it('takes only the date: no save, no unlocks, no clock', () => {
    expect(dailyGalaxy).toHaveLength(1);
    expectTypeOf(dailyGalaxy).parameters.toEqualTypeOf<[date: string]>();
    const loaded = [...new Set([...importClosure('meta/dailyGalaxy.ts'), ...importClosure('content/daily.ts')])];
    const outside = loaded.filter((module) => !module.startsWith('content/') && !['meta/dailyGalaxy', 'meta/calendar', 'sim/rng'].includes(module));
    expect(outside).toEqual([]);
    expect(loaded).toContain('content/validity');
  });

  it('throws on a date that is not a calendar date, saying what it expects', () => {
    for (const bad of ['2026-02-30', '2026-1-1', '', '2026-10-26T00:00']) expect(() => dailyGalaxy(bad), bad).toThrow(/YYYY-MM-DD/);
  });

  it('builds every Daily from Dimensions 1 and 2 alone: anchor, foes, hazards, pickups, palette and theme', () => {
    const fielded = new Set(EARLY.flatMap((g) => (Object.keys(g.kinds) as ThreatKind[]).filter((k) => g.kinds[k].max > 0)));
    for (const { date, def } of DAILIES) {
      expect(DAILY_ANCHORS, date).toContain(def.id);
      expect(def.dimension, date).toBeLessThanOrEqual(2);
      expect(def).toMatchObject({ kind: 'survival', boss: null, featured: [], label: 'Daily', duration: galaxyById(def.id).duration });
      for (const kind of Object.keys(def.kinds) as ThreatKind[]) if (def.kinds[kind].max > 0) expect(fielded, `${date} ${kind}`).toContain(kind);
      for (const e of def.events) {
        expect(['meteorShower', 'gravityWell', 'gravityStorm'], date).toContain(e.type);
        if (e.type !== 'meteorShower') expect(HAZARD_RULES[e.type].from, date).toBeLessThanOrEqual(2);
      }
      expect(def.pickups, date).toEqual(poolFor(def.dimension));
      expect(['drift', 'ionReach'], date).toContain(def.palette);
      expect(def.theme, date).toBe(def.palette);
    }
    for (const id of DAILY_ANCHORS) expect(EARLY.map((g) => g.id)).toContain(id);
  });

  it('passes every content rule on every date', () => {
    for (const { date, def } of DAILIES) expect(galaxyProblems(def), date).toEqual([]);
  });

  it('never plays one twist two days running, even where the rolls repeat', () => {
    for (let i = 1; i < DAILIES.length; i++) expect(DAILIES[i]?.twist, DATES[i]).not.toBe(DAILIES[i - 1]?.twist);
    // Runs of two and three days with the same roll, which the rule re-rolls in turn.
    const rolls = DATES.map(rolledTwist);
    const runs = (length: number): number => rolls.filter((roll, i) => i + 1 >= length && rolls.slice(i + 1 - length, i + 1).every((r) => r === roll)).length;
    expect(runs(2)).toBeGreaterThan(100);
    expect(runs(3)).toBeGreaterThan(10);
    // A day keeps the twist it rolled unless the day before rolled the same.
    for (let i = 1; i < DATES.length; i++) if (rolls[i] !== rolls[i - 1]) expect(DAILIES[i]?.twist, DATES[i]).toBe(rolls[i]);
  });

  it('plays every twist on at least 15% of a thousand dates', () => {
    for (const { id } of DAILY_TWISTS) expect(ofTwist(id).length, id).toBeGreaterThanOrEqual(150);
  });

  it('builds on every anchor, and on an Ion Reach one for a twist that needs it', () => {
    expect(new Set(DAILIES.map((d) => d.def.id))).toEqual(new Set(DAILY_ANCHORS));
    for (const d of DAILIES) expect(d.def.dimension, d.date).toBeGreaterThanOrEqual(twistOf(d.twist)?.minDimension ?? 9);
  });

  it('picks the look whatever the anchor', () => {
    for (const dimension of [1, 2]) {
      const looks = new Set(DAILIES.filter((d) => d.def.dimension === dimension).map((d) => d.def.palette));
      expect(looks, `Dimension ${String(dimension)}`).toEqual(new Set(['drift', 'ionReach']));
    }
  });

  it('keeps the anchor\'s ramps but the one its twist scales: drones and splitters 1.5 and 1.6 times, at most 0.6', () => {
    for (const d of DAILIES) {
      const anchor = anchorOf(d);
      const scale = twistOf(d.twist)?.rampScale ?? {};
      for (const kind of Object.keys(anchor.kinds) as ThreatKind[]) {
        const by = scale[kind];
        const ramp = anchor.kinds[kind];
        const expected = by === undefined ? ramp : { ...ramp, base: Math.min(by.cap, ramp.base * by.times), max: Math.min(by.cap, ramp.max * by.times) };
        expect(d.def.kinds[kind], `${d.date} ${kind}`).toEqual(expected);
      }
    }
    const drone = ofTwist('droneSwarm')[0];
    expect(drone?.def.kinds.drone).toEqual({ from: 1, base: 0.15 * 1.5, step: 0.3, max: 0.6 });
    const splitter = ofTwist('splitterField')[0];
    expect(splitter?.def.kinds.splitter.max).toBeCloseTo(0.35 * 1.6, 10);
    // A splitter field needs splitters to scale: 1-2 has none.
    expect(ofTwist('splitterField').map((d) => d.def.id)).not.toContain('1-2');
  });

  it('drops one or two showers, twice that for double meteors as far as the galaxy has room, at intensity 1 in The Drift and 2 in Ion Reach', () => {
    for (const d of DAILIES) {
      const showers = eventsOf(d, 'meteorShower');
      for (const e of showers) expect(e.intensity, d.date).toBe(d.def.dimension);
      if (d.twist === 'doubleMeteors') expect(showers.length, d.date).toBeGreaterThanOrEqual(2);
      else expect([1, 2], d.date).toContain(showers.length);
    }
    const doubled = new Set(ofTwist('doubleMeteors').map((d) => eventsOf(d, 'meteorShower').length));
    expect(doubled).toEqual(new Set([2, 3, 4]));
  });

  it('gives a gravity storm Daily one storm at intensity 1 or 2 in place of the plain well', () => {
    const storms = ofTwist('gravityStorm');
    for (const d of storms) {
      expect(eventsOf(d, 'gravityStorm'), d.date).toHaveLength(1);
      expect(eventsOf(d, 'gravityWell'), d.date).toEqual([]);
    }
    expect(new Set(storms.map((d) => eventsOf(d, 'gravityStorm')[0]?.intensity))).toEqual(new Set([1, 2]));
    for (const d of DAILIES.filter((x) => x.twist !== 'gravityStorm')) expect(eventsOf(d, 'gravityStorm'), d.date).toEqual([]);
  });

  it('gives a Daily on an Ion Reach anchor no gravity well or one, and one in The Drift none', () => {
    const plain = DAILIES.filter((d) => d.twist !== 'gravityStorm');
    for (const d of plain) expect(eventsOf(d, 'gravityWell').length, d.date).toBeLessThanOrEqual(d.def.dimension === 2 ? 1 : 0);
    // About half get one where the showers leave room, as two always do.
    const roomy = plain.filter((d) => d.def.dimension === 2 && eventsOf(d, 'meteorShower').length <= 2);
    const share = roomy.filter((d) => eventsOf(d, 'gravityWell').length === 1).length / roomy.length;
    expect(roomy.length).toBeGreaterThan(200);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  it('starts every event on the 5 s grid, from the end of the opening, the first of them anywhere in the galaxy', () => {
    for (const d of DAILIES)
      for (const e of d.def.events) {
        expect(e.at % 5, d.date).toBe(0);
        expect(e.at, d.date).toBeGreaterThanOrEqual(OPENING_SECONDS);
      }
    const firsts = DAILIES.map((d) => d.def.events[0]?.at);
    expect(new Set(firsts).size).toBeGreaterThanOrEqual(8);
    expect(firsts.filter((at) => at === OPENING_SECONDS).length).toBeLessThan(DAILIES.length * 0.6);
  });

  it('sets a target in steps of 50, spread by up to 8% about the anchor\'s duration, budget and twist', () => {
    for (const d of DAILIES) {
      const anchor = anchorOf(d);
      const middle = TARGET_K * anchor.duration * threatBudget(tierOf(anchor)) * (twistOf(d.twist)?.targetScale ?? 0);
      expect(d.target % 50, d.date).toBe(0);
      expect(d.target, d.date).toBeGreaterThanOrEqual(middle * TARGET_SPREAD.low - 25);
      expect(d.target, d.date).toBeLessThanOrEqual(middle * (TARGET_SPREAD.low + TARGET_SPREAD.width) + 25);
    }
    const mid = DAILIES.filter((d) => d.def.id === '2-1' || d.def.id === '2-2').map((d) => d.target);
    const mean = mid.reduce((sum, t) => sum + t, 0) / mid.length;
    expect(mean).toBeGreaterThan(45_000);
    expect(mean).toBeLessThan(56_000);
  });

  it('plays in the World as a Daily: the same run from the same seed', () => {
    const [d] = DAILIES;
    if (d === undefined) throw new Error('no Daily built');
    const play = () => runGalaxy({ galaxy: d.def, seed: d.seed, profile: 'casual', mode: 'daily', maxSeconds: 30 });
    expect(play()).toEqual(play());
  }, SWEEP_TIMEOUT_MS);

  it('builds every date from 2026 through 2036, and gives every Gravity storm Daily its storm', () => {
    let built = 0;
    for (let date = '2026-01-01'; compareDates(date, '2036-12-31') <= 0; date = nextDate(date)) {
      const d = dailyGalaxy(date);
      if (d.twist === 'gravityStorm') expect(eventsOf(d, 'gravityStorm'), date).toHaveLength(1);
      built++;
    }
    expect(built).toBe(dayNumber('2036-12-31') - dayNumber('2026-01-01') + 1);
  }, RANGE_TIMEOUT_MS);
});

describe('a Daily that breaks a content rule', () => {
  afterEach(() => {
    vi.doUnmock('../../src/content/daily');
    vi.doUnmock('../../src/content/hazards');
    vi.resetModules();
  });

  it('is refused, naming the date and what to fix', async () => {
    vi.resetModules();
    vi.doMock('../../src/content/daily', async (actual) => {
      const real: typeof import('../../src/content/daily') = await actual();
      return { ...real, DAILY_TWISTS: real.DAILY_TWISTS.map((t) => ({ ...t, rampScale: { large: { times: 3, cap: 2 } } })) };
    });
    const { dailyGalaxy: broken } = await import('../../src/meta/dailyGalaxy');
    expect(() => broken('2026-10-26')).toThrow(/2026-10-26.*large ramp.*content\/daily\.ts/);
  });

  it('is refused when its twist\'s set piece finds no time, naming the date and the twist', async () => {
    const date = ofTwist('gravityStorm')[0]?.date ?? '';
    vi.resetModules();
    vi.doMock('../../src/content/hazards', async (actual) => {
      const real: typeof import('../../src/content/hazards') = await actual();
      return { ...real, HAZARD_RULES: { ...real.HAZARD_RULES, gravityStorm: { ...real.HAZARD_RULES.gravityStorm, seconds: 1000 } } };
    });
    const { dailyGalaxy: crowded } = await import('../../src/meta/dailyGalaxy');
    expect(() => crowded(date)).toThrow(new RegExp(`${date}.*Gravity storm.*content/daily\\.ts`));
  });

  it('is refused when no anchor suits its twist, naming the twist and the date', async () => {
    const d = ofTwist('splitterField')[0];
    if (d === undefined) throw new Error('no Splitter field Daily built');
    vi.resetModules();
    vi.doMock('../../src/content/daily', async (actual) => {
      const real: typeof import('../../src/content/daily') = await actual();
      return { ...real, DAILY_ANCHORS: ['1-2'] };
    });
    const { dailyGalaxy: unanchored } = await import('../../src/meta/dailyGalaxy');
    expect(() => unanchored(d.date)).toThrow(new RegExp(`Splitter field.*${d.date}.*splitter.*DAILY_ANCHORS`));
  });
});
