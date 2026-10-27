import { afterEach, describe, expect, it, vi } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { HAZARD_RULES, MAX_SHIP_PULL, WELL_SPEED_CAP } from '../../src/content/hazards';
import type { GalaxyEvent, HazardType } from '../../src/content/types';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import type { Hazard, HazardFactory, HazardSetup, HazardState } from '../../src/sim/hazards/hazard';
import { HAZARD_FACTORIES, HazardField, hazardStreamName } from '../../src/sim/hazards/hazardField';
import { wellAcceleration } from '../../src/sim/hazards/forceField';
import { nudge } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { createShip, type Ship } from '../../src/sim/ship';
import { World } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const DT = STEP_SECONDS;
const event = (type: GalaxyEvent['type'], at = 20, intensity: GalaxyEvent['intensity'] = 1): GalaxyEvent => ({ at, type, intensity });

/** A hazard that does only what a test gives it: by default it pulls the ship `pull` units/s² along +x. */
function standIn(overrides: Partial<Hazard> & { pull?: Hazard['pull'] } = {}): Hazard {
  return { states: [], step: () => undefined, resize: () => undefined, stop: () => undefined, ...overrides };
}

const pulling = (accel: number): Hazard =>
  standIn({
    pull: (dt, _bodies, shipPull) => {
      shipPull.x += accel * dt;
    },
  });

function field(events: readonly GalaxyEvent[], factories: Partial<Record<HazardType, HazardFactory>>, ship: Ship = createShip(640, 360)): HazardField {
  let last = 0;
  return new HazardField(events, () => createRng(1), () => ++last, ship, factories);
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
    new HazardField([event('gravityWell', 20), event('repulsionField', 40), event('gravityWell', 60), event('meteorShower', 70)], (type) => (asked.push(type), createRng(1)), () => ++last, createShip(0, 0));
    expect(asked).toEqual(['gravityWell', 'repulsionField']);
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

  it('builds force fields from the shared table: wells and repulsion fields', () => {
    expect(Object.keys(HAZARD_FACTORIES).sort()).toEqual(['gravityWell', 'repulsionField']);
  });

  it('says what to do when a scheduled hazard has no factory yet', () => {
    expect(() => field([event('dangerZone')], {})).toThrow(/dangerZone.*HAZARD_FACTORIES/);
  });

  it('lists every hazard\'s states, refilled each step in the same array', () => {
    const a: HazardState = { id: 1, type: 'gravityWell', stage: 'warning', x: 1, y: 2, intensity: 1, remaining: 2 };
    const b: HazardState = { ...a, id: 2, type: 'repulsionField' };
    const hazards = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => standIn({ states: [a] }), repulsionField: () => standIn({ states: [b] }) });
    const list = hazards.states;
    hazards.step(1, FIELD, []);
    expect(hazards.states).toBe(list);
    expect(list).toEqual([a, b]);
    hazards.stop();
    expect(hazards.states).toBe(list);
  });

  it('caps the summed pull on the ship at MAX_SHIP_PULL, applied once with one nudge', () => {
    const ship = createShip(640, 360);
    const hazards = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => pulling(140), repulsionField: () => pulling(140) }, ship);
    hazards.move(DT, ship, [], []);
    expect(ship.vx).toBeCloseTo(MAX_SHIP_PULL * DT, 12);
    expect(ship.vy).toBe(0);
  });

  it('passes a summed pull under the cap through untouched', () => {
    const ship = createShip(640, 360);
    const hazards = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => pulling(60), repulsionField: () => pulling(50) }, ship);
    hazards.move(DT, ship, [], []);
    expect(ship.vx).toBe(60 * DT + 50 * DT);
  });

  it('never speeds the ship past 300 units/s by pulling, and never slows a faster ship', () => {
    const ship = Object.assign(createShip(640, 360), { vx: WELL_SPEED_CAP - 0.1 });
    const hazards = field([event('gravityWell')], { gravityWell: () => pulling(140) }, ship);
    hazards.move(DT, ship, [], []);
    expect(Math.hypot(ship.vx, ship.vy)).toBeCloseTo(WELL_SPEED_CAP, 9);
    ship.vx = 340;
    hazards.move(DT, ship, [], []);
    expect(ship.vx).toBeCloseTo(340, 9);
  });

  it('pulls the ship with one real well exactly as M5 did: one nudge of a x dt toward it', () => {
    const ship = createShip(640, 360);
    const hazards = new HazardField([event('gravityWell', 20, 3)], () => createRng(4), () => 1, ship);
    for (let t = DT; t < 20.5; t += DT) hazards.step(t, FIELD, []);
    const [well] = hazards.states;
    if (well?.stage !== 'active') throw new Error('expected an active well');
    Object.assign(ship, { x: well.x + 90, y: well.y - 40, vx: 12, vy: -7 });
    const m5 = { vx: 12, vy: -7 };
    const dx = well.x - ship.x;
    const dy = well.y - ship.y;
    const distance = Math.hypot(dx, dy);
    const push = (wellAcceleration(distance, 3) * DT) / distance;
    nudge(m5, dx * push, dy * push, WELL_SPEED_CAP);
    hazards.move(DT, ship, [], []);
    expect({ vx: ship.vx, vy: ship.vy }).toEqual(m5);
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
    hazards.move(DT, createShip(0, 0), [], []);
    expect(order).toEqual(['pull', 'carry']);
  });

  it('offers the first respawn point a hazard gives, or none', () => {
    expect(field([event('gravityWell')], { gravityWell: () => standIn() }).respawnPoint()).toBeNull();
    const spot = { x: 640, y: 576 };
    const hazards = field([event('gravityWell'), event('repulsionField')], { gravityWell: () => standIn({ respawnPoint: () => null }), repulsionField: () => standIn({ respawnPoint: () => spot }) });
    expect(hazards.respawnPoint()).toBe(spot);
  });

  it('keeps placed hazards out of the centre, any respawn point and the ship\'s safe radius', () => {
    const ship = createShip(100, 200);
    const spot = { x: 640, y: 576 };
    const hazards = field([event('gravityWell')], { gravityWell: () => standIn({ respawnPoint: () => spot }) }, ship);
    expect(ASTEROID.safeRadius).toBe(150);
    expect(hazards.keepOuts(FIELD)).toEqual([
      { x: 640, y: 360, r: 150 },
      { x: 640, y: 576, r: ASTEROID.safeRadius },
      { x: 100, y: 200, r: ASTEROID.safeRadius },
    ]);
    expect(field([event('gravityWell')], { gravityWell: () => standIn() }, ship).keepOuts(FIELD)).toHaveLength(2);
  });

  it('hands each hazard the keep-outs, read when it places', () => {
    let setup: HazardSetup | null = null;
    const ship = createShip(10, 20);
    field([event('gravityWell')], { gravityWell: (s) => ((setup = s), standIn()) }, ship);
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
    const galaxy = { ...galaxyById('2-1'), kinds: MUTED_KINDS, events: [] };
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
