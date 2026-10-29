import { describe, expect, it } from 'vitest';
import { playedGalaxy } from '../../src/app/seed';
import { galaxyById, GALAXIES } from '../../src/content/galaxies';
import { GRAVITY_STORM, HAZARD_RULES, MAX_SHIP_PULL, stormWells as plannedWells, WELL_RADIUS, WELL_SPEED_CAP } from '../../src/content/hazards';
import type { GalaxyEvent, HazardType } from '../../src/content/types';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { clearSpots, cornerClearance, zoneKeepOutBoxes } from '../../src/sim/hazards/dangerZone';
import { ForceField } from '../../src/sim/hazards/forceField';
import { stormLayout } from '../../src/sim/hazards/gravityStorm';
import type { Circle, HazardState, PointHazardState } from '../../src/sim/hazards/hazard';
import { HazardField, hazardStreams } from '../../src/sim/hazards/hazardField';
import { shipPullAt } from '../../src/sim/hazards/shipPull';
import { createRng, deriveSeed, type Rng } from '../../src/sim/rng';
import { createShip, stepShip, type Ship } from '../../src/sim/ship';
import { hasEnded, World } from '../../src/sim/world';
import { hazardFoes } from '../helpers/foeAt';
import { shipAt, turnTowards } from '../helpers/holeEscape';
import { auditTelegraphs, hazardsShownIn, type TelegraphPair } from '../helpers/telegraphAudit';
import type { Timed } from '../helpers/bossArena';

const DT = STEP_SECONDS;
const fieldAt = (aspect: number): Field => ({ width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT });
const FIELD_43 = fieldAt(MIN_ASPECT);
const FIELD_169 = fieldAt(16 / 9);
const FIELD_219 = fieldAt(MAX_ASPECT);
const ASPECTS: readonly Field[] = [FIELD_43, FIELD_169, FIELD_219];
const AT = 20;
const { telegraph: TELEGRAPH, seconds: SECONDS } = HAZARD_RULES.gravityStorm;
const storm = (intensity: GalaxyEvent['intensity'] = 1): GalaxyEvent => ({ at: AT, type: 'gravityStorm', intensity });
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const NO_FOES = hazardFoes();
const name = (field: Field, seed: number): string => `${String(field.width)}×${String(field.height)} seed ${String(seed)}`;

/** Moves the ship through `hazards` one step, with no rocks or foes, as the galaxy does after `stepShip`. */
const moveShip = (hazards: HazardField, ship: Ship): void => {
  hazards.move(DT, ship, [], NO_FOES, []);
};

/** A storm warned in `field`, with the ship at `ship` when it warned: the ship's place then is its keep-out. */
function warned(field: Field, intensity: GalaxyEvent['intensity'], seed: number, ship: Ship = createShip(field.width / 2, field.height / 2)): { hazards: HazardField; out: SimEvent[] } {
  let last = 0;
  const hazards = new HazardField([storm(intensity)], hazardStreams(seed), () => ++last);
  const out: SimEvent[] = [];
  moveShip(hazards, ship);
  hazards.step(AT - TELEGRAPH, field, out);
  return { hazards, out };
}

const wellsOf = (states: readonly HazardState[]): PointHazardState[] => states.filter((s): s is PointHazardState => s.type === 'gravityWell');
const stormWells = (field: Field, intensity: GalaxyEvent['intensity'], seed: number, ship?: Ship): PointHazardState[] => wellsOf(warned(field, intensity, seed, ship).hazards.states);
const spotsOf = (wells: readonly PointHazardState[]): [number, number][] => wells.map((w) => [w.x, w.y]);

/** The gravity wells' places in a field scheduling `events` for `seed`, stepped to `at` with the ship at the centre. */
function placementAt(events: readonly GalaxyEvent[], seed: number, field: Field, at: number, stream = hazardStreams(seed)): [number, number][] {
  let last = 0;
  const hazards = new HazardField(events, stream, () => ++last);
  const ship = createShip(field.width / 2, field.height / 2);
  for (let t = DT; t <= at + DT / 2; t += DT) {
    moveShip(hazards, ship);
    hazards.step(t, field, []);
  }
  return spotsOf(wellsOf(hazards.states));
}

/** A storm stepped alone into its warning, keeping out of `circles` only: no centre, no ship. */
function stormWithin(field: Field, circles: readonly Circle[], intensity: GalaxyEvent['intensity'] = 2, seed = 1): PointHazardState[] {
  let last = 0;
  const setup = { events: [storm(intensity)], rng: createRng(seed), nextId: () => ++last, keepOuts: () => circles, inPlay: () => [] };
  const hazard = new ForceField('gravityStorm', setup, stormLayout(setup));
  hazard.step(AT - TELEGRAPH, field, []);
  return wellsOf(hazard.states);
}

