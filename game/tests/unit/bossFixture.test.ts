import { describe, expect, it } from 'vitest';
import { BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { bossHp, BOSSES } from '../../src/content/bosses';
import type { Dimension, GalaxyId } from '../../src/content/types';
import { createAsteroid, type Asteroid } from '../../src/sim/asteroid';
import { bossHome } from '../../src/sim/boss/bossRules';
import { BossRunner, DYING_SECONDS } from '../../src/sim/boss/bossRunner';
import { PLAYER, PROJECTILE, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { BossView } from '../../src/sim/boss/behaviour';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { createRng } from '../../src/sim/rng';
import type { GalaxyMode } from '../../src/sim/scoring';
import type { Ship } from '../../src/sim/ship';
import { rescale } from '../../src/sim/wrap';
import { World, type WorldOptions } from '../../src/sim/world';
import { BOSS_FIELD, FIXTURE, FIXTURE_DEF, ofType, runFor, stubArena, type StubArena, throughIntro, bossSetup, bossStepper } from '../helpers/bossArena';
import { calmGalaxy } from '../helpers/mute';

const DEF = FIXTURE_DEF;
const STEPS_PER_SECOND = Math.round(1 / STEP_SECONDS);
const APPROACH = 20;
const FIXTURE_HP = 20;

function runnerFor(maxHp = FIXTURE_HP, seed = 5): BossRunner {
  return new BossRunner(DEF, FIXTURE, bossSetup(maxHp, { seed }));
}

/** A fixture that has finished its intro and then lost enough HP to stand at `hp`. */
function fightingAt(hp: number, field: Field = BOSS_FIELD): { r: BossRunner; arena: StubArena } {
  const r = runnerFor(30);
  const arena = stubArena(undefined, field);
  throughIntro(r, arena);
  if (hp < 30) r.hit(30 - hp);
  return { r, arena };
}

describe('the runner\'s fixture definition', () => {
  it('is a radius-70 core on three phases of rings and dashes with shrinking rests', () => {
    expect(DEF.radius).toBe(70);
    expect(DEF.phases).toEqual([['quake'], ['quake', 'dive'], ['dive', 'quake', 'quake']]);
    expect(DEF.rest).toEqual([2.2, 1.6, 1.1]);
    expect(FIXTURE.attacks.quake.windup).toBe(0.6);
    expect(FIXTURE.attacks.dive.windup).toBe(0.5);
    expect(FIXTURE.attacks.dive.active).toBe(0.8);
  });

  it('scales its HP with the Dimension as every boss does', () => {
    const dimensions: readonly Dimension[] = [1, 2, 3, 4, 5];
    expect(dimensions.map((d) => bossHp({ hp: FIXTURE_HP }, d))).toEqual([20, 26, 32, 38, 44]);
  });
});

describe('the fixture\'s ring', () => {
  /** Steps until the next ring lands; returns its rocks and the core as it fired them. */
  function nextRing(r: BossRunner, arena: StubArena): { rocks: Asteroid[]; core: { x: number; y: number } } {
    arena.asteroids.length = 0;
    let ring = { rocks: [] as Asteroid[], core: { x: 0, y: 0 } };
    runFor(bossStepper(r), arena, 12, () => {
      if (ring.rocks.length === 0 && arena.asteroids.length > 0) ring = { rocks: [...arena.asteroids], core: { x: r.view.x, y: r.view.y } };
    });
    return ring;
  }

  it.each([
    [30, 6],
    [20, 8],
    [10, 10],
  ])('at %i of 30 HP fires a ring of %i small pass-through rocks', (hp, count) => {
    const { r, arena } = fightingAt(hp);
    const { rocks } = nextRing(r, arena);
    expect(rocks).toHaveLength(count);
    for (const rock of rocks) {
      expect(rock.size).toBe(2);
      expect(rock.transient).toBe(true);
    }
  });

  it('sends the rocks out evenly in every direction, clear of the core', () => {
    const { r, arena } = fightingAt(20);
    const { rocks, core } = nextRing(r, arena);
    const bearings = rocks.map((a) => Math.atan2(a.vy, a.vx)).sort((a, b) => a - b);
    const gaps = bearings.map((b, i) => (i === 0 ? b + 2 * Math.PI - (bearings.at(-1) ?? 0) : b - (bearings[i - 1] ?? 0)));
    for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / rocks.length, 5);
    for (const rock of rocks) {
      expect(Math.atan2(rock.y - core.y, rock.x - core.x)).toBeCloseTo(Math.atan2(rock.vy, rock.vx), 5);
      expect(Math.hypot(rock.x - core.x, rock.y - core.y)).toBeGreaterThanOrEqual(DEF.radius + rock.radius - 1e-6);
    }
  });

  it('draws its rocks from the boss stream: the ring turns with the seed', () => {
    const ring = (seed: number): number[] => {
      const r = new BossRunner(DEF, FIXTURE, bossSetup(30, { seed }));
      const arena = stubArena();
      throughIntro(r, arena);
      arena.asteroids.length = 0;
      runFor(bossStepper(r), arena, 4);
      return arena.asteroids.map((a) => Math.atan2(a.vy, a.vx));
    };
    expect(ring(1)).toEqual(ring(1));
    expect(ring(1)).not.toEqual(ring(2));
  });
});

describe('the fixture\'s dash', () => {
  /** Phase 3 opens with a dash. Steps to the step its windup begins, with the ship at `at`. */
  function atDashWindup(at: { x: number; y: number }, field: Field = BOSS_FIELD): { r: BossRunner; arena: StubArena } {
    const { r, arena } = fightingAt(10, field);
    Object.assign(arena.ship, at);
    for (let started = false; !started; ) {
      arena.events.length = 0;
      arena.tick();
      r.step(STEP_SECONDS, arena);
      started = arena.events.some((e) => e.type === 'bossWindup' && e.attack === 'dive');
    }
    return { r, arena };
  }

  function diveTo(at: { x: number; y: number }, moveTo: { x: number; y: number } | null) {
    const { r, arena } = atDashWindup(at);
    if (moveTo !== null) Object.assign(arena.ship, moveTo);
    const trail: { x: number; y: number }[] = [];
    runFor(bossStepper(r), arena, 1.5, () => trail.push({ x: r.view.x, y: r.view.y }));
    return trail;
  }

  /** Trail indices: the windup is 60 steps (the last leaves the core where the dash starts), the dash 96 more. */
  const DASH_FROM = Math.round(0.5 / STEP_SECONDS) - 1;
  const DASH_END = Math.round(1.3 / STEP_SECONDS) - 1;

  it('dashes to where the ship was when the windup began, not where it went', () => {
    const trail = diveTo({ x: 1000, y: 500 }, { x: 150, y: 120 });
    const end = trail[DASH_END];
    expect(end?.x).toBeCloseTo(1000, 0);
    expect(end?.y).toBeCloseTo(500, 0);
  });

  it('takes 0.8 s and holds still for the 0.5 s windup it announces', () => {
    const trail = diveTo({ x: 1000, y: 500 }, null);
    const speed = (i: number): number => Math.hypot((trail[i]?.x ?? 0) - (trail[i - 1]?.x ?? 0), (trail[i]?.y ?? 0) - (trail[i - 1]?.y ?? 0)) / STEP_SECONDS;
    expect(speed(DASH_FROM - 10)).toBeLessThan(40);
    expect(speed(DASH_FROM + 20)).toBeGreaterThan(100);
    const [from, mid, to] = [trail[DASH_FROM], trail[DASH_FROM + 48], trail[DASH_END]];
    expect(mid?.x).toBeCloseTo(((from?.x ?? 0) + (to?.x ?? 0)) / 2, 0);
    expect(mid?.y).toBeCloseTo(((from?.y ?? 0) + (to?.y ?? 0)) / 2, 0);
    expect(speed(DASH_END + 20)).toBeLessThan(40);
  });

  it('moves its aim with the field when the field is resized mid-windup', () => {
    const field = { ...BOSS_FIELD };
    const wide = { width: 1680, height: BOSS_FIELD.height };
    const { r, arena } = atDashWindup({ x: 1000, y: 500 }, field);
    r.resize(BOSS_FIELD, wide);
    Object.assign(field, wide);
    runFor(bossStepper(r), arena, 1.3);
    expect(r.view.x).toBeCloseTo(rescale(1000, BOSS_FIELD.width, wide.width), 0);
    expect(r.view.y).toBeCloseTo(500, 0);
  });

  it('keeps the whole core inside the field, however far into a corner the ship was', () => {
    const trail = diveTo({ x: BOSS_FIELD.width - 2, y: BOSS_FIELD.height - 2 }, null);
    const end = trail[DASH_END];
    expect(end?.x).toBeCloseTo(BOSS_FIELD.width - DEF.radius, 0);
    expect(end?.y).toBeCloseTo(BOSS_FIELD.height - DEF.radius, 0);
    for (const p of trail) {
      expect(p.x).toBeLessThanOrEqual(BOSS_FIELD.width - DEF.radius + 0.5);
      expect(p.y).toBeLessThanOrEqual(BOSS_FIELD.height - DEF.radius + 0.5);
    }
  });
});

/** A world with every event it has made so far, and the elapsed time of the step that made each. */
type GalaxyWorld = { world: World; log: SimEvent[]; times: number[] };

const HOME = bossHome(BOSS_FIELD);

function bossWorld(id: GalaxyId, opts: Partial<WorldOptions> = {}, mode: GalaxyMode = 'rank'): GalaxyWorld {
  const world = new World({
    seed: 3,
    field: BOSS_FIELD,
    rules: { kind: 'galaxy', galaxy: calmGalaxy(id), mode },
    startLives: PLAYER.startLives,
    initialShip: { x: BOSS_FIELD.width / 2, y: 640, angle: -Math.PI / 2 },
    ...opts,
  });
  return { world, log: [], times: [] };
}

/** Points the ship at the boss and holds fire. */
function aimAtBoss(world: World): Controls {
  const { boss, ship } = world;
  if (boss === null) return { ...NO_CONTROLS, fire: true };
  let diff = Math.atan2(boss.y - ship.y, boss.x - ship.x) - ship.angle;
  diff -= Math.round(diff / (2 * Math.PI)) * 2 * Math.PI;
  return { ...NO_CONTROLS, fire: true, turn: Math.abs(diff) < 0.02 ? 0 : diff > 0 ? 1 : -1 };
}

function playWorld(g: GalaxyWorld, seconds: number, controls: (w: World) => Controls = () => NO_CONTROLS, onStep?: (events: readonly SimEvent[]) => void): void {
  for (let i = 0; i < seconds * STEPS_PER_SECOND && (g.world.status === 'playing' || g.world.status === 'warping'); i++) {
    const events = g.world.step(STEP_SECONDS, controls(g.world));
    for (const e of events) {
      g.log.push({ ...e });
      g.times.push(g.world.elapsed);
    }
    onStep?.(events);
  }
}

/** How far from its core a boss's body reaches, its core or its furthest live part. */
function bodyReach(boss: Readonly<BossView>): number {
  let reach = boss.radius;
  for (const part of boss.parts) if (part.hp > 0) reach = Math.max(reach, Math.hypot(part.x - boss.x, part.y - boss.y) + part.radius);
  return reach;
}

/**
 * Call it after each step: it returns how many shots vanished since the last call within `near` of the boss' body
 * (shots that ran out of life are far from it), and so were spent on it. `near` is the core's radius if absent.
 */
function shotWatcher(world: World, near: (boss: Readonly<BossView>) => number = (boss) => boss.radius): () => number {
  let before: { id: number; x: number; y: number }[] = [];
  return () => {
    const alive = new Set(world.projectiles.map((p) => p.id));
    const { boss } = world;
    const spent = before.filter((p) => !alive.has(p.id) && boss !== null && Math.hypot(p.x - boss.x, p.y - boss.y) < near(boss) + PROJECTILE.radius + 5);
    before = world.projectiles.map(({ id, x, y }) => ({ id, x, y }));
    return spent.length;
  };
}

/** The Warden's galaxy: its core can always be hurt, so a shot on it lands at every step. */
const CORE_BOSS_GALAXY = '3-6';
/** The HP of 3-★'s Warden, whose core every shot strikes. */
const CORE_BOSS_HP = bossHp(BOSSES.warden, 3);

describe('a boss in its galaxy', () => {
  it('is absent from a survival galaxy and until the approach is over', () => {
    expect(bossWorld('1-5').world.boss).toBeNull();
    const g = bossWorld('1-6');
    playWorld(g, APPROACH - 0.1);
    expect(g.world.boss).toBeNull();
    playWorld(g, 0.2);
    expect(g.world.boss).toMatchObject({ id: 'monolith', state: 'intro', hp: 36, maxHp: 36, phase: 1, radius: 90, windup: null });
    expect(ofType(g.log, 'bossIntro')).toEqual([{ type: 'bossIntro', id: 'monolith' }]);
  });

  it('takes its HP from the Dimension', () => {
    const g = bossWorld(CORE_BOSS_GALAXY);
    playWorld(g, APPROACH + 0.1);
    expect(g.world.boss?.maxHp).toBe(CORE_BOSS_HP);
  });

  it('hands out one view object that it updates in place', () => {
    const g = bossWorld('1-6');
    playWorld(g, APPROACH + 0.1);
    const view = g.world.boss;
    playWorld(g, 6);
    expect(g.world.boss).toBe(view);
    expect(view?.state).toBe('fighting');
  });

  it('spends shots on the boss without hurting it, or reporting a hit, while it is invulnerable', () => {
    const g = bossWorld(CORE_BOSS_GALAXY);
    playWorld(g, APPROACH + 0.5, aimAtBoss);
    const consumedBy = shotWatcher(g.world, bodyReach);
    let consumed = 0;
    playWorld(g, 1.4, aimAtBoss, () => {
      consumed += consumedBy();
    });
    expect(g.world.boss?.state).toBe('intro');
    expect(consumed).toBeGreaterThanOrEqual(3);
    expect(g.world.boss?.hp).toBe(CORE_BOSS_HP);
    expect(ofType(g.log, 'bossHit')).toEqual([]);
  });

  it('takes 1 damage and reports a bossHit for each shot spent on the core', () => {
    const g = bossWorld(CORE_BOSS_GALAXY, { initialShip: { ...HOME, angle: -Math.PI / 2 } });
    playWorld(g, APPROACH + BOSS_INTRO_SECONDS + 0.05);
    const consumedBy = shotWatcher(g.world);
    const boss = g.world.boss;
    let [lost, previous] = [0, boss?.hp ?? 0];
    // The ship sits below the core, invulnerable and facing it, so its shots fly up into the core for a few steps before they strike.
    const belowTheCore = (w: World): Controls => {
      const { boss: b, ship } = w;
      if (b !== null) Object.assign(ship, { x: b.x, y: b.y + 90, angle: -Math.PI / 2, invulnerable: true, invulnerableFor: 100 });
      return { ...NO_CONTROLS, fire: true };
    };
    playWorld(g, 3, belowTheCore, (events) => {
      const hp = boss?.hp ?? 0;
      expect(previous - hp, 'one shot, one damage').toBe(consumedBy());
      // Checked on the step the hit lands, so the core's drift since has no say in it.
      for (const h of events) {
        if (h.type !== 'bossHit') continue;
        expect(Math.hypot(h.x - (boss?.x ?? 0), h.y - (boss?.y ?? 0)), 'a hit lands at the core').toBeLessThan((boss?.radius ?? 0) + PROJECTILE.radius + 5);
      }
      lost += previous - hp;
      previous = hp;
    });
    expect(lost).toBeGreaterThanOrEqual(3);
    const hits = ofType(g.log, 'bossHit');
    // The log also holds any hit from before the window opened.
    expect(hits.map((h) => h.hp)).toEqual(Array.from({ length: CORE_BOSS_HP - (boss?.hp ?? 0) }, (_, i) => CORE_BOSS_HP - 1 - i));
    expect(g.world.score).toBe(0);
  });

  it('counts the core touching the ship as a ship hit, but not during the intro', () => {
    const g = bossWorld(CORE_BOSS_GALAXY, { initialShip: { ...HOME, angle: 0 } });
    playWorld(g, APPROACH + BOSS_INTRO_SECONDS - 0.1);
    expect(g.world.lives).toBe(3);
    playWorld(g, 0.3);
    const hits = ofType(g.log, 'shipHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.livesLeft).toBe(2);
    expect(g.world.ship.invulnerable).toBe(true);
  });

  it('lets an invulnerable ship pass through the core', () => {
    const g = bossWorld(CORE_BOSS_GALAXY, { initialShip: { ...HOME, angle: 0 } });
    const ship: Ship = g.world.ship;
    playWorld(g, APPROACH + BOSS_INTRO_SECONDS - 0.1);
    ship.invulnerable = true;
    ship.invulnerableFor = 100;
    playWorld(g, 0.5);
    expect(ofType(g.log, 'shipHit')).toEqual([]);
  });

  it('keeps every rock its quake makes pass-through, and the fragments a shot breaks them into too', () => {
    let rocks = 0;
    let fragments = 0;
    for (const seed of [1, 2, 3]) {
      const g = bossWorld('5-6', { seed });
      // Shoots the nearest rock, so the quake's rocks break into fragments.
      const atNearestRock = (w: World): Controls => {
        const { ship } = w;
        let target: { readonly x: number; readonly y: number } | null = w.boss;
        let best = Infinity;
        for (const a of w.asteroids) {
          const d = Math.hypot(a.x - ship.x, a.y - ship.y);
          if (d < best) [best, target] = [d, a];
        }
        if (target === null) return NO_CONTROLS;
        const diff = Math.atan2(target.y - ship.y, target.x - ship.x) - ship.angle;
        const wrapped = diff - Math.round(diff / (2 * Math.PI)) * 2 * Math.PI;
        return { ...NO_CONTROLS, fire: true, turn: Math.abs(wrapped) < 0.02 ? 0 : wrapped > 0 ? 1 : -1 };
      };
      playWorld(g, 40, atNearestRock, () => {
        for (const a of g.world.asteroids) {
          expect(a.transient, `size ${String(a.size)} rock`).toBe(true);
          rocks++;
          if (a.size === 3) fragments++;
        }
      });
    }
    expect(rocks).toBeGreaterThan(0);
    expect(fragments).toBeGreaterThan(0);
  });
});

/** The galaxy rules behind a world, for the tests that need to land a blow without aiming a ship. */
function runOf(world: World): GalaxyRun {
  const run = (world as unknown as { run?: GalaxyRun }).run;
  expect(run).toBeDefined();
  return run as GalaxyRun;
}

describe('beating a boss', () => {
  const BOSS_DIMENSION = 3;

  /** A 3-6 game in which the ship dies on the core at the start of the fight, then a chain of 4 kills is built and the boss is beaten. */
  function beaten(mode: GalaxyMode): GalaxyWorld {
    const g = bossWorld(CORE_BOSS_GALAXY, { initialShip: { ...HOME, angle: 0 } }, mode);
    playWorld(g, APPROACH + BOSS_INTRO_SECONDS + 0.1);
    expect(g.world.deaths).toBe(1);
    const run = runOf(g.world);
    for (let i = 0; i < 4; i++) run.scoreKill(0);
    const boss = g.world.boss;
    if (boss === null) throw new Error('the boss should be fighting by now');
    let blows = 0;
    while (boss.state === 'fighting') {
      expect(run.bosses.hitBoss(boss.x, boss.y, 1)).toBe(true);
      blows++;
    }
    expect(blows).toBe(CORE_BOSS_HP);
    return g;
  }

  it('scores 1000 x the Dimension at the combo multiplier of the kill, 5th in the chain here', () => {
    const g = beaten('free');
    expect(g.world.boss).toMatchObject({ state: 'dying', hp: 0 });
    expect(g.world.combo).toBe(5);
    expect(g.world.multiplier).toBe(2);
    expect(g.world.score).toBe(1000 * BOSS_DIMENSION * 2);
  });

  it.each([
    // kill 6000 + clear bonus 750 (250 x 3, no no-death bonus after a death), then x1.2 in Rank: Dimension 3's multiplier
    ['rank', 8100],
    ['free', 6750],
  ] as const)('in %s mode the cleared galaxy reports %i points and 2 stars after a death on the core', (mode, total) => {
    const g = beaten(mode);
    playWorld(g, 6);
    expect(g.world.status).toBe('cleared');
    const [cleared] = ofType(g.log, 'galaxyCleared');
    expect(cleared).toMatchObject({ score: total, bonus: 750, deaths: 1, stars: 2 });
    expect(g.world.score).toBe(total);
  });

  it('ends the galaxy on the next step: bossDown, warpOut and galaxyCleared together, then the boss dies over a 2 s warp', () => {
    const g = beaten('free');
    const killedAt = g.world.elapsed;
    playWorld(g, STEP_SECONDS);
    expect(g.world.status).toBe('warping');
    expect(g.world.boss).toMatchObject({ state: 'dying', hp: 0 });
    const types = g.log.map((e) => e.type);
    for (const type of ['bossDown', 'warpOut', 'galaxyCleared'] as const) expect(g.times[types.indexOf(type)]).toBeCloseTo(killedAt + STEP_SECONDS, 9);
    expect(types.indexOf('bossDown')).toBeLessThan(types.indexOf('warpOut'));
    expect(types.indexOf('warpOut')).toBeLessThan(types.indexOf('galaxyCleared'));
    playWorld(g, DYING_SECONDS - 0.1);
    expect(g.world.status).toBe('warping');
    expect(g.world.boss?.state).toBe('dying');
    playWorld(g, 0.2);
    expect(g.world.status).toBe('cleared');
    expect(g.world.boss).toMatchObject({ state: 'down', hp: 0 });
    const all = g.log.map((e) => e.type);
    for (const type of ['bossDown', 'warpOut', 'galaxyCleared'] as const) expect(all.filter((t) => t === type)).toHaveLength(1);
  });

  it('cannot lose the clear once the killing shot lands: a last-life ship on the dying core, under a rock, stays unhit', () => {
    const g = bossWorld(CORE_BOSS_GALAXY, { startLives: 1 });
    playWorld(g, APPROACH + BOSS_INTRO_SECONDS + 0.1);
    const boss = g.world.boss;
    if (boss === null) throw new Error('the boss should be fighting by now');
    const run = runOf(g.world);
    while (boss.hp > 1) run.bosses.hitBoss(boss.x, boss.y, 1);
    // The last blow is a real shot, so it lands inside a step, as in play.
    let killStep: SimEvent['type'][] = [];
    for (let i = 0; i < 3 * STEPS_PER_SECOND && boss.state === 'fighting'; i++) killStep = g.world.step(STEP_SECONDS, aimAtBoss(g.world)).map((e) => e.type);
    expect(killStep).toEqual(expect.arrayContaining(['bossHit', 'bossDown', 'warpOut', 'galaxyCleared']));
    expect(g.world.status).toBe('warping');
    // Through the boss's dying, the ship sits shield down on the core and under a fresh rock every step.
    const ship: Ship = g.world.ship;
    const rocks = g.world.asteroids as Asteroid[];
    playWorld(g, DYING_SECONDS + 0.5, () => {
      ship.x = boss.x;
      ship.y = boss.y;
      ship.invulnerable = false;
      ship.invulnerableFor = 0;
      rocks.push(createAsteroid(createRng(1), ship.x, ship.y, 0, 0, 1));
      return NO_CONTROLS;
    });
    expect(ofType(g.log, 'shipHit')).toEqual([]);
    expect(ofType(g.log, 'gameOver')).toEqual([]);
    expect(g.world.lives).toBe(1);
    expect(g.world.status).toBe('cleared');
  });

  it('runs the same way twice', () => {
    const [a, b] = [beaten('rank'), beaten('rank')];
    playWorld(a, 6);
    playWorld(b, 6);
    expect(a.log).toEqual(b.log);
    expect(a.times).toEqual(b.times);
  });
});

describe('BossArena.hitBoss', () => {
  /** Runs a 3-6 galaxy on a stub arena for `to` seconds; the arena's events are left empty. */
  function approach(to: number) {
    const arena = stubArena();
    const run = new GalaxyRun(calmGalaxy(CORE_BOSS_GALAXY), 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: () => createRng(5) }, arena);
    for (let i = 0; i < Math.round(to / STEP_SECONDS); i++) {
      arena.events.length = 0;
      arena.tick();
      run.beginStep();
      run.step(STEP_SECONDS);
    }
    arena.events.length = 0;
    return { arena, run };
  }

  it('reports nothing for a shot that misses or arrives before the boss', () => {
    const { run } = approach(19);
    expect(run.bosses.hitBoss(HOME.x, HOME.y, 3)).toBe(false);
    const { arena, run: later } = approach(23);
    expect(later.bosses.hitBoss(0, 0, 3)).toBe(false);
    expect(arena.events).toEqual([]);
  });

  it('spends a shot in the intro without a hit, then reports each damaging hit with the HP it left, the last at 0', () => {
    const intro = approach(21);
    expect(intro.run.bosses.hitBoss(HOME.x, HOME.y, 3)).toBe(true);
    expect(intro.arena.events).toEqual([]);
    expect(intro.run.boss?.hp).toBe(CORE_BOSS_HP);

    const { arena, run } = approach(22.1);
    const hits: number[] = [];
    for (let i = 0; i < CORE_BOSS_HP; i++) {
      arena.events.length = 0;
      expect(run.bosses.hitBoss(HOME.x + 5, HOME.y - 6, 3)).toBe(true);
      expect(arena.events).toEqual([{ type: 'bossHit', x: HOME.x + 5, y: HOME.y - 6, hp: CORE_BOSS_HP - 1 - i }]);
      hits.push(run.boss?.hp ?? -1);
    }
    expect(hits).toEqual(Array.from({ length: CORE_BOSS_HP }, (_, i) => CORE_BOSS_HP - 1 - i));
    expect(run.boss?.state).toBe('dying');
    arena.events.length = 0;
    expect(run.bosses.hitBoss(HOME.x, HOME.y, 3)).toBe(true);
    expect(arena.events).toEqual([]);
  });
});
