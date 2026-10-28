import { describe, expect, it } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { DRONE_SEPARATION } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import type { AttackId } from '../../src/content/types';
import { BOSS_INTRO_SECONDS, MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import { bossTarget } from '../../src/sim/boss/bossRules';
import type { BossView } from '../../src/sim/boss/behaviour';
import { launchSlot } from '../../src/sim/boss/attacks';
import { CRUISE_SPEED, createHiveCarrier, DRONE_CAP, HANGAR_HALF_ARC, HANGAR_OPEN_SECONDS, HIVE_HOME_SHARE, LAUNCH_WAVES, TURN_RATE } from '../../src/sim/boss/hiveCarrier';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { createAsteroid, type Asteroid } from '../../src/sim/asteroid';
import { FoeField } from '../../src/sim/foes/foeField';
import { projectileFromShot, type Projectile } from '../../src/sim/projectile';
import { turnBetween } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, bossRig, fightingRig, runFor, stubArena, timedOfType, type BossRig, type Stepper, type StubArena, type Timed, bossStepper, bossSetup } from '../helpers/bossArena';
import { calmGalaxy } from '../helpers/mute';

const DEF = BOSSES.hiveCarrier;
/** The rigs' HP: enough to space out the phase thresholds the tests wound it to. */
const MAX_HP = 70;
const APPROACH = 20;
/** The foes stream's seed in these rigs. */
const FOES_SEED = 99;

/** A Hive Carrier on `arena` (by default a stub whose ship sits still at bottom-centre), launching into a foe field of its own. */
const carrier = (seed = 1, arena?: StubArena): BossRig => bossRig(DEF, createHiveCarrier, MAX_HP, { seed, arena, foesSeed: FOES_SEED });

const ATTACKS = createHiveCarrier(bossSetup(MAX_HP)).attacks;

/** Steps the carrier only: its drones are placed but never moved, so none is lost. */

/** A Hive Carrier whose intro is over: no drone is out before it, so the rig's own stepping moves nothing more. */
const fighting = (seed = 1, arena?: StubArena): BossRig => fightingRig(DEF, createHiveCarrier, MAX_HP, { seed, arena, foesSeed: FOES_SEED });

/** Steps until the hangar has just opened; throws if it does not within `seconds`. */
function untilOpen(rig: BossRig, seconds = 10): void {
  for (let i = 0; i < Math.round(seconds / STEP_SECONDS); i++) {
    runFor(bossStepper(rig.r), rig.arena, STEP_SECONDS);
    if (rig.r.view.vulnerable) return;
  }
  throw new Error(`the hangar should open within ${String(seconds)} s`);
}

/** The point on the hull's rim at `offset` radians round from where it faces. */
function rim(rig: BossRig, offset: number): { x: number; y: number } {
  const { x, y, radius, facing } = rig.r.view;
  return { x: x + Math.cos(facing + offset) * radius, y: y + Math.sin(facing + offset) * radius };
}

/** Lands a blow at `at`. */
const hitAt = (rig: BossRig, at: { x: number; y: number }, damage = 1) => rig.r.hit(damage, at.x, at.y);

/** Wounds the carrier through its open hangar down to `hp`. */
function woundTo(rig: BossRig, hp: number): void {
  untilOpen(rig);
  if (hp < rig.r.hp) expect(hitAt(rig, rim(rig, 0), rig.r.hp - hp)).toBe('hit');
}

