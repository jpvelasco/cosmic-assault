import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAZARD_RULES, MAX_SHIP_PULL, WELL_SPEED_CAP } from '../../src/content/hazards';
import type { GalaxyEvent, HazardType } from '../../src/content/types';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { galaxyStreams } from '../../src/sim/galaxy/streams';
import { wellAcceleration } from '../../src/sim/hazards/forceField';
import type { Hazard, HazardFactory, HazardSetup, HazardState, PointHazardState } from '../../src/sim/hazards/hazard';
import { HAZARD_FACTORIES, HazardField, hazardStreamName } from '../../src/sim/hazards/hazardField';
import { shipPullAt } from '../../src/sim/hazards/shipPull';
import { nudge } from '../../src/sim/math';
import { RESPAWN_MARGIN } from '../../src/sim/respawn';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import type { SimEvent } from '../../src/sim/events';
import type { Foe } from '../../src/sim/foes/foe';
import { World } from '../../src/sim/world';
import { foeAt } from '../helpers/foeAt';
import { calmGalaxy } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const DT = STEP_SECONDS;
const event = (type: GalaxyEvent['type'], at = 20, intensity: GalaxyEvent['intensity'] = 1): GalaxyEvent => ({ at, type, intensity });

/** A live drone at (x, y). */

/** A hazard that does only what a test gives it. */
function standIn(overrides: Partial<Hazard> = {}): Hazard {
  return { states: [], step: () => undefined, resize: () => undefined, stop: () => undefined, ...overrides };
}

/** An active hazard state of `type` at (x, y). */
const active = (type: PointHazardState['type'], x: number, y: number, intensity: GalaxyEvent['intensity'] = 1, id = 1): HazardState => ({ id, type, stage: 'active', x, y, intensity, remaining: 5 });

function field(events: readonly GalaxyEvent[], factories: Partial<Record<HazardType, HazardFactory>> = HAZARD_FACTORIES, seed = 1): HazardField {
  let last = 0;
  return new HazardField(events, () => createRng(seed), () => ++last, factories);
}

/** A field whose only hazards hold `states`, stepped once so it lists them. */
function holding(...states: HazardState[]): HazardField {
  const hazards = field([event('gravityWell')], { gravityWell: () => standIn({ states }) });
  hazards.step(1, FIELD, []);
  return hazards;
}

describe('HAZARD_RULES', () => {
  it('holds each hazard\'s telegraph, length and first Dimension', () => {
    expect(HAZARD_RULES).toEqual({
      gravityWell: { telegraph: 2, seconds: 14, from: 2 },
      repulsionField: { telegraph: 2, seconds: 14, from: 4 },
      dangerZone: { telegraph: 2, seconds: 10, from: 3 },
      warpRift: { telegraph: 2, seconds: 16, from: 4 },
      blackHole: { telegraph: 3, seconds: 75, from: 5 },
    });
  });

  it('caps the summed pull on the ship at 150 units/s², at most 0.75 of its thrust', () => {
    expect(MAX_SHIP_PULL).toBe(150);
    expect(MAX_SHIP_PULL).toBeLessThanOrEqual(0.75 * PLAYER.thrust);
  });
});

describe('hazard streams', () => {
  it('keeps the gravity wells on \'hazards\' and gives every other hazard a stream of its own', () => {
    expect(hazardStreamName('gravityWell')).toBe('hazards');
    expect(hazardStreamName('repulsionField')).toBe('hazards:repulsionField');
    expect(hazardStreamName('blackHole')).toBe('hazards:blackHole');
  });

  it('asks for the stream of each type in the schedule, once', () => {
    const asked: HazardType[] = [];
    let last = 0;
    new HazardField([event('gravityWell', 20), event('repulsionField', 40), event('gravityWell', 60), event('meteorShower', 70)], (type) => (asked.push(type), createRng(1)), () => ++last);
    expect(asked).toEqual(['gravityWell', 'repulsionField']);
  });

  it('hands out one stream per type however often it is asked, so no two hazards share a correlated copy', () => {
    const streams = galaxyStreams(7);
    expect(streams.hazards('repulsionField')).toBe(streams.hazards('repulsionField'));
    expect(streams.hazards('gravityWell')).not.toBe(streams.hazards('repulsionField'));
  });
});

