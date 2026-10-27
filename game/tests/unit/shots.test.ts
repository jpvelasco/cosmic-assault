import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyDef, PickupId, WeaponTier } from '../../src/content/types';
import type { AsteroidSize } from '../../src/sim/asteroid';
import { HOMING, PLAYER, PROJECTILE, STEP_SECONDS, VOLLEY, WINGMAN } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import type { Foe } from '../../src/sim/foes/foe';
import { wingmanShot } from '../../src/sim/pickups/wingman';
import { createShip, type Shot } from '../../src/sim/ship';
import { PlayerShots, type ShotRules, type ShotTargets } from '../../src/sim/shots';
import { World } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const DT = STEP_SECONDS;
const FIRE: Controls = { ...NO_CONTROLS, fire: true };
const PLAIN: ShotRules = { pierce: 0, homingEvery: 0, wingman: false };
const HOMING_RULES: ShotRules = { ...PLAIN, homingEvery: 3 };

/** Nothing to hit or seek, unless a test says so. */
function targets(overrides: Partial<ShotTargets> = {}): ShotTargets {
  return { rocks: [], foes: () => [], aim: () => null, hitBoss: () => false, hitFoe: () => -1, hitRock: () => -1, ...overrides };
}

function shots(): { readonly shots: PlayerShots; readonly events: SimEvent[] } {
  let id = 0;
  const events: SimEvent[] = [];
  return { shots: new PlayerShots(events, () => ++id), events };
}

const shot = (x = 100, y = 100, vx: number = PLAYER.projectileSpeed, vy = 0): Shot => ({ x, y, vx, vy });
const SHIP = createShip(640, 360);

describe('PlayerShots firing', () => {
  it('turns each shot into a projectile with no modifiers and a shot event, as the World did', () => {
    const { shots: s, events } = shots();
    s.fire([shot(1, 2, 3, 4)], SHIP, null);
    expect(s.list).toEqual([{ id: 1, x: 1, y: 2, vx: 3, vy: 4, px: 1, py: 2, life: PROJECTILE.lifespan, pierce: 0, homing: false, struck: [] }]);
    expect(events).toEqual([{ type: 'shot', x: 1, y: 2 }]);
  });

  it('gives every shot the pierces the rules carry', () => {
    const { shots: s } = shots();
    s.fire([shot(), shot()], SHIP, { ...PLAIN, pierce: 3 });
    expect(s.list.map((p) => p.pierce)).toEqual([3, 3]);
  });

  it('homes exactly every third projectile across volleys while Homing runs', () => {
    const { shots: s } = shots();
    for (const size of [2, 1, 4, 2]) s.fire(Array.from({ length: size }, () => shot()), SHIP, HOMING_RULES);
    expect(s.list.map((p) => p.homing)).toEqual([false, false, true, false, false, true, false, false, true]);
  });

  it('restarts the count when Homing ends, even on a step that fires nothing', () => {
    const { shots: s } = shots();
    s.fire([shot(), shot()], SHIP, HOMING_RULES);
    s.fire([], SHIP, PLAIN);
    s.fire([shot(), shot(), shot()], SHIP, HOMING_RULES);
    expect(s.list.map((p) => p.homing)).toEqual([false, false, false, false, true]);
  });

  it('counts the Wingman\'s shot among the three, after the ship\'s volley', () => {
    const { shots: s, events } = shots();
    s.fire([shot(), shot()], SHIP, { ...HOMING_RULES, wingman: true });
    expect(s.list.map((p) => p.homing)).toEqual([false, false, true]);
    expect(events.filter((e) => e.type === 'shot')).toHaveLength(3);
  });

  it('makes the Wingman fire only with a volley', () => {
    const { shots: s } = shots();
    s.fire([], SHIP, { ...PLAIN, wingman: true });
    expect(s.list).toEqual([]);
  });
});

describe('the Wingman', () => {
  it('fires from 34 units off the ship\'s left wing, along its heading, at a ship shot\'s speed', () => {
    const ship = { ...createShip(640, 360), vx: 40, vy: -20 };
    // Facing up (-y), the ship's left is -x.
    expect(wingmanShot(ship)).toEqual({
      x: 640 - WINGMAN.offset,
      y: 360 + Math.cos(ship.angle) * -WINGMAN.offset,
      vx: 40 * PLAYER.inheritVelocity + Math.cos(ship.angle) * PLAYER.projectileSpeed,
      vy: -20 * PLAYER.inheritVelocity + Math.sin(ship.angle) * PLAYER.projectileSpeed,
    });
    expect(WINGMAN.offset).toBe(34);
    const right = wingmanShot({ ...ship, angle: 0, vx: 0, vy: 0 });
    expect(right.x).toBeCloseTo(640, 9);
    expect(right.y).toBeCloseTo(360 - 34, 9);
    expect(Math.hypot(right.vx, right.vy)).toBeCloseTo(PLAYER.projectileSpeed, 9);
  });
});