/** The steps a launch ran on: each `launch` windup's end. */
function launchTimes(log: readonly Timed[]): number[] {
  return timedOfType(log, 'bossWindup')
    .filter((l) => l.event.attack === 'launch')
    .map((l) => l.at + ATTACKS.launch.windup);
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1.5 * STEP_SECONDS;

describe('the Hive Carrier definition', () => {
  it('is a radius-100, 28 HP hull on three phases of launches, broadsides and retreats, resting less each phase', () => {
    expect(DEF).toMatchObject({ name: 'Hive Carrier', radius: 100, hp: 22 });
    expect(DEF.phases).toEqual([['launch', 'broadside'], ['launch', 'retreat', 'broadside'], ['launch', 'broadside', 'launch', 'retreat']]);
    expect(DEF.rest).toEqual([2.5, 2.0, 1.6]);
    expect(ATTACKS.launch.windup).toBe(0.7);
    expect(ATTACKS.broadside.windup).toBe(1.0);
    expect(ATTACKS.retreat.windup).toBe(1.0);
    expect(HANGAR_OPEN_SECONDS).toBe(4);
    expect(DRONE_CAP).toBe(3);
    expect(LAUNCH_WAVES).toEqual({ 1: 1, 2: 2, 3: 2 });
  });

  it('guards 2-★, while 5-★ is the Eclipse\'s', () => {
    expect(galaxyById('2-6').boss).toBe('hiveCarrier');
    expect(bossHp(DEF, 2)).toBe(28);
    expect(galaxyById('5-6').boss).toBe('eclipse');
  });

  it('needs the galaxy\'s foes to launch its drones into, and says so', () => {
    expect(() => createHiveCarrier({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD })).toThrow(/setup\.foes/);
  });
});

describe('the Hive Carrier\'s hangar', () => {
  it('is shut through the intro and the first rest: every blow deflects, and nothing aims at it', () => {
    const rig = carrier();
    runFor(bossStepper(rig.r), rig.arena, BOSS_INTRO_SECONDS + 1);
    expect(rig.r.view.vulnerable).toBe(false);
    expect(bossTarget(rig.r.view)).toBeNull();
    expect(hitAt(rig, rim(rig, 0))).toBe('deflected');
    expect(rig.r.hp).toBe(MAX_HP);
  });

  it('takes a blow through its open hangar, the arc of hull facing the ship, and deflects one anywhere else', () => {
    const rig = fighting();
    untilOpen(rig);
    expect(hitAt(rig, rim(rig, 0))).toBe('hit');
    expect(hitAt(rig, rim(rig, HANGAR_HALF_ARC - 0.02))).toBe('hit');
    expect(hitAt(rig, rim(rig, -(HANGAR_HALF_ARC - 0.02)))).toBe('hit');
    expect(hitAt(rig, rim(rig, HANGAR_HALF_ARC + 0.02))).toBe('deflected');
    expect(hitAt(rig, rim(rig, -(HANGAR_HALF_ARC + 0.02)))).toBe('deflected');
    expect(hitAt(rig, rim(rig, Math.PI))).toBe('deflected');
    expect(hitAt(rig, rim(rig, Math.PI / 2))).toBe('deflected');
    expect(rig.r.hp).toBe(MAX_HP - 3);
  });

  it('aims shots into the open hangar, where a blow counts', () => {
    const rig = fighting();
    untilOpen(rig);
    const target = bossTarget(rig.r.view);
    if (target === null) throw new Error('an open hangar should be aimed at');
    const { x, y, radius, facing } = rig.r.view;
    const offset = turnBetween(facing, Math.atan2(target.y - y, target.x - x));
    expect(Math.abs(offset)).toBeLessThan(1e-9);
    expect(Math.hypot(target.x - x, target.y - y)).toBeLessThan(radius);
    expect(hitAt(rig, target)).toBe('hit');
  });

  it('opens on the step each launch runs and stays open HANGAR_OPEN_SECONDS, then deflects every blow until the next', () => {
    const rig = fighting();
    const log = runFor(bossStepper(rig.r), rig.arena, 12);
    const opened = timedOfType(log, 'hangarOpen').map((l) => l.at);
    const closed = timedOfType(log, 'hangarClose').map((l) => l.at);
    const launches = launchTimes(log).filter((t) => t < 12);
    expect(launches.length).toBeGreaterThanOrEqual(2);
    expect(opened).toHaveLength(launches.length);
    opened.forEach((at, i) => {
      expect(near(at, launches[i] ?? Number.NaN), `opened at ${String(at)}`).toBe(true);
      const shut = closed[i];
      if (shut !== undefined) expect(shut - at).toBeCloseTo(HANGAR_OPEN_SECONDS, 6);
    });
    untilOpen(rig);
    runFor(bossStepper(rig.r), rig.arena, HANGAR_OPEN_SECONDS);
    expect(rig.r.view.vulnerable).toBe(false);
    expect(hitAt(rig, rim(rig, 0))).toBe('deflected');
  });

  it('keeps its hangar open HANGAR_OPEN_SECONDS of its own clock: a fight stepped at half time, as Time Warp does, holds it open twice the real time', () => {
    const rig = fighting();
    const halfTime: Stepper = (dt, arena) => {
      rig.r.step(dt / 2, arena);
    };
    let opened = 0;
    let shutAfter = 0;
    runFor(halfTime, rig.arena, 40, () => {
      if (rig.r.view.vulnerable && opened === 0) opened = rig.arena.elapsed();
      else if (!rig.r.view.vulnerable && opened > 0 && shutAfter === 0) shutAfter = rig.arena.elapsed() - opened;
    });
    expect(opened).toBeGreaterThan(0);
    expect(shutAfter).toBeCloseTo(2 * HANGAR_OPEN_SECONDS, 6);
  });

  it('always opens again after a launch, even one the drone cap leaves empty, and stays open HANGAR_OPEN_SECONDS, so the fight never stalls shut', () => {
    for (const seed of [1, 2, 3, 4]) {
      const rig = fighting(seed);
      // Fill the cap before the first launch: every launch of the fight is then skipped.
      for (let i = 0; i < DRONE_CAP; i++) rig.foes.launch('drone', 100 + 40 * i, 650, 0);
      const open: [number, boolean][] = [];
      const log = runFor(bossStepper(rig.r), rig.arena, 120, () => {
        open.push([rig.arena.elapsed(), rig.r.view.vulnerable]);
        if (rig.r.view.vulnerable && rig.r.hp > 10) hitAt(rig, rim(rig, 0));
      });
      const launches = launchTimes(log).filter((t) => t < 120 - HANGAR_OPEN_SECONDS);
      expect(launches.length, `seed ${String(seed)}`).toBeGreaterThan(10);
      expect(timedOfType(log, 'foeSpawned')).toEqual([]);
      for (const at of launches) {
        const window = open.filter(([t]) => t > at + STEP_SECONDS && t < at + HANGAR_OPEN_SECONDS - STEP_SECONDS);
        expect(window.length).toBeGreaterThan(0);
        expect(window.every(([, isOpen]) => isOpen), `seed ${String(seed)}, launch at ${String(at)}`).toBe(true);
      }
      expect(rig.r.phase).toBe(3);
    }
  });
});

describe('the Hive Carrier\'s drones', () => {
  it('launches its phase\'s wave from the hangar mouth, heading out of it, apart', () => {
    for (const [hp, phase] of [[MAX_HP, 1], [40, 2], [20, 3]] as const) {
      const wave = LAUNCH_WAVES[phase];
      const rig = fighting();
      woundTo(rig, hp);
      rig.foes.clear();
      for (let i = 0; i < Math.round(12 / STEP_SECONDS) && rig.foes.list.length === 0; i++) runFor(bossStepper(rig.r), rig.arena, STEP_SECONDS);
      const drones = rig.foes.list;
      expect(drones, `${String(hp)} HP`).toHaveLength(wave);
      const { x, y, radius, facing } = rig.r.view;
      for (const drone of drones) {
        expect(drone.kind).toBe('drone');
        const out = Math.hypot(drone.x - x, drone.y - y);
        expect(out).toBeGreaterThan(radius);
        expect(out).toBeLessThan(radius + 50);
        expect(Math.abs(turnBetween(facing, Math.atan2(drone.y - y, drone.x - x)))).toBeLessThan(HANGAR_HALF_ARC + 0.3);
        expect(Math.abs(turnBetween(facing, drone.rotation))).toBeLessThan(0.7);
      }
      for (let i = 1; i < drones.length; i++) {
        const [a, b] = [drones[i - 1], drones[i]];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(DRONE_SEPARATION.radius);
      }
    }
  });

  it('never has more than its cap of drones alive, and tops a wave up to the cap', () => {
    const rig = fighting();
    // One short of the cap, under a phase 2 wave of two: the next launch sends out just the one.
    woundTo(rig, 40);
    rig.foes.clear();
    for (let i = 0; i < DRONE_CAP - 1; i++) rig.foes.launch('drone', 100 + 40 * i, 650, 0);
    const log = runFor(bossStepper(rig.r), rig.arena, 120, () => {
      expect(rig.foes.launched).toBeLessThanOrEqual(DRONE_CAP);
    });
    const first = launchTimes(log)[0] ?? Number.NaN;
    expect(LAUNCH_WAVES[2]).toBe(2);
    expect(timedOfType(log, 'foeSpawned').filter((l) => near(l.at, first))).toHaveLength(1);
    expect(rig.foes.launched).toBe(DRONE_CAP);
    expect(timedOfType(log, 'foeSpawned')).toHaveLength(1);
  });

  it('launches again once its drones are shot down', () => {
    const rig = fighting();
    const log = runFor(bossStepper(rig.r), rig.arena, 60, () => {
      if (rig.foes.launched >= DRONE_CAP) rig.foes.clear();
    });
    expect(timedOfType(log, 'foeSpawned').length).toBeGreaterThan(DRONE_CAP);
  });

  it('places them without a draw from the foes stream: it moves after the launch as any drone does', () => {
    const rig = fighting();
    runFor(bossStepper(rig.r), rig.arena, 12);
    expect(rig.foes.launched).toBeGreaterThan(0);
    expect(rig.foes.rng.next()).toBe(createRng(FOES_SEED).next());
  });
});

describe('the Hive Carrier\'s flight', () => {
  it('crosses the top third of the field, never leaving it, in a fight with every attack', () => {
    for (const seed of [1, 2, 3]) {
      const rig = fighting(seed);
      let [left, right] = [Infinity, -Infinity];
      runFor(bossStepper(rig.r), rig.arena, 120, () => {
        const { x, y, radius } = rig.r.view;
        left = Math.min(left, x);
        right = Math.max(right, x);
        expect(y).toBeLessThanOrEqual(BOSS_FIELD.height / 3);
        expect(x).toBeGreaterThanOrEqual(radius - 1e-9);
        expect(x).toBeLessThanOrEqual(BOSS_FIELD.width - radius + 1e-9);
        if (rig.r.view.vulnerable && rig.r.hp > 10) hitAt(rig, rim(rig, 0));
      });
      expect(right - left, `seed ${String(seed)}`).toBeGreaterThan(BOSS_FIELD.width / 2);
    }
  });

  it('turns its hangar toward the ship, no faster than its turn rate', () => {
    const rig = fighting();
    Object.assign(rig.arena.ship, { x: 100, y: 100 });
    let biggest = 0;
    let before = rig.r.view.facing;
    runFor(bossStepper(rig.r), rig.arena, 4, () => {
      biggest = Math.max(biggest, Math.abs(turnBetween(before, rig.r.view.facing)));
      before = rig.r.view.facing;
    });
    expect(biggest).toBeLessThanOrEqual(TURN_RATE * STEP_SECONDS + 1e-12);
    const { x, y, facing } = rig.r.view;
    expect(Math.abs(turnBetween(facing, Math.atan2(100 - y, 100 - x)))).toBeLessThan(0.05);
  });

  it('retreats to the other side of the field, at the same height', () => {
    const rig = fighting();
    woundTo(rig, 40);
    const ends: { from: { x: number; y: number } | null; to: { x: number; y: number } | null } = { from: null, to: null };
    runFor(bossStepper(rig.r), rig.arena, 20, () => {
      const { active, x, y } = rig.r.view;
      if (active === 'retreat') ends.from ??= { x, y };
      else if (ends.from !== null) ends.to ??= { x, y };
    });
    const [a, b] = [ends.from, ends.to];
    if (a === null || b === null) throw new Error('the carrier should retreat in phase 2');
    expect(Math.sign(a.x - BOSS_FIELD.width / 2)).toBe(-Math.sign(b.x - BOSS_FIELD.width / 2));
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(BOSS_FIELD.width / 3);
    expect(b.y).toBe(a.y);
  });

  it('fires a broadside: a line of pass-through rocks across its hangar, flying the way it faces', () => {
    const rig = fighting();
    const log = runFor(bossStepper(rig.r), rig.arena, 8);
    const at = timedOfType(log, 'bossWindup').find((l) => l.event.attack === 'broadside');
    if (at === undefined) throw new Error('a broadside should follow the first launch');
    const rocks = rig.arena.asteroids;
    expect(rocks.length).toBeGreaterThanOrEqual(3);
    const { x, y, facing } = rig.r.view;
    const along = (rock: { x: number; y: number }) => (rock.x - x) * Math.cos(facing) + (rock.y - y) * Math.sin(facing);
    for (const rock of rocks) {
      expect(rock.transient).toBe(true);
      const heading = Math.atan2(rock.vy, rock.vx);
      expect(Math.abs(turnBetween(facing, heading))).toBeLessThan(0.3);
    }
    const ahead = rocks.map(along);
    expect(Math.max(...ahead) - Math.min(...ahead)).toBeLessThan(160);
  });

  it('forms no broadside rock on top of the ship', () => {
    const arena = stubArena();
    const rig = fighting(1, arena);
    runFor(bossStepper(rig.r), rig.arena, 3.5);
    // Park the ship just under the hull, in the broadside's line.
    const { x, y, radius } = rig.r.view;
    Object.assign(arena.ship, { x, y: y + radius + 40 });
    runFor(bossStepper(rig.r), rig.arena, 6);
    for (const rock of arena.asteroids) expect(Math.hypot(rock.px - arena.ship.x, rock.py - arena.ship.y)).toBeGreaterThan(60);
  });
});

describe('the Hive Carrier keeps clear of a fresh ship', () => {
  /** The fields the game can have: 720 high, from the narrowest to the widest aspect. */
  const FIELDS = [MIN_ASPECT, 16 / 9, MAX_ASPECT].map((aspect) => ({ width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT }));

  it('arrives on its own row, centred no lower than 110 on a 720-high field, its hull at least the safe radius from the field\'s centre', () => {
    for (const field of FIELDS) {
      const { view } = carrier(1, stubArena(undefined, field)).r;
      expect(view.y).toBeCloseTo(field.height * HIVE_HOME_SHARE, 9);
      expect(view.y).toBeLessThanOrEqual(110);
      expect(Math.hypot(view.x - field.width / 2, view.y - field.height / 2) - view.radius, `${String(field.width)} wide`).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
    }
  });

  it('keeps that row through a fight, so its hull never comes within the safe radius of the field\'s centre', () => {
    for (const field of FIELDS) {
      const rig = fighting(1, stubArena(undefined, field));
      runFor(bossStepper(rig.r), rig.arena, 60, () => {
        const { x, y, radius } = rig.r.view;
        expect(Math.hypot(x - field.width / 2, y - field.height / 2) - radius).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
        if (rig.r.view.vulnerable && rig.r.hp > 10) hitAt(rig, rim(rig, 0));
      });
    }
  });

  it('launches no drone within the safe radius of the ship, wherever the ship waits, yet sends every wave out in full', () => {
    /** Where the ship waits each step: at the field's centre, or riding along just under the hangar mouth. */
    const waits: readonly ((view: Readonly<BossView>) => { x: number; y: number })[] = [
      () => ({ x: BOSS_FIELD.width / 2, y: BOSS_FIELD.height / 2 }),
      (view) => ({ x: view.x, y: view.y + view.radius + 30 }),
      (view) => ({ x: view.x + 150, y: view.y + view.radius + 60 }),
    ];
    for (const [i, wait] of waits.entries()) {
      const rig = fighting(1);
      const { ship } = rig.arena;
      let alive = 0;
      const log = runFor(bossStepper(rig.r), rig.arena, 40, () => {
        Object.assign(ship, wait(rig.r.view));
        const spawned = rig.arena.events.filter((e) => e.type === 'foeSpawned');
        for (const e of spawned) expect(Math.hypot(e.x - ship.x, e.y - ship.y), `wait ${String(i)}`).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
        // Under the mouth every hangar slot is too near: the wave comes from the hull's ends instead, never short.
        if (rig.arena.events.some((e) => e.type === 'hangarOpen')) expect(spawned.length, `wait ${String(i)}`).toBe(Math.min(LAUNCH_WAVES[rig.r.view.phase], DRONE_CAP - alive));
        alive = rig.foes.launched;
        if (rig.r.view.vulnerable && rig.r.hp > 30) hitAt(rig, rim(rig, 0));
      });
      expect(launchTimes(log).length, `wait ${String(i)}`).toBeGreaterThan(3);
      expect(timedOfType(log, 'foeSpawned').length, `wait ${String(i)}`).toBeGreaterThan(0);
    }
  });

  it('sends the drone of a slot outside the field from a clear slot instead, never off the field', () => {
    const rig = fighting(1);
    const { view } = rig.r;
    // Pinned to the left wall with the ship just under its hangar: the hangar's slots are too near the ship, the hull's
    // left end is off the field, and the wave leaves from its right end.
    const ship = { x: view.radius, y: view.y + view.radius + 50 };
    const slot = { x: 0, y: 0 };
    let offField = 0;
    let alive = 0;
    runFor(bossStepper(rig.r), rig.arena, 40, () => {
      view.x = view.radius;
      Object.assign(rig.arena.ship, ship);
      const spawned = rig.arena.events.filter((e) => e.type === 'foeSpawned');
      for (const e of spawned) expect(e.x >= 0 && e.x <= BOSS_FIELD.width && e.y >= 0 && e.y <= BOSS_FIELD.height, `drone at ${String(e.x)}, ${String(e.y)}`).toBe(true);
      if (rig.arena.events.some((e) => e.type === 'hangarOpen')) {
        const count = Math.min(LAUNCH_WAVES[view.phase], DRONE_CAP - alive);
        // The hangar's slots and the first slot past each wingtip.
        for (let i = 0; i < count + 2; i++) {
          launchSlot(view, i, count, slot);
          if (slot.x < 0) offField++;
        }
        expect(spawned.length).toBe(count);
      }
      alive = rig.foes.launched;
      if (rig.foes.launched >= DRONE_CAP) rig.foes.clear();
    });
    expect(offField, 'the scene should put a slot off the field').toBeGreaterThan(0);
  });

  it('sends a whole wave out past a ship tucked at the hull\'s corner, with the carrier against a wall', () => {
    const rig = fighting(1);
    const { view } = rig.r;
    // Facing down at the left wall: the left wingtip is off the field, and a ship at the hull's lower right corner is
    // within the safe radius of the hangar's slot, the right wingtip and the next few slots out along the hull.
    const pin = (): void => {
      Object.assign(view, { x: view.radius, facing: Math.PI / 2 });
      Object.assign(rig.arena.ship, { x: view.radius + 90, y: view.y + 110 });
    };
    pin();
    let alive = 0;
    let waves = 0;
    runFor(bossStepper(rig.r), rig.arena, 30, () => {
      const spawned = rig.arena.events.filter((e) => e.type === 'foeSpawned');
      for (const e of spawned) expect(Math.hypot(e.x - rig.arena.ship.x, e.y - rig.arena.ship.y)).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
      if (rig.arena.events.some((e) => e.type === 'hangarOpen')) {
        waves++;
        expect(spawned.length).toBe(Math.min(LAUNCH_WAVES[view.phase], DRONE_CAP - alive));
      }
      if (rig.foes.launched >= DRONE_CAP) rig.foes.clear();
      alive = rig.foes.launched;
      pin();
    });
    expect(waves).toBeGreaterThan(1);
  });

  it('forms no drone or broadside rock outside the field, even cruising against a wall', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rig = fighting(seed);
      // Off to one side and low, so the hangar turns toward the wall the carrier is cruising along.
      Object.assign(rig.arena.ship, { x: 20, y: 300 });
      const log = runFor(bossStepper(rig.r), rig.arena, 90, () => {
        if (rig.foes.launched >= DRONE_CAP) rig.foes.clear();
      });
      const inField = (p: { x: number; y: number }) => p.x >= 0 && p.x <= BOSS_FIELD.width && p.y >= 0 && p.y <= BOSS_FIELD.height;
      for (const l of timedOfType(log, 'foeSpawned')) expect(inField(l.event), `seed ${String(seed)} drone at ${String(l.event.x)}`).toBe(true);
      for (const rock of rig.arena.asteroids) expect(inField({ x: rock.px, y: rock.py }), `seed ${String(seed)} rock`).toBe(true);
      expect(timedOfType(log, 'foeSpawned').length).toBeGreaterThan(0);
    }
  });
});