/** Each point's clearance from the nearest HUD or thumb corner box. */
const clearances = (field: Field, points: readonly Readonly<{ x: number; y: number }>[]): number[] => points.map((p) => cornerClearance(field, zoneKeepOutBoxes(field), p.x, p.y));
/** The corner clearance of every spot a storm well may take with `circles` kept out, in grid order. */
const freeClearances = (field: Field, circles: readonly Circle[]): number[] => clearances(field, clearSpots(field, circles, { inset: WELL_RADIUS, reach: 0, corners: 0 }));

describe('a gravity storm\'s placement', () => {
  it('places two wells plus the intensity, at most four, as gravity wells of intensity 1 marked as the storm\'s', () => {
    for (const field of ASPECTS) {
      for (const intensity of [1, 2, 3] as const) {
        for (const seed of SEEDS) {
          const { hazards, out } = warned(field, intensity, seed);
          const wells = wellsOf(hazards.states);
          expect(wells.length, name(field, seed)).toBeGreaterThanOrEqual(2);
          expect(wells.length).toBeLessThanOrEqual(Math.min(GRAVITY_STORM.baseWells + intensity, GRAVITY_STORM.maxWells));
          expect(out.filter((e) => e.type === 'wellWarning').length).toBe(wells.length);
          for (const well of wells) expect(well).toMatchObject({ stage: 'warning', intensity: 1, storm: true });
        }
      }
    }
  }, 20_000);

  it('places more wells at a higher intensity, so the storm\'s size follows its intensity', () => {
    for (const field of ASPECTS) {
      const total = (intensity: GalaxyEvent['intensity']): number => SEEDS.reduce((sum, seed) => sum + stormWells(field, intensity, seed).length, 0);
      expect(total(2), String(field.width)).toBeGreaterThan(total(1));
      expect(total(3), String(field.width)).toBeGreaterThanOrEqual(total(2));
    }
  });

  it('spaces its wells at least its spacing share of the field\'s width apart', () => {
    for (const field of ASPECTS) {
      for (const seed of SEEDS) {
        const wells = stormWells(field, 3, seed);
        for (const [i, a] of wells.entries()) {
          for (const b of wells.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y), name(field, seed)).toBeGreaterThanOrEqual(GRAVITY_STORM.spacing * field.width);
        }
      }
    }
  });

  it('keeps every well clear of the centre, the ship at warning time and the corners, its drawn radius inside the field', () => {
    for (const field of ASPECTS) {
      for (const seed of SEEDS) {
        // The ship off the centre, so its keep-out is not the centre's.
        const ship = createShip(field.width * 0.3, field.height * 0.7);
        const wells = stormWells(field, 3, seed, ship);
        const circles = [
          { x: field.width / 2, y: field.height / 2, r: 150 },
          { x: ship.x, y: ship.y, r: ASTEROID.safeRadius },
        ];
        for (const well of wells) {
          for (const c of circles) expect(Math.hypot(well.x - c.x, well.y - c.y), name(field, seed)).toBeGreaterThanOrEqual(c.r);
          expect(cornerClearance(field, zoneKeepOutBoxes(field), well.x, well.y), name(field, seed)).toBeGreaterThanOrEqual(0);
          expect(well.x).toBeGreaterThanOrEqual(WELL_RADIUS);
          expect(well.x).toBeLessThanOrEqual(field.width - WELL_RADIUS);
          expect(well.y).toBeGreaterThanOrEqual(WELL_RADIUS);
          expect(well.y).toBeLessThanOrEqual(field.height - WELL_RADIUS);
        }
      }
    }
  });

  it('keeps most wells clear of the corners by their drawn radius at 16:9 and 21:9, and few under half of it at any aspect', () => {
    for (const field of ASPECTS) {
      const all = Array.from({ length: 40 }, (_s, k) => clearances(field, stormWells(field, 2, k + 1))).flat();
      const share = (keep: (c: number) => boolean): number => all.filter(keep).length / all.length;
      if (field !== FIELD_43) expect(share((c) => c >= WELL_RADIUS), String(field.width)).toBeGreaterThanOrEqual(0.5);
      expect(share((c) => c < WELL_RADIUS / 2), String(field.width)).toBeLessThanOrEqual(0.1);
    }
  });

  it('places its wells at random at half their drawn radius from the corners where no spot clears the whole radius', () => {
    const field = FIELD_169;
    // A keep-out over all but a band round the edges, whose spots lie within the drawn radius of a corner box.
    const circles: Circle[] = [{ x: field.width / 2, y: field.height / 2, r: 520 }];
    const free = freeClearances(field, circles);
    expect(free.some((c) => c >= WELL_RADIUS)).toBe(false);
    expect(free.filter((c) => c >= WELL_RADIUS / 2).length).toBeGreaterThan(1);
    const firsts = new Set<string>();
    for (const seed of SEEDS) {
      const wells = stormWithin(field, circles, 1, seed);
      expect(wells.length).toBeGreaterThan(0);
      expect(clearances(field, wells).every((c) => c >= WELL_RADIUS / 2), `seed ${String(seed)}`).toBe(true);
      firsts.add(spotsOf(wells.slice(0, 1)).join());
    }
    // Drawn from the rung, not the one clearest spot every time.
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('takes the clearest spot left where none clears half its drawn radius, not the first one found', () => {
    const field = FIELD_169;
    const centre: Circle = { x: field.width / 2, y: field.height / 2, r: 520 };
    // The same band, with every spot clear by half the drawn radius or more kept out as well.
    const near = clearSpots(field, [centre], { inset: WELL_RADIUS, reach: 0, corners: WELL_RADIUS / 2 });
    const circles: Circle[] = [centre, ...near.map((s) => ({ ...s, r: 1 }))];
    const free = freeClearances(field, circles);
    const clearest = Math.max(...free);
    expect(clearest).toBeLessThan(WELL_RADIUS / 2);
    expect(free[0]).toBeLessThan(clearest);
    for (const seed of SEEDS) expect(clearances(field, stormWithin(field, circles, 1, seed))[0]).toBe(clearest);
  });

  it('places the same wells for the same seed, and different ones for another seed', () => {
    const spots = (seed: number): [number, number][] => spotsOf(stormWells(FIELD_169, 2, seed));
    expect(spots(4)).toEqual(spots(4));
    expect(spots(4)).not.toEqual(spots(5));
  });

  it('places a storm the same beside a gravity well as alone, and the well the same beside a storm', () => {
    const seed = 11;
    const well = { at: 60, type: 'gravityWell', intensity: 1 } as const;
    const stormAlone = placementAt([storm(2)], seed, FIELD_169, AT - TELEGRAPH + 1);
    expect(stormAlone.length).toBeGreaterThan(0);
    expect(placementAt([well, storm(2)], seed, FIELD_169, AT - TELEGRAPH + 1)).toEqual(stormAlone);
    const wellAlone = placementAt([well], seed, FIELD_169, 59);
    expect(wellAlone.length).toBeGreaterThan(0);
    expect(placementAt([well, storm(2)], seed, FIELD_169, 59)).toEqual(wellAlone);
  });

  it('draws its places from its own stream, \'hazards:gravityStorm\'', () => {
    const seed = 9;
    const own = createRng(deriveSeed(seed, 'hazards:gravityStorm'));
    let draws = 0;
    const counted: Rng = {
      next: () => (draws++, own.next()),
      range: (min, max) => (draws++, own.range(min, max)),
      int: (min, max) => (draws++, own.int(min, max)),
      chance: (p) => (draws++, own.chance(p)),
      pick: (items) => (draws++, own.pick(items)),
    };
    const refuse = (type: HazardType): Rng => {
      const fail = (): never => {
        throw new Error(`${type} drew from its stream, but only the storm should draw here`);
      };
      return { next: fail, range: fail, int: fail, chance: fail, pick: fail };
    };
    const events = [{ at: 60, type: 'gravityWell', intensity: 1 } as const, storm(2)];
    const placed = placementAt(events, seed, FIELD_169, AT - TELEGRAPH + 1, (type) => (type === 'gravityStorm' ? counted : refuse(type)));
    expect(draws).toBeGreaterThan(0);
    expect(placed).toEqual(spotsOf(stormWells(FIELD_169, 2, seed)));
  });

  it('warns every well of a storm in one step, naming the storm, so the storm sounds once', () => {
    const warnings = warned(FIELD_169, 2, 3).out.filter((e): e is Extract<SimEvent, { type: 'wellWarning' }> => e.type === 'wellWarning');
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    for (const w of warnings) expect(w).toMatchObject({ kind: 'gravityStorm', at: AT });
  });
});

describe('a gravity storm\'s pull', () => {
  it('pulls the ship by every well summed, through shipPullAt and its cap like every hazard, and by nothing else', () => {
    const field = FIELD_169;
    const { hazards } = warned(field, 3, 2);
    hazards.step(AT + 1, field, []);
    const [a] = wellsOf(hazards.states);
    if (a === undefined) throw new Error('the storm placed no well');
    const ship = shipAt(a.x + 40, a.y);
    const expected = shipPullAt(hazards.states, ship.x, ship.y, DT, { x: 0, y: 0 });
    // The other wells pull too: the ship's pull is the sum, not the nearest well's.
    expect(expected).not.toEqual(shipPullAt([a], ship.x, ship.y, DT, { x: 0, y: 0 }));
    expect(Math.hypot(expected.x, expected.y)).toBeGreaterThan(0);
    moveShip(hazards, ship);
    expect(ship.vx).toBeCloseTo(expected.x, 12);
    expect(ship.vy).toBeCloseTo(expected.y, 12);
    for (let i = 0; i <= 40; i++) {
      const pull = shipPullAt(hazards.states, (field.width * i) / 40, field.height * (0.5 + 0.3 * Math.sin(i)), 1, { x: 0, y: 0 });
      expect(Math.hypot(pull.x, pull.y)).toBeLessThanOrEqual(MAX_SHIP_PULL + 1e-9);
    }
  });

  it('pulls rocks toward each of its active wells by that well\'s own pull, no faster than the wells\' cap', () => {
    const field = FIELD_169;
    const { hazards } = warned(field, 1, 5);
    hazards.step(AT + 1, field, []);
    const wells = wellsOf(hazards.states);
    expect(wells.every((w) => w.stage === 'active')).toBe(true);
    for (const well of wells) {
      const rock = { id: 1, x: well.x + 70, y: well.y, px: well.x + 70, py: well.y, vx: -WELL_SPEED_CAP + 1, vy: 0, radius: 15, hp: 1 };
      hazards.move(DT, shipAt(-1e6, -1e6), [rock] as unknown as Parameters<HazardField['move']>[2], NO_FOES, []);
      expect(rock.vx).toBeLessThan(-WELL_SPEED_CAP + 1);
      expect(Math.hypot(rock.vx, rock.vy)).toBeLessThanOrEqual(WELL_SPEED_CAP + 1e-9);
    }
  });

  it('lasts its length, then its wells end together, naming the storm', () => {
    const field = FIELD_169;
    const { hazards } = warned(field, 2, 6);
    hazards.step(AT + SECONDS - 0.5, field, []);
    expect(hazards.states.length).toBeGreaterThan(0);
    const out: SimEvent[] = [];
    hazards.step(AT + SECONDS + 0.1, field, out);
    expect(hazards.states).toEqual([]);
    const ends = out.filter((e) => e.type === 'wellEnd');
    expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(ends.every((e) => e.kind === 'gravityStorm')).toBe(true);
  });
});

const FLIGHT_SECONDS = 5;
const ESCAPE_DISTANCE = 200;
const HEADINGS = Array.from({ length: 16 }, (_h, k) => (k * Math.PI) / 8);
const ESCAPES_NEEDED = 8;
const ESCAPE_SEEDS = [1, 2, 3, 4];

/**
 * One flight from `start`: the ship starts at rest facing away from `heading`, turns to it at its turn speed and holds full
 * thrust, through the real hazard field, which pulls it by the storm (capped) as in play. True if it gets `ESCAPE_DISTANCE`
 * from every well within `FLIGHT_SECONDS`. No other pull acts: a storm is not scheduled over another pulling hazard.
 */
function escapes(hazards: HazardField, field: Field, start: Readonly<{ x: number; y: number }>, heading: number): boolean {
  const ship = shipAt(start.x, start.y, 0, 0, heading + Math.PI);
  const wells = wellsOf(hazards.states);
  for (let step = 0; step * DT < FLIGHT_SECONDS; step++) {
    ship.angle = turnTowards(ship.angle, heading, PLAYER.turnSpeed * DT);
    stepShip(ship, { ...NO_CONTROLS, thrust: true }, DT, field);
    moveShip(hazards, ship);
    if (wells.every((w) => Math.hypot(w.x - ship.x, w.y - ship.y) >= ESCAPE_DISTANCE)) return true;
  }
  return false;
}

/** The starts of the flights: an 8 by 8 grid at ninths of the field, each well's centre, and the saddle midway between each pair. */
function startsOf(field: Field, wells: readonly PointHazardState[]): { x: number; y: number }[] {
  const starts: { x: number; y: number }[] = [];
  for (let i = 1; i <= 8; i++) for (let j = 1; j <= 8; j++) starts.push({ x: (field.width * i) / 9, y: (field.height * j) / 9 });
  for (const [i, a] of wells.entries()) {
    starts.push({ x: a.x, y: a.y });
    for (const b of wells.slice(i + 1)) starts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return starts;
}

/** Two places of the ship as the storm warns: the field's centre, and a point in its lower-left quarter. */
const shipSpots = (field: Field): Ship[] => [createShip(field.width / 2, field.height / 2), createShip(field.width * 0.25, field.height * 0.75)];

describe('a gravity storm\'s escape', () => {
  /**
   * From every start, on eight storms a row (four seeds, the ship in two places as each warns), at least half the 16
   * headings take the ship clear of every well within 5 s, the turn to each flown. Thrust (200) outruns the storm's capped
   * pull (150), so a held heading always gains in its own direction. Intensity 3 places as many wells as 2.
   */
  it.each([
    ['4:3', 1, FIELD_43],
    ['4:3', 2, FIELD_43],
    ['16:9', 1, FIELD_169],
    ['16:9', 2, FIELD_169],
    ['21:9', 1, FIELD_219],
    ['21:9', 2, FIELD_219],
  ] as const)('from every start on a %s field at intensity %i, at least half the headings get clear', (_name, intensity, field) => {
    for (const seed of ESCAPE_SEEDS) {
      for (const ship of shipSpots(field)) {
        const { hazards } = warned(field, intensity, seed, ship);
        hazards.step(AT + 0.5, field, []);
        for (const start of startsOf(field, wellsOf(hazards.states))) {
          let clear = 0;
          for (const heading of HEADINGS) {
            if (escapes(hazards, field, start, heading)) clear++;
            if (clear >= ESCAPES_NEEDED) break;
          }
          expect(clear, `seed ${String(seed)}, ship at ${ship.x.toFixed(0)},${ship.y.toFixed(0)}, from ${start.x.toFixed(0)},${start.y.toFixed(0)}`).toBeGreaterThanOrEqual(ESCAPES_NEEDED);
        }
      }
    }
  }, 120_000);
});

describe('a gravity storm\'s telegraph and scope', () => {
  it('turns every well hostile only after its full telegraph, paired by id with its warning', () => {
    const field = FIELD_169;
    let last = 0;
    const hazards = new HazardField([storm(2)], hazardStreams(7), () => ++last);
    const log: Timed[] = [];
    const ship = createShip(field.width / 2, field.height / 2);
    for (let i = 1; i <= Math.round((AT + SECONDS + 5) / DT); i++) {
      const out: SimEvent[] = [];
      moveShip(hazards, ship);
      hazards.step(i * DT, field, out);
      for (const event of out) log.push({ at: i * DT, event });
    }
    const pairs = auditTelegraphs(log);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (const pair of pairs) {
      expect(pair.kind).toBe('gravityStorm');
      expect(pair.active - pair.warned).toBeCloseTo(TELEGRAPH, 6);
    }
    const ends = log.filter((e) => e.event.type === 'wellEnd');
    expect(ends.length).toBe(pairs.length);
    for (const e of ends) expect(e.at - AT).toBeCloseTo(SECONDS, 1);
  });

  it('pairs every warning with its telegraph in a galaxy run, the storm apart from the well 2-2 already has', () => {
    for (const seed of [1, 2, 3]) {
      const world = new World({ seed, field: FIELD_169, rules: { kind: 'galaxy', galaxy: playedGalaxy(galaxyById('2-2'), 30), mode: 'free' } });
      const log: Timed[] = [];
      for (let t = DT; t <= 120 && !hasEnded(world.status); t += DT) {
        for (const event of world.step(DT, NO_CONTROLS)) log.push({ at: t, event: { ...event } });
      }
      const pairs: TelegraphPair[] = auditTelegraphs(log);
      const storms = pairs.filter((p) => p.kind === 'gravityStorm');
      // Every well the storm placed turned hostile, and on this open field it placed them all.
      expect(storms.length, `seed ${String(seed)}`).toBe(hazardsShownIn(log)({ at: 30, type: 'gravityStorm', intensity: 2 }).length);
      expect(storms.length, `seed ${String(seed)}`).toBe(plannedWells(2));
      // All warned together, by the one storm.
      expect(new Set(storms.map((p) => p.warned)).size, `seed ${String(seed)}`).toBe(1);
      expect(pairs.filter((p) => p.kind === 'gravityWell').length, `seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);

  it('is scheduled by no authored galaxy', () => {
    for (const galaxy of GALAXIES) expect(galaxy.events.filter((e) => e.type === 'gravityStorm'), galaxy.id).toEqual([]);
    expect(galaxyById('2-2').events.length).toBeGreaterThan(0);
  });
});