describe('PlayerShots collisions', () => {
  it('spends a plain shot on the first rock or foe it reaches', () => {
    const { shots: s } = shots();
    s.fire([shot()], SHIP, null);
    s.collide(targets({ hitRock: () => 7 }));
    expect(s.list).toEqual([]);
  });

  it('lets a piercing shot through 3 targets, and spends it on the fourth', () => {
    const { shots: s } = shots();
    s.fire([shot()], SHIP, { ...PLAIN, pierce: VOLLEY.pierceTargets });
    let next = 10;
    const t = targets({ hitRock: () => next++ });
    for (let i = 0; i < 3; i++) {
      s.collide(t);
      expect(s.list, `hit ${String(i + 1)}`).toHaveLength(1);
    }
    expect(s.list[0]?.struck).toEqual([10, 11, 12]);
    s.collide(t);
    expect(s.list).toEqual([]);
    expect(VOLLEY.pierceTargets).toBe(3);
  });

  it('never hands a foe it has struck back to be struck again', () => {
    const { shots: s } = shots();
    s.fire([shot()], SHIP, { ...PLAIN, pierce: 3 });
    const seen: number[][] = [];
    const t = targets({
      hitFoe: (_x, _y, _r, struck) => {
        seen.push([...struck]);
        return [4, 5].find((id) => !struck.includes(id)) ?? -1;
      },
    });
    for (let i = 0; i < 4; i++) s.collide(t);
    expect(seen).toEqual([[], [4], [4, 5], [4, 5]]);
    expect(s.list[0]?.pierce).toBe(1);
  });

  it('stops a piercing shot on the boss, core or part', () => {
    const { shots: s } = shots();
    s.fire([shot()], SHIP, { ...PLAIN, pierce: 3 });
    s.collide(targets({ hitBoss: () => true, hitRock: () => 1 }));
    expect(s.list).toEqual([]);
  });
});

describe('a homing shot', () => {
  /** One homing projectile at (100, 100) heading +x, stepped once toward `at`. */
  function steered(at: { x: number; y: number }, overrides: Partial<ShotTargets> = {}, field: Field = FIELD) {
    const { shots: s } = shots();
    s.fire([shot(), shot(), shot(100, 100)], SHIP, HOMING_RULES);
    const p = s.list[2];
    if (p === undefined) throw new Error('no homing shot');
    s.move(DT, field, targets({ rocks: [{ ...at, radius: 15 }] as never, ...overrides }));
    return { turn: Math.atan2(p.vy, p.vx), speed: Math.hypot(p.vx, p.vy) };
  }

  it('turns toward a rock ahead at up to 4 rad/s, keeping its speed', () => {
    const { turn, speed } = steered({ x: 200, y: 300 });
    expect(turn).toBeCloseTo(HOMING.turnRate * DT, 12);
    expect(speed).toBeCloseTo(PLAYER.projectileSpeed, 9);
    expect(HOMING.turnRate).toBe(4);
  });

  it('turns only as far as the target lies, when that is less than a step\'s turn', () => {
    const { turn } = steered({ x: 400, y: 100.5 });
    expect(turn).toBeGreaterThan(0);
    expect(turn).toBeLessThan(HOMING.turnRate * DT);
  });

  it('ignores a target beyond 320 units, or more than 70° off its heading', () => {
    expect(steered({ x: 100 + 330, y: 100 }).turn).toBe(0);
    expect(steered({ x: 100 + Math.cos(1.3) * 100, y: 100 + Math.sin(1.3) * 100 }).turn).toBe(0);
    expect(steered({ x: 0, y: 100 }).turn).toBe(0);
    expect(HOMING.range).toBe(320);
    expect(HOMING.cone).toBeCloseTo((70 * Math.PI) / 180, 12);
  });

  it('seeks the nearest of the rocks, the live foes and the boss\'s target', () => {
    const below = { x: 250, y: 160 };
    const above = { x: 250, y: 30 };
    const foe = { ...above, hp: 1, radius: 12 } as Foe;
    expect(steered(below, { foes: () => [foe] }).turn).toBeGreaterThan(0);
    expect(steered({ x: 250, y: 300 }, { foes: () => [foe] }).turn).toBeLessThan(0);
    expect(steered({ x: 250, y: 300 }, { foes: () => [{ ...foe, hp: 0 }] }).turn).toBeGreaterThan(0);
    expect(steered({ x: 250, y: 300 }, { aim: () => above }).turn).toBeLessThan(0);
  });

  it('sees across the wrap: a rock just over the right edge is ahead of a shot near it', () => {
    const { shots: s } = shots();
    s.fire([shot(), shot(), shot(1300, 100)], SHIP, HOMING_RULES);
    s.move(DT, FIELD, targets({ rocks: [{ x: -40, y: 140, radius: 15 }] as never }));
    const p = s.list[2];
    expect(Math.atan2(p?.vy ?? 0, p?.vx ?? 1)).toBeGreaterThan(0);
  });

  it('flies straight when it is not homing', () => {
    const { shots: s } = shots();
    s.fire([shot(100, 100)], SHIP, PLAIN);
    s.move(DT, FIELD, targets({ rocks: [{ x: 200, y: 300, radius: 15 }] as never }));
    expect(s.list[0]?.vy).toBe(0);
  });
});

