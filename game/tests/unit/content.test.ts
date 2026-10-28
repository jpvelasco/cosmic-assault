import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import { DIMENSIONS, GALAXIES, galaxyById, galaxyIdOf, galaxyLabel, furthest, galaxyOrdinal, isGalaxyId, nextGalaxyId, tierOf } from '../../src/content/galaxies';
import { EFFECT_SECONDS, INSTANT_PICKUPS, isTimed, PICKUP_IDS, PICKUPS, TIMED_PICKUPS } from '../../src/content/pickups';
import { FOES, GUNSHIP, MINE } from '../../src/content/foes';
import { DANGER_ZONE, HAZARD_RULES } from '../../src/content/hazards';
import type { GalaxyDef, GalaxyId, HazardType, PickupId, ThreatKind } from '../../src/content/types';
import { eventSeconds, kindProbability, showerSeconds } from '../../src/content/curves';
import { lullStart, OPENING_SECONDS } from '../../src/content/pacingRules';
import { STEP_SECONDS } from '../../src/sim/config';
import { fieldBudget, GalaxyDirector, REFERENCE_AREA, THREAT_COST } from '../../src/sim/galaxy/director';
import { createRng } from '../../src/sim/rng';
import { phaseAt } from '../../src/sim/galaxy/pacing';
import { SHOWER_WARNING_SECONDS } from '../../src/sim/galaxy/showers';
import type { GalaxyEvent } from '../../src/content/types';

/** Seconds `e` is warned before it starts. */
const warning = (e: GalaxyEvent): number => (e.type === 'meteorShower' ? SHOWER_WARNING_SECONDS : HAZARD_RULES[e.type].telegraph);

/**
 * Every event of `events` warned before the previous one of its type has ended: the hazards and the showers run their
 * events one at a time, so such an event would be warned late and its telegraph cut short.
 */
function sameTypeOverlaps(events: readonly GalaxyEvent[]): string[] {
  const ends = new Map<GalaxyEvent['type'], GalaxyEvent>();
  const found: string[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const last = ends.get(e.type);
    const end = last === undefined ? -Infinity : last.at + eventSeconds(last);
    if (last !== undefined && e.at - warning(e) < end) found.push(`${e.type} at ${String(e.at)} is warned at ${String(e.at - warning(e))}, before the one at ${String(last.at)} ends at ${String(end)}`);
    ends.set(e.type, e);
  }
  return found;
}

const KINDS: readonly ThreatKind[] = ['large', 'medium', 'small', 'splitter', 'drone', 'gunship', 'mine'];
const survival = GALAXIES.filter((g) => g.kind === 'survival');

/** The kinds the director picks from in `galaxy`'s opening, over many seeds. */
function openingOffers(galaxy: GalaxyDef): Set<ThreatKind> {
  const kinds = new Set<ThreatKind>();
  for (let seed = 1; seed <= 20; seed++) {
    const director = new GalaxyDirector(galaxy, createRng(seed), REFERENCE_AREA);
    for (let t = 0; t < OPENING_SECONDS - 0.1; t += STEP_SECONDS) {
      const order = director.step(STEP_SECONDS, { elapsed: t, onFieldCost: 0, mercy: 1 });
      if (order !== null) kinds.add(order.kind);
    }
  }
  return kinds;
}