describe('shipPullAt', () => {
  it('is one active well\'s pull as the wells first applied it: a x dt toward it, bit for bit', () => {
    const well = active('gravityWell', 600, 300, 3);
    const out = shipPullAt([well], 690, 260, DT, { x: 0, y: 0 });
    const [dx, dy] = [600 - 690, 300 - 260];
    const push = (wellAcceleration(Math.hypot(dx, dy), 3) * DT) / Math.hypot(dx, dy);
    expect(out).toEqual({ x: dx * push, y: dy * push });
  });

  it('caps the sum of stacked fields at MAX_SHIP_PULL, keeping its direction', () => {
    // Two wells 50 units to the right each pull 140: 280 summed, capped to 150.
    const out = shipPullAt([active('gravityWell', 650, 360), active('gravityWell', 650, 360, 1, 2)], 600, 360, DT, { x: 0, y: 0 });
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(MAX_SHIP_PULL * DT, 12);
    expect(out.y).toBe(0);
    expect(out.x).toBeGreaterThan(0);
  });

  it('passes a sum under the cap through untouched, and a repulsion field pushes', () => {
    const states = [active('gravityWell', 1000, 360), active('repulsionField', 300, 360, 1, 2)];
    const out = shipPullAt(states, 600, 360, DT, { x: 0, y: 0 });
    expect(out.x).toBe(400 * ((wellAcceleration(400, 1) * DT) / 400) + -300 * ((-wellAcceleration(300, 1) * DT) / 300));
    expect(out.x).toBeGreaterThan(0);
  });

  it('gives the acceleration for dt 1, capped at MAX_SHIP_PULL itself', () => {
    const states = [active('gravityWell', 650, 360), active('gravityWell', 650, 360, 1, 2)];
    expect(shipPullAt(states, 600, 360, 1, { x: 0, y: 0 }).x).toBeCloseTo(MAX_SHIP_PULL, 12);
    const one = [active('gravityWell', 800, 360)];
    expect(shipPullAt(one, 600, 360, 1, { x: 0, y: 0 }).x * DT).toBeCloseTo(shipPullAt(one, 600, 360, DT, { x: 0, y: 0 }).x, 12);
  });

  it('ignores warnings, hazards that do not pull, and a ship at a field\'s very centre', () => {
    const states: HazardState[] = [{ ...active('gravityWell', 650, 360), stage: 'warning' }, { id: 3, type: 'dangerZone', stage: 'active', x: 650, y: 360, w: 150, h: 150, intensity: 1, remaining: 5 }, active('gravityWell', 600, 360)];
    expect(shipPullAt(states, 600, 360, DT, { x: 3, y: 4 })).toEqual({ x: 0, y: 0 });
  });
});