describe('the Hive Carrier\'s telegraphs', () => {
  it('winds every attack up for at least 0.35 s, launching, firing and retreating nothing meanwhile', () => {
    for (const spec of Object.values(ATTACKS)) expect(spec.windup).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    const rig = fighting();
    woundTo(rig, 20);
    const seen = new Map<AttackId, number>();
    let steps = 0;
    let rocks = 0;
    let lastX = rig.r.view.x;
    runFor(bossStepper(rig.r), rig.arena, 40, () => {
      const { windup, active, x, radius } = rig.r.view;
      const moved = Math.abs(x - lastX);
      lastX = x;
      const atWall = x === radius || x === BOSS_FIELD.width - radius;
      if (windup === null) {
        steps = 0;
        rocks = rig.arena.asteroids.length;
        return;
      }
      steps++;
      seen.set(windup, Math.max(seen.get(windup) ?? 0, steps * STEP_SECONDS));
      expect(rig.arena.asteroids.length, `${windup}: no rocks`).toBe(rocks);
      expect(rig.arena.events.filter((e) => e.type === 'foeSpawned' || e.type === 'hangarOpen'), `${windup}: no drones`).toEqual([]);
      // Only its cruise moves it: one cruise step exactly, or less as it meets a wall.
      expect(active, `${windup}: nothing active`).toBeNull();
      if (!atWall) expect(Math.abs(moved - CRUISE_SPEED * STEP_SECONDS), `${windup}: no retreat`).toBeLessThan(1e-9);
    });
    for (const id of ['launch', 'broadside', 'retreat'] as const) expect(seen.get(id) ?? 0, id).toBeGreaterThanOrEqual(ATTACKS[id].windup - 2 * STEP_SECONDS);
  });

  it('runs each phase\'s attacks in the same order whatever the seed', () => {
    const order = (seed: number, hp: number): AttackId[] => {
      const rig = fighting(seed);
      woundTo(rig, hp);
      return timedOfType(runFor(bossStepper(rig.r), rig.arena, 40), 'bossWindup').map((l) => l.event.attack).slice(0, 4);
    };
    for (const seed of [1, 9]) {
      expect(order(seed, 40)).toEqual(['launch', 'retreat', 'broadside', 'launch']);
      expect(order(seed, 20)).toEqual(['launch', 'broadside', 'launch', 'retreat']);
    }
  });
});