describe('player shots in a galaxy', () => {
  const SHOOTER = { x: 200, y: 360, angle: 0 };
  const still = (x: number, y: number, size: AsteroidSize) => ({ x, y, size, angle: 0, speedMultiplier: 0 });
  const calm = (galaxy: GalaxyDef = galaxyById('5-2')): GalaxyDef => ({ ...galaxy, kinds: MUTED_KINDS, events: [] });

  function world(kinds: readonly PickupId[], opts: { tier?: WeaponTier; rocks?: ReturnType<typeof still>[] } = {}): World {
    const w = new World({ seed: 1, field: FIELD, rules: { kind: 'galaxy', galaxy: calm(), mode: 'rank' }, startTier: opts.tier ?? 0, initialShip: SHOOTER, initialAsteroids: opts.rocks ?? [] });
    for (const kind of kinds) w['run']?.loadout.collect(kind);
    return w;
  }

  /** Fires once, then holds fire, for `seconds`. */
  function fireOnce(w: World, seconds: number): SimEvent[] {
    const log: SimEvent[] = [];
    for (let i = 0; i < Math.round(seconds / DT); i++) log.push(...w.step(DT, i === 0 ? FIRE : NO_CONTROLS));
    return log;
  }

  it('fires 9 projectiles from one trigger at tier 3 with every kind that adds a shot, and 8 from the ship', () => {
    const w = world(['doubleShot', 'spreadLaser', 'wingman', 'piercingBeam', 'homingMissiles', 'rapidFire'], { tier: 3 });
    const events = w.step(DT, FIRE);
    expect(events.filter((e) => e.type === 'shot')).toHaveLength(VOLLEY.maxPerTrigger);
    expect(w.projectiles).toHaveLength(9);
    const fromWingman = w.projectiles.filter((p) => Math.abs(p.y - (360 - WINGMAN.offset)) < 1);
    expect(fromWingman).toHaveLength(1);
  });

  it('breaks three tiny rocks in a row with one piercing shot and stops on the fourth, leaving the fifth', () => {
    const rocks = [300, 360, 420, 480, 540].map((x) => still(x, 360, 3));
    const w = world(['piercingBeam'], { rocks });
    const log = fireOnce(w, 1);
    const broken = log.filter((e) => e.type === 'asteroidDestroyed');
    expect(broken.map((e) => e.x)).toEqual([300, 360, 420, 480]);
    expect(w.asteroids.map((a) => a.x)).toEqual([540]);
  });

  it('strikes each of two overlapping foes once as a piercing shot passes through both', () => {
    const w = world(['piercingBeam']);
    const foes = w['run']?.['foes'];
    if (foes === undefined) throw new Error('no foes');
    for (const x of [400, 412]) {
      const foe = foes.acquire('splitter');
      if (foe === null) throw new Error('foe pool full');
      Object.assign(foe, { x, y: 360, hp: 5 });
      foes.commit(foe);
    }
    const log = fireOnce(w, 0.6);
    const hits = log.filter((e): e is Extract<SimEvent, { type: 'foeHit' }> => e.type === 'foeHit');
    expect(hits.map((e) => e.hp)).toEqual([4, 4]);
    expect(new Set(hits.map((e) => e.id)).size).toBe(2);
  });

  it('gives the Wingman no hitbox: a rock on its spot costs no life and is not struck', () => {
    const w = world(['wingman'], { rocks: [still(200, 360 - WINGMAN.offset, 3)] });
    w['shipState'].invulnerable = false;
    for (let i = 0; i < 10; i++) w.step(DT, NO_CONTROLS);
    expect(w.lives).toBe(PLAYER.startLives);
    expect(w.asteroids).toHaveLength(1);
  });
});