describe('HazardField', () => {
  it('builds one hazard per type in the schedule, handing it that type\'s events alone', () => {
    const setups: [HazardType, HazardSetup][] = [];
    const make = (type: HazardType): HazardFactory => (setup) => (setups.push([type, setup]), standIn());
    field([event('meteorShower', 5), event('gravityWell', 20), event('repulsionField', 40), event('gravityWell', 60)], { gravityWell: make('gravityWell'), repulsionField: make('repulsionField') });
    expect(setups.map(([type, s]) => [type, s.events.map((e) => e.at)])).toEqual([
      ['gravityWell', [20, 60]],
      ['repulsionField', [40]],
    ]);
  });

  it('builds hazards from the shared table: wells, repulsion fields, danger zones, warp rifts and the black hole', () => {
    expect(Object.keys(HAZARD_FACTORIES).sort()).toEqual(['blackHole', 'dangerZone', 'gravityWell', 'repulsionField', 'warpRift']);
  });

  it('says what to do when a scheduled hazard has no factory yet', () => {
    expect(() => field([event('dangerZone')], {})).toThrow(/dangerZone.*HAZARD_FACTORIES/);
  });

  it('lists every hazard\'s states, refilled each step in the same array', () => {
    const a = active('gravityWell', 1, 2);
    const b = active('repulsionField', 1, 2, 1, 2);
    const hazards = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => standIn({ states: [a] }), repulsionField: () => standIn({ states: [b] }) });
    const list = hazards.states;
    hazards.step(1, FIELD, []);
    expect(hazards.states).toBe(list);
    expect(list).toEqual([a, b]);
    hazards.stop();
    expect(hazards.states).toBe(list);
  });

  it('nudges the ship once by exactly shipPullAt, the function the expert bot predicts with, under two stacked real fields', () => {
    const hazards = field([event('gravityWell', 20, 3), event('repulsionField', 20, 3)]);
    for (let t = DT; t < 20.5; t += DT) hazards.step(t, FIELD, []);
    const [well, repel] = hazards.states;
    if (well === undefined || repel === undefined) throw new Error('expected both fields active');
    const ship = Object.assign(createShip(well.x + 20, well.y + 10), { vx: 12, vy: -7 });
    const expected = { vx: 12, vy: -7 };
    const pull = shipPullAt(hazards.states, ship.x, ship.y, DT, { x: 0, y: 0 });
    nudge(expected, pull.x, pull.y, WELL_SPEED_CAP);
    hazards.move(DT, ship, [], [], []);
    expect({ vx: ship.vx, vy: ship.vy }).toEqual(expected);
  });

  it('caps the stacked pull on the ship at MAX_SHIP_PULL', () => {
    const ship = createShip(600, 360);
    holding(active('gravityWell', 650, 360), active('gravityWell', 650, 360, 1, 2)).move(DT, ship, [], [], []);
    expect(ship.vx).toBeCloseTo(MAX_SHIP_PULL * DT, 12);
    expect(ship.vy).toBe(0);
  });

  it('never speeds the ship past 300 units/s by pulling, and never slows a faster ship', () => {
    const ship = Object.assign(createShip(600, 360), { vx: WELL_SPEED_CAP - 0.1 });
    const hazards = holding(active('gravityWell', 650, 360));
    hazards.move(DT, ship, [], [], []);
    expect(Math.hypot(ship.vx, ship.vy)).toBeCloseTo(WELL_SPEED_CAP, 9);
    ship.vx = 340;
    hazards.move(DT, ship, [], [], []);
    expect(ship.vx).toBeCloseTo(340, 9);
  });

  it('leaves the ship alone when nothing pulls it, not even turning -0 into 0', () => {
    const ship = Object.assign(createShip(600, 360), { vx: -0, vy: 5 });
    holding({ ...active('gravityWell', 650, 360), stage: 'warning' }).move(DT, ship, [], [], []);
    expect(Object.is(ship.vx, -0)).toBe(true);
  });

  it('strikes the ship when any hazard does, and not when none has a lethal touch', () => {
    const lethal = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => standIn(), repulsionField: () => standIn({ strikes: (x) => x < 10 }) });
    expect(lethal.strikes(5, 0, 12)).toBe(true);
    expect(lethal.strikes(50, 0, 12)).toBe(false);
    expect(field([], {}).strikes(5, 0, 12)).toBe(false);
  });

  it('carries bodies after the pull, for teleports and swallowing', () => {
    const order: string[] = [];
    const hazards = field([event('gravityWell')], { gravityWell: () => standIn({ pull: () => order.push('pull'), carry: () => order.push('carry') }) });
    hazards.move(DT, createShip(0, 0), [], [], []);
    expect(order).toEqual(['pull', 'carry']);
  });

  it('offers the first respawn point a hazard gives, or none', () => {
    expect(field([event('gravityWell')], { gravityWell: () => standIn() }).respawnPoint()).toBeNull();
    const spot = { x: 640, y: 576 };
    const hazards = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => standIn({ respawnPoint: () => null }), repulsionField: () => standIn({ respawnPoint: () => spot }) });
    expect(hazards.respawnPoint()).toBe(spot);
  });

  it('keeps placed hazards out of the centre, the spot a respawn takes with nothing in the way by a respawn\'s margin, and the ship\'s safe radius', () => {
    const ship = createShip(100, 200);
    const hazards = field([event('gravityWell')], { gravityWell: () => standIn({ respawnSpot: () => ({ x: 640, y: 576 }), respawnPoint: () => ({ x: 1, y: 1 }) }) });
    hazards.move(DT, ship, [], [], []);
    expect(ASTEROID.safeRadius).toBe(150);
    expect(hazards.keepOuts(FIELD)).toEqual([
      { x: 640, y: 360, r: 150 },
      { x: 640, y: 576, r: RESPAWN_MARGIN },
      { x: 100, y: 200, r: ASTEROID.safeRadius },
    ]);
    const plain = field([event('gravityWell')], { gravityWell: () => standIn() });
    expect(plain.keepOuts(FIELD), 'no ship moved yet').toHaveLength(1);
    plain.move(DT, ship, [], [], []);
    expect(plain.keepOuts(FIELD)).toHaveLength(2);
  });

  it.each([1, 2, 3, 4, 5])('places zones and rifts beside a black hole the same with foes crowding its respawn points as without, on seed %d', (seed) => {
    const events = [event('blackHole', 5, 1), event('warpRift', 12, 1), event('dangerZone', 20, 1), event('dangerZone', 32, 2)];
    /** Every warning of a run in which, once the hole warns, a foe gathers on each respawn point it offers. */
    function warnings(crowded: boolean): SimEvent[] {
      const hazards = field(events, HAZARD_FACTORIES, seed);
      const out: SimEvent[] = [];
      const foes: Foe[] = [];
      const ship = createShip(640, 360);
      for (let t = 0; t <= 34; t += 0.5) {
        hazards.step(t, FIELD, out);
        const spot = crowded ? hazards.respawnPoint() : null;
        if (spot !== null && foes.length < 12) foes.push(foeAt('drone', spot.x, spot.y, { id: foes.length + 1 }));
        hazards.move(DT, ship, [], foes, []);
      }
      return out.filter((e) => e.type === 'riftWarning' || e.type === 'zoneWarning');
    }
    const calm = warnings(false);
    expect(calm.filter((e) => e.type === 'riftWarning')).toHaveLength(1);
    expect(warnings(true)).toEqual(calm);
  });

  it('hands each hazard the keep-outs, read when it places, from the ship it last moved', () => {
    let setup: HazardSetup | null = null;
    const ship = createShip(10, 20);
    field([event('gravityWell')], { gravityWell: (s) => ((setup = s), standIn()) }).move(DT, ship, [], [], []);
    ship.x = 300;
    expect((setup as HazardSetup | null)?.keepOuts(FIELD).at(-1)).toEqual({ x: 300, y: 20, r: ASTEROID.safeRadius });
  });
});