describe('the Hive Carrier replays', () => {
  function record(seed: number): { log: SimEvent[]; poses: number[]; rocks: number[]; drones: number[] } {
    const rig = fighting(seed);
    const log: SimEvent[] = [];
    const poses: number[] = [];
    runFor(bossStepper(rig.r), rig.arena, 40, () => {
      log.push(...rig.arena.events);
      poses.push(rig.r.view.x, rig.r.view.y, rig.r.view.facing);
      rig.foes.step(STEP_SECONDS);
      if (rig.r.view.vulnerable && rig.r.hp > 10) hitAt(rig, rim(rig, 0));
    });
    return {
      log,
      poses,
      rocks: rig.arena.asteroids.flatMap((a) => [a.x, a.y, a.vx, a.vy]),
      drones: rig.foes.list.flatMap((f) => [f.x, f.y, f.rotation]),
    };
  }

  it('fights the same way for the same seed, and another way for another', () => {
    const a = record(5);
    expect(record(5)).toEqual(a);
    expect(a.rocks.length).toBeGreaterThan(0);
    expect(a.drones.length).toBeGreaterThan(0);
    expect(record(6).rocks).not.toEqual(a.rocks);
  });
});

describe('the Hive Carrier in 2-★', () => {
  it('spends a shot that strikes its hull with a spark, leaving the drone and the rock behind it whole', () => {
    const world = new World({ seed: 1, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calmGalaxy('2-6'), mode: 'free' } });
    for (let i = 0; i < Math.round((APPROACH + BOSS_INTRO_SECONDS + 0.5) / STEP_SECONDS); i++) world.step(STEP_SECONDS, NO_CONTROLS);
    const boss = world.boss;
    if (boss?.state !== 'fighting') throw new Error('the Hive Carrier should be fighting 22.5 s into 2-6');
    // The stern, which never takes a hit, just outside the hull.
    const at = { x: boss.x - Math.cos(boss.facing) * (boss.radius + 2), y: boss.y - Math.sin(boss.facing) * (boss.radius + 2) };
    const run = (world as unknown as { run: { foes: FoeField } }).run;
    expect(run.foes.launch('drone', at.x, at.y, 0)).toBe(true);
    const rock = createAsteroid(createRng(1), at.x, at.y, 3, 0, 0);
    (world.asteroids as Asteroid[]).push(rock);
    (world.projectiles as Projectile[]).push(projectileFromShot({ x: at.x, y: at.y, vx: 0, vy: 0 }, 9000));
    const events = world.step(STEP_SECONDS, NO_CONTROLS);
    expect(events.filter((e) => e.type === 'bossDeflected')).toEqual([{ type: 'bossDeflected', x: at.x, y: at.y }]);
    expect(events.filter((e) => e.type === 'bossHit' || e.type === 'foeHit' || e.type === 'foeDestroyed' || e.type === 'asteroidDestroyed')).toEqual([]);
    expect(world.projectiles.filter((p) => p.id === 9000)).toEqual([]);
    expect(world.asteroids).toContain(rock);
    expect(world.foes).toHaveLength(1);
    expect(boss.hp).toBe(bossHp(DEF, 2));
  });

  it('takes a life off a ship that never moves or fires, in a 120 s fight, by what it sends out and not on arrival', () => {
    for (const seed of [1, 2, 3]) {
      const world = new World({ seed, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calmGalaxy('2-6'), mode: 'free' } });
      const hitsAt: string[] = [];
      let firstLaunch = Number.NaN;
      let firstHit = Number.NaN;
      for (let i = 0; i < Math.round((APPROACH + BOSS_INTRO_SECONDS + 120) / STEP_SECONDS) && world.status === 'playing'; i++) {
        for (const e of world.step(STEP_SECONDS, NO_CONTROLS)) {
          if (e.type === 'hangarOpen' && Number.isNaN(firstLaunch)) firstLaunch = world.elapsed;
          if (e.type !== 'shipHit') continue;
          hitsAt.push(world.boss?.state ?? 'none');
          if (Number.isNaN(firstHit)) firstHit = world.elapsed;
        }
      }
      expect(world.boss?.id).toBe('hiveCarrier');
      expect(world.deaths, `seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
      expect(new Set(hitsAt)).toEqual(new Set(['fighting']));
      // Its drones and rocks have to cross the field to the ship: nothing spawns on it, so a second passes first.
      expect(firstHit - firstLaunch, `seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
    }
  });
});