describe('the galaxy table', () => {
  it('holds 30 galaxies in order, five Dimensions of six', () => {
    expect(GALAXIES).toHaveLength(30);
    const ids = GALAXIES.map((g) => g.id);
    expect(ids).toEqual(Array.from({ length: 30 }, (_, n) => `${String(Math.floor(n / 6) + 1)}-${String((n % 6) + 1)}`));
    expect(new Set(ids).size).toBe(30);
  });

  it('agrees with itself: id, dimension and index', () => {
    for (const g of GALAXIES) expect(g.id).toBe(`${String(g.dimension)}-${String(g.index)}`);
  });

  it('gives each Dimension exactly one boss galaxy, and it is the sixth', () => {
    for (let d = 1; d <= 5; d++) {
      const bosses = GALAXIES.filter((g) => g.dimension === d && g.kind === 'boss');
      expect(bosses.map((g) => g.index)).toEqual([6]);
    }
    expect(GALAXIES.filter((g) => g.index === 6).every((g) => g.kind === 'boss')).toBe(true);
  });

  it('lasts 90 + 15 per earlier Dimension for survival, and a 20 s approach for a boss', () => {
    for (const g of survival) expect(g.duration).toBe(90 + 15 * (g.dimension - 1));
    expect(survival.map((g) => g.duration).filter((s, n, all) => all.indexOf(s) === n)).toEqual([90, 105, 120, 135, 150]);
    for (const g of GALAXIES.filter((x) => x.kind === 'boss')) expect(g.duration).toBe(20);
  });

  it('keeps every event inside the window from the opening\'s end to 25 s before the end, a black hole excepted', () => {
    for (const g of GALAXIES)
      for (const e of g.events) {
        // A black hole starts 12 s in, inside the opening, from a 3 s warning that ends as the opening does.
        if (e.type === 'blackHole') expect(e.at + warning(e), `${g.id} at ${String(e.at)}`).toBeGreaterThanOrEqual(OPENING_SECONDS);
        else expect(e.at, `${g.id} at ${String(e.at)}`).toBeGreaterThanOrEqual(OPENING_SECONDS);
        expect(e.at, `${g.id} at ${String(e.at)}`).toBeLessThanOrEqual(g.duration - 25);
      }
  });

  it('sorts events by time and keeps events apart', () => {
    for (const g of GALAXIES) {
      const times = g.events.map((e) => e.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(10);
    }
  });

  it('schedules meteor showers as the brief lays out', () => {
    for (const id of ['1-1', '1-2', '1-3'] as const) expect(galaxyById(id).events).toEqual([]);
    expect(galaxyById('1-4').events).toEqual([{ at: 50, type: 'meteorShower', intensity: 1 }]);
    for (const g of survival.filter((x) => x.dimension > 1 || x.index === 5)) {
      const showers = g.events.filter((e) => e.type === 'meteorShower');
      expect(showers.length, g.id).toBeGreaterThanOrEqual(1);
      expect(showers.length, g.id).toBeLessThanOrEqual(2);
      for (const e of showers) expect(e.intensity, g.id).toBe(Math.min(3, g.dimension));
    }
    for (const g of GALAXIES.filter((x) => x.kind === 'boss')) expect(g.events).toEqual([]);
  });

  it('keeps the lull clear: every shower and hazard ends by the time the lull starts (ending exactly then is allowed)', () => {
    for (const g of GALAXIES)
      for (const e of g.events) {
        expect(['lull', 'warp'], `${g.id} at ${String(e.at)}`).not.toContain(phaseAt(g, e.at));
        expect(e.at + eventSeconds(e), `${g.id} at ${String(e.at)}`).toBeLessThanOrEqual(lullStart(g));
      }
  });

  it('holds no hazard before the Dimension it belongs to', () => {
    for (const g of GALAXIES)
      for (const e of g.events) if (e.type !== 'meteorShower') expect(g.dimension, `${g.id} ${e.type}`).toBeGreaterThanOrEqual(HAZARD_RULES[e.type].from);
  });

  it('runs at most two scheduled events at once, showers included, from each warning to its end', () => {
    for (const g of GALAXIES)
      for (const e of g.events) {
        const from = e.at - warning(e);
        const running = g.events.filter((o) => o.at - warning(o) <= from && from < o.at + eventSeconds(o));
        expect(running.length, `${g.id} at ${String(from)}`).toBeLessThanOrEqual(2);
      }
  });

  it('never overlaps two events of one type: each is warned only once the last has ended (Ruling R10), in all 30 galaxies', () => {
    expect(GALAXIES).toHaveLength(30);
    for (const g of GALAXIES) expect(sameTypeOverlaps(g.events), g.id).toEqual([]);
  });

  it('catches a same-type overlap, which would cut the second one\'s telegraph short, but allows two types at once', () => {
    const repel = (at: number): GalaxyEvent => ({ at, type: 'repulsionField', intensity: 1 });
    expect(sameTypeOverlaps([repel(20), repel(35)])).toEqual(['repulsionField at 35 is warned at 33, before the one at 20 ends at 34']);
    expect(sameTypeOverlaps([repel(20), repel(36)])).toEqual([]);
    expect(sameTypeOverlaps([repel(20), { at: 22, type: 'gravityWell', intensity: 1 }])).toEqual([]);
  });

  it('times every hazard by its rule: eventSeconds reads HAZARD_RULES', () => {
    for (const type of Object.keys(HAZARD_RULES) as HazardType[]) expect(eventSeconds({ type, intensity: 2 }), type).toBe(HAZARD_RULES[type].seconds);
  });

  it('puts gravity wells in Ion Reach only, one a galaxy at most, 14 s long', () => {
    const wells = GALAXIES.flatMap((g) => g.events.filter((e) => e.type === 'gravityWell').map((e) => ({ g, e })));
    expect(wells.length).toBeGreaterThan(0);
    for (const { g, e } of wells) {
      expect(g.dimension, g.id).toBe(2);
      expect(eventSeconds(e)).toBe(14);
    }
    for (const g of GALAXIES) expect(g.events.filter((e) => e.type === 'gravityWell').length, g.id).toBeLessThanOrEqual(1);
    expect(galaxyById('2-4').events.map((e) => e.type)).toEqual(['meteorShower', 'gravityWell', 'meteorShower']);
  });

  it('keeps no more than two meteor showers in a galaxy', () => {
    for (const g of GALAXIES) expect(g.events.filter((e) => e.type === 'meteorShower').length, g.id).toBeLessThanOrEqual(2);
  });

  it('puts a second shower at about 60% of the duration, or earlier, ending just as the lull starts', () => {
    for (const g of survival.filter((x) => x.events.filter((e) => e.type === 'meteorShower').length === 2)) {
      const second = g.events.filter((e) => e.type === 'meteorShower')[1];
      if (second === undefined) continue;
      const end = second.at + showerSeconds(second.intensity);
      if (Math.abs(second.at - g.duration * 0.6) > 0.5) {
        expect(second.at, g.id).toBeLessThan(g.duration * 0.6);
        expect(end, g.id).toBe(lullStart(g));
      }
    }
    expect(galaxyById('1-5').events.map((e) => e.at)).toEqual([27, 51]);
  });

  it('pools pickups cumulatively: D1 drops core, double shot and shield; D2 adds rapid fire and spread laser; D3 piercing and homing; D4 the field bomb and the wingman; D5 the nova and time warp', () => {
    const d1: PickupId[] = ['weaponCore', 'doubleShot', 'shield'];
    const d2: PickupId[] = [...d1, 'rapidFire', 'spreadLaser'];
    const d3: PickupId[] = [...d2, 'piercingBeam', 'homingMissiles'];
    const d4: PickupId[] = [...d3, 'fieldBomb', 'wingman'];
    const d5: PickupId[] = [...d4, 'nova', 'timeWarp'];
    const pools = { 1: d1, 2: d2, 3: d3, 4: d4, 5: d5 };
    for (const g of GALAXIES) expect(g.pickups, g.id).toEqual(pools[g.dimension]);
  });

  it('enters the M6 pickups at their Dimensions with their weights', () => {
    const rows = (['piercingBeam', 'homingMissiles', 'fieldBomb', 'wingman', 'nova', 'timeWarp'] as const).map((id) => [id, PICKUPS[id].from, PICKUPS[id].weight]);
    expect(rows).toEqual([
      ['piercingBeam', 3, 2],
      ['homingMissiles', 3, 2],
      ['fieldBomb', 4, 1.5],
      ['wingman', 4, 2],
      ['nova', 5, 0.75],
      ['timeWarp', 5, 1.5],
    ]);
  });

  it('features the Dimension\'s new pickups in its first galaxy only, from D3 on, and only ones its pool holds', () => {
    for (const g of GALAXIES) {
      const fresh = PICKUP_IDS.filter((id) => PICKUPS[id].from === g.dimension);
      expect(g.featured, g.id).toEqual(g.index === 1 && g.dimension >= 3 ? fresh : []);
      for (const id of g.featured) expect(g.pickups, `${g.id} ${id}`).toContain(id);
    }
    expect(galaxyById('4-1').featured).toEqual(['fieldBomb', 'wingman']);
  });

  it('never lists a pickup before its Dimension, or one that does not exist', () => {
    for (const g of GALAXIES)
      for (const id of g.pickups) {
        expect(PICKUP_IDS, g.id).toContain(id);
        expect(PICKUPS[id].from, `${g.id} ${id}`).toBeLessThanOrEqual(g.dimension);
      }
    expect(PICKUPS.rapidFire.from).toBe(2);
    expect(PICKUPS.spreadLaser.from).toBe(2);
  });

  it('gives every pickup a distinct name, a "New: ..." callout that names it, a positive weight and a pool somewhere', () => {
    expect(new Set(PICKUP_IDS).size).toBe(PICKUP_IDS.length);
    for (const id of PICKUP_IDS) {
      const { name, callout, weight } = PICKUPS[id];
      expect(callout, id).toMatch(new RegExp(`^New: ${name} — .+`));
      expect(weight, id).toBeGreaterThan(0);
      expect(GALAXIES.some((g) => g.pickups.includes(id)), id).toBe(true);
    }
    expect(PICKUPS.doubleShot.callout).toBe('New: Double Shot — two shots at once');
    expect(new Set(PICKUP_IDS.map((id) => PICKUPS[id].name)).size).toBe(PICKUP_IDS.length);
  });

  it('lasts 12 s for double shot, rapid fire, spread laser, homing and the wingman, 15 s for the shield, 10 s for piercing and 8 s for time warp', () => {
    expect(EFFECT_SECONDS).toEqual({ doubleShot: 12, rapidFire: 12, spreadLaser: 12, shield: 15, piercingBeam: 10, homingMissiles: 12, wingman: 12, timeWarp: 8 });
  });

  it('times every pickup but the instant ones: the weapon core, the field bomb and the nova', () => {
    expect(INSTANT_PICKUPS).toEqual(['weaponCore', 'fieldBomb', 'nova']);
    const instant: readonly PickupId[] = INSTANT_PICKUPS;
    expect([...TIMED_PICKUPS].sort()).toEqual(PICKUP_IDS.filter((id) => !instant.includes(id)).sort());
    for (const id of PICKUP_IDS) expect(isTimed(id), id).toBe(!instant.includes(id));
  });

  it('shares one pool per Dimension', () => {
    for (const g of GALAXIES) expect(g.pickups).toBe(galaxyById(galaxyIdOf(g.dimension, 1)).pickups);
  });

  it('points every boss galaxy at a boss that exists, and no survival galaxy at one', () => {
    for (const g of GALAXIES) {
      if (g.kind === 'boss') expect(g.boss).not.toBeNull();
      else expect(g.boss).toBeNull();
      if (g.boss !== null) expect(Object.keys(BOSSES)).toContain(g.boss);
    }
    expect(BOSSES.eclipse.name).toBe('Eclipse');
  });

  it('keeps every ramp a probability: 0 <= base <= max <= 1', () => {
    for (const g of GALAXIES)
      for (const kind of KINDS) {
        const { base, max, step, from } = g.kinds[kind];
        expect(base, `${g.id} ${kind}`).toBeGreaterThanOrEqual(0);
        expect(base, `${g.id} ${kind}`).toBeLessThanOrEqual(max);
        expect(max, `${g.id} ${kind}`).toBeLessThanOrEqual(1);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(from).toBeGreaterThanOrEqual(0);
      }
  });

  it('shares seven ramp tables instead of repeating one per galaxy: rocks, rocks and splitters, Ion Reach\'s swarms, Crimson Nebula\'s gunships and mines, Void Rift\'s phasers and armour, Singularity\'s every foe, and a boss\'s field', () => {
    const rocks = {
      large: { from: 0, base: 0.6, step: 0, max: 0.6 },
      medium: { from: 0, base: 0.3, step: 0.05, max: 0.5 },
      small: { from: 0.5, base: 0.1, step: 0.05, max: 0.4 },
    };
    const none = { from: 0, base: 0, step: 0, max: 0 };
    const splitter = { from: 0.4, base: 0.15, step: 0.08, max: 0.35 };
    const drone = { from: 1, base: 0.15, step: 0.3, max: 0.45 };
    const foesNone = { splitter: none, drone: none, gunship: none, mine: none, phaser: none, armoured: none };
    const swarms = { ...rocks, large: { from: 0, base: 0.45, step: 0, max: 0.45 }, splitter, drone, gunship: none, mine: none, phaser: none, armoured: none };
    expect(galaxyById('1-1').kinds).toEqual({ ...rocks, ...foesNone });
    expect(galaxyById('1-3').kinds).toEqual({ ...rocks, ...foesNone, splitter });
    expect(galaxyById('2-1').kinds).toEqual(swarms);
    expect(galaxyById('3-1').kinds).toEqual({ ...swarms, gunship: { from: 2, base: 0.1, step: 0.1, max: 0.2 }, mine: { from: 2, base: 0, step: 0.15, max: 0.12 } });
    expect(galaxyById('4-1').kinds).toEqual({
      ...swarms,
      gunship: { from: 2, base: 0.1, step: 0.2, max: 0.2 },
      mine: { from: 2, base: 0, step: 0.3, max: 0.12 },
      phaser: { from: 3, base: 0.12, step: 0.05, max: 0.3 },
      armoured: { from: 3, base: 0.1, step: 0.05, max: 0.28 },
    });
    for (const id of ['1-6', '2-6', '3-6', '5-6'] as const) expect(galaxyById(id).kinds, id).toEqual({ ...rocks, large: none, ...foesNone });
    expect(galaxyById('5-1').kinds).toEqual({ ...swarms, splitter: { from: 0.4, base: 0.15, step: 0.08, max: 0.25 }, drone: { from: 1, base: 0.15, step: 0.3, max: 0.25 }, gunship: { from: 2, base: 0.1, step: 0.2, max: 0.25 }, mine: { from: 2, base: 0, step: 0.3, max: 0.2 }, phaser: { from: 3, base: 0.12, step: 0.1, max: 0.25 }, armoured: { from: 3, base: 0.1, step: 0.1, max: 0.25 } });
    expect(new Set(GALAXIES.map((g) => g.kinds)).size).toBe(7);
  });

  it('leaves room in every boss galaxy\'s approach for a medium rock at least, so no boss fights on a bare field', () => {
    for (const g of GALAXIES.filter((x) => x.kind === 'boss')) expect(fieldBudget(g, 1, 1, REFERENCE_AREA), g.id).toBeGreaterThanOrEqual(THREAT_COST.medium);
  });

  it('brings in splitters from 1-3, drones from Ion Reach, gunships and mines in Crimson Nebula and phasers and armour in Void Rift, each keeping the table before it, and every foe in Singularity; none before that, and none in a boss galaxy', () => {
    for (const g of GALAXIES) {
      const survival = g.kind === 'survival';
      const has = (kind: ThreatKind): boolean => g.kinds[kind].max > 0;
      expect(has('splitter'), g.id).toBe(survival && ((g.dimension === 1 && g.index >= 3) || (g.dimension >= 2 && g.dimension <= 5)));
      expect(has('drone'), g.id).toBe(survival && g.dimension >= 2 && g.dimension <= 5);
      expect(has('gunship'), g.id).toBe(survival && g.dimension >= 3 && g.dimension <= 5);
      expect(has('mine'), g.id).toBe(survival && g.dimension >= 3 && g.dimension <= 5);
      expect(has('phaser'), g.id).toBe(survival && g.dimension >= 4);
      expect(has('armoured'), g.id).toBe(survival && g.dimension >= 4);
    }
  });

  it('weighs gunships in at about 0.1 at 3-1, rising gently to 0.18 by 3-5, and mines in at about 0.03 at 3-2, none at 3-1, rising to 0.12', () => {
    const weight = (id: GalaxyId, kind: ThreatKind): number => kindProbability(galaxyById(id).kinds[kind], tierOf(galaxyById(id)));
    expect(weight('3-1', 'gunship')).toBeCloseTo(0.1, 10);
    expect(weight('3-5', 'gunship')).toBeCloseTo(0.18, 10);
    for (const [from, to] of [['3-1', '3-2'], ['3-2', '3-3'], ['3-3', '3-4'], ['3-4', '3-5']] as const) expect(weight(to, 'gunship')).toBeGreaterThan(weight(from, 'gunship'));
    expect(weight('3-1', 'mine')).toBe(0);
    expect(weight('3-2', 'mine')).toBeCloseTo(0.03, 10);
    expect(weight('3-5', 'mine')).toBeCloseTo(0.12, 10);
    // Neither is offered in a galaxy's opening: both ramps start past tier 0.
    expect(openingOffers(galaxyById('3-3'))).toEqual(new Set(['large', 'medium']));
  });

  it('holds a ramp at its base below `from`, climbs by `step` past it up to `max`, and keeps a kind out of the opening only while `from` is not 0', () => {
    const small = galaxyById('1-1').kinds.small;
    expect(small.from).toBeGreaterThan(tierOf(galaxyById('1-1')));
    expect(kindProbability(small, tierOf(galaxyById('1-1')))).toBe(small.base);
    expect(kindProbability(small, small.from + 2)).toBeCloseTo(small.base + 2 * small.step, 10);
    expect(kindProbability(small, 100)).toBe(small.max);
    // Below `from`, a kind is still picked at its base once the opening is over; in the opening it is not picked at all.
    expect(openingOffers(galaxyById('1-1'))).toEqual(new Set(['large', 'medium']));
    expect(openingOffers(galaxyById('2-3'))).toEqual(new Set(['large', 'medium']));
  });

  it('never ramps a foe in before its Dimension', () => {
    for (const g of GALAXIES)
      for (const kind of Object.keys(FOES) as (keyof typeof FOES)[]) {
        if (g.kinds[kind].max > 0) expect(g.dimension, `${g.id} ${kind}`).toBeGreaterThanOrEqual(FOES[kind].from);
      }
  });

  it('prices splitters 3 and drones 1, 2 HP and 1 HP, and groups drones 3 to 5', () => {
    expect(FOES.splitter).toMatchObject({ radius: 30, hp: 2, cost: 3, group: [1, 1] });
    expect(FOES.drone).toMatchObject({ hp: 1, cost: 1, speed: 110, points: 100, group: [3, 5] });
  });

  it('makes gunships and mines Crimson Nebula\'s: a 3 HP gunship alone, unpulled, and mines of 1 HP in ones and twos, pulled', () => {
    expect(FOES.gunship).toEqual({ from: 3, radius: 18, hp: 3, cost: 4, points: 250, speed: 80, group: [1, 1], pulled: false });
    expect(FOES.mine).toEqual({ from: 3, radius: 12, hp: 1, cost: 2, points: 150, speed: 25, group: [1, 2], pulled: true });
    expect(GUNSHIP).toMatchObject({ orbit: [240, 300], cadence: 2.6, cadenceJitter: 0.4, windup: 0.5, retry: [0.3, 1], maxLive: 4 });
    expect(MINE).toMatchObject({ armRadius: 110, fuse: 0.6, blastRadius: 80 });
  });

  it('schedules Crimson Nebula\'s danger zones as the brief lays out, and Singularity\'s, and no zone anywhere else', () => {
    const zones = (id: GalaxyId): [number, number][] => galaxyById(id).events.filter((e) => e.type === 'dangerZone').map((e) => [e.at, e.intensity]);
    expect(zones('3-1')).toEqual([]);
    expect(zones('3-2')).toEqual([[30, 1]]);
    expect(zones('3-3')).toEqual([[30, 1], [70, 1]]);
    expect(zones('3-4')).toEqual([[20, 1], [50, 2]]);
    expect(zones('3-5')).toEqual([[20, 2], [50, 2]]);
    expect(zones('5-1')).toEqual([]);
    expect(zones('5-2')).toEqual([[30, 1]]);
    expect(zones('5-3')).toEqual([[100, 1]]);
    expect(zones('5-4')).toEqual([[100, 1]]);
    expect(zones('5-5')).toEqual([[60, 1]]);
    for (const g of GALAXIES.filter((x) => x.dimension !== 3 && x.dimension !== 5)) expect(zones(g.id), g.id).toEqual([]);
    // An event shows one zone per intensity, at most two, each 120 to 220 units a side.
    for (const g of GALAXIES) for (const e of g.events) if (e.type === 'dangerZone') expect(e.intensity, g.id).toBeLessThanOrEqual(DANGER_ZONE.maxZones);
    expect(DANGER_ZONE).toMatchObject({ maxZones: 2, side: [120, 220] });
  });

  it('gives each Dimension one palette and one music theme of its own, both named alike', () => {
    const own = { 1: 'drift', 2: 'ionReach', 3: 'crimsonNebula', 4: 'voidRift', 5: 'singularity' } as const;
    for (const g of GALAXIES) {
      expect(g.palette, g.id).toBe(own[g.dimension]);
      expect(g.theme, g.id).toBe(own[g.dimension]);
    }
  });
});

describe('galaxyById', () => {
  it('finds a galaxy by id', () => {
    const g: GalaxyDef = galaxyById('3-4');
    expect(g).toMatchObject({ id: '3-4', dimension: 3, index: 4, kind: 'survival' });
  });

  it('throws, naming the id and the valid range, for one that does not exist', () => {
    expect(() => galaxyById('9-9' as GalaxyId)).toThrow(RangeError);
    expect(() => galaxyById('9-9' as GalaxyId)).toThrow(/9-9.*1-1.*5-6/);
  });
});

describe('galaxy order', () => {
  it('numbers galaxies 0 to 29 and walks to the next, crossing a Dimension after its boss', () => {
    expect(GALAXIES.map((g) => galaxyOrdinal(g.id))).toEqual(Array.from({ length: 30 }, (_, n) => n));
    expect(nextGalaxyId('1-1')).toBe('1-2');
    expect(nextGalaxyId('1-6')).toBe('2-1');
    expect(nextGalaxyId('5-6')).toBeNull();
    expect(GALAXIES.map((g) => nextGalaxyId(g.id))).toEqual([...GALAXIES.slice(1).map((g) => g.id), null]);
  });

  it('furthest picks the later galaxy whichever way round', () => {
    expect(furthest('1-6', '2-1')).toBe('2-1');
    expect(furthest('2-1', '1-6')).toBe('2-1');
    expect(furthest('3-3', '3-3')).toBe('3-3');
  });

  it('refuses ids outside the table', () => {
    expect(() => galaxyOrdinal('6-1' as GalaxyId)).toThrow(RangeError);
  });

  it('isGalaxyId accepts exactly the 30 ids', () => {
    expect(GALAXIES.every((g) => isGalaxyId(g.id))).toBe(true);
    for (const bad of ['6-1', '1-7', '0-1', '1-1 ', '', 11, null, undefined, {}]) expect(isGalaxyId(bad)).toBe(false);
  });
});

describe('tierOf', () => {
  it('counts Dimensions whole and galaxies in fifths', () => {
    expect(tierOf({ dimension: 1, index: 1 })).toBe(0);
    expect(tierOf({ dimension: 1, index: 6 })).toBe(1);
    expect(tierOf({ dimension: 3, index: 3 })).toBeCloseTo(2.4, 10);
    expect(tierOf({ dimension: 5, index: 6 })).toBe(5);
  });
});

describe('galaxyLabel', () => {
  it('writes a star for the sixth galaxy and the id for the rest', () => {
    expect(galaxyLabel('1-1')).toBe('1-1');
    expect(galaxyLabel('4-5')).toBe('4-5');
    expect(galaxyLabel('2-6')).toBe('2-★');
  });
});

describe('DIMENSIONS', () => {
  it('names the five Dimensions', () => {
    expect(DIMENSIONS).toEqual({ 1: 'The Drift', 2: 'Ion Reach', 3: 'Crimson Nebula', 4: 'Void Rift', 5: 'Singularity' });
  });
});

describe('galaxyIdOf', () => {
  it('names a galaxy by its Dimension and index, the same ids the table uses', () => {
    expect(galaxyIdOf(3, 4)).toBe('3-4');
    expect(GALAXIES.every((g) => galaxyIdOf(g.dimension, g.index) === g.id)).toBe(true);
  });
});