describe('the respawn hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** An idle ship in a galaxy where only a rock at its start pose can hit it. */
  function hitWorld(): World {
    const galaxy = calmGalaxy('2-1');
    return new World({ seed: 2, field: FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' }, initialAsteroids: [{ x: 640, y: 360, size: 0, angle: 0, speedMultiplier: 0 }] });
  }

  /** Steps the idle ship until the rock hits it, once its spawn invulnerability is over. */
  function untilHit(world: World): void {
    for (let i = 0; i < 10 / DT; i++) if (world.step(DT, NO_CONTROLS).some((e) => e.type === 'shipHit')) return;
    throw new Error('the rock at the centre should hit the idle ship within 10 s');
  }

  it('puts the respawned ship at the ruleset\'s point, with its previous pose there too', () => {
    vi.spyOn(GalaxyRun.prototype, 'respawnPoint').mockReturnValue({ x: 200, y: 500 });
    const world = hitWorld();
    untilHit(world);
    expect(world.ship).toMatchObject({ x: 200, y: 500, px: 200, py: 500, vx: 0, vy: 0, invulnerable: true });
  });

  it('leaves the ship at the centre when the ruleset offers no point', () => {
    const world = hitWorld();
    untilHit(world);
    expect(world.ship).toMatchObject({ x: 640, y: 360, px: 640, py: 360, invulnerable: true });
  });
});
