import { describe, expect, it } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { Dimension, GalaxyDef, GalaxyId } from '../../src/content/types';
import type { Asteroid } from '../../src/sim/asteroid';
import { bossHome, BossRunner } from '../../src/sim/boss/bossRunner';
import { SENTINEL } from '../../src/sim/boss/sentinel';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { createRng } from '../../src/sim/rng';
import { comboMultiplier } from '../../src/sim/scoring';
import type { Ship } from '../../src/sim/ship';
import { World, type WorldOptions } from '../../src/sim/world';
import { BOSS_FIELD, ofType, runFor, stubArena, type StubArena } from '../helpers/bossArena';

const DEF = BOSSES.sentinel;
const STEPS_PER_SECOND = Math.round(1 / STEP_SECONDS);
const APPROACH = 20;
const INTRO = 2;
const MUTE = { from: 0, base: 0, step: 0, max: 0 };

function runnerFor(): BossRunner {
  return new BossRunner(DEF, SENTINEL, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
}

const step = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};

/** A 30 HP boss that has finished its intro and then lost enough HP to stand at `hp`. */
function fightingAt(hp: number): { r: BossRunner; arena: StubArena } {
  const r = runnerFor();
  const arena = stubArena();
  runFor(step(r), arena, INTRO + 0.05);
  if (hp < 30) r.hit(30 - hp);
  return { r, arena };
}

describe('the Sentinel definition', () => {
  it('is a radius-70 core on three phases of attacks with shrinking rests', () => {
    expect(DEF.radius).toBe(70);
    expect(DEF.phases).toEqual([['shardRing'], ['shardRing', 'lunge'], ['lunge', 'shardRing', 'shardRing']]);
    expect(DEF.rest).toEqual([2.2, 1.6, 1.1]);
    expect(SENTINEL.attacks.shardRing.windup).toBe(0.6);
    expect(SENTINEL.attacks.lunge.windup).toBe(0.5);
    expect(SENTINEL.attacks.lunge.active).toBe(0.8);
  });

  it('has 20 + 6 x (d - 1) HP in Dimension d', () => {
    const dimensions: readonly Dimension[] = [1, 2, 3, 4, 5];
    expect(dimensions.map((d) => bossHp(DEF, d))).toEqual([20, 26, 32, 38, 44]);
  });
});

describe('the Sentinel shardRing', () => {
  /** Steps until the next ring lands; returns its rocks and the core as it fired them. */
  function nextRing(r: BossRunner, arena: StubArena): { rocks: Asteroid[]; core: { x: number; y: number } } {
    arena.asteroids.length = 0;
    let ring = { rocks: [] as Asteroid[], core: { x: 0, y: 0 } };
    runFor(step(r), arena, 12, () => {
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
      const r = new BossRunner(DEF, SENTINEL, { maxHp: 30, rng: createRng(seed), rockSpeed: 1, field: BOSS_FIELD });
      const arena = stubArena();
      runFor(step(r), arena, INTRO + 0.05);
      arena.asteroids.length = 0;
      runFor(step(r), arena, 4);
      return arena.asteroids.map((a) => Math.atan2(a.vy, a.vx));
    };
    expect(ring(1)).toEqual(ring(1));
    expect(ring(1)).not.toEqual(ring(2));
  });
});

describe('the Sentinel lunge', () => {
  /** Phase 3 opens with a lunge. Steps to the step its windup begins, with the ship at `at`; returns the boss' pose after each later step. */
  function lungeTo(at: { x: number; y: number }, moveTo: { x: number; y: number } | null) {
    const { r, arena } = fightingAt(10);
    arena.ship.x = at.x;
    arena.ship.y = at.y;
    for (let started = false; !started; ) {
      arena.events.length = 0;
      arena.tick();
      r.step(STEP_SECONDS, arena);
      started = arena.events.some((e) => e.type === 'bossWindup' && e.attack === 'lunge');
    }
    if (moveTo !== null) Object.assign(arena.ship, moveTo);
    const trail: { x: number; y: number }[] = [];
    runFor(step(r), arena, 1.5, () => trail.push({ x: r.view.x, y: r.view.y }));
    return trail;
  }

  /** Trail indices: the windup is 60 steps (the last leaves the core where the dash starts), the dash 96 more. */
  const DASH_FROM = Math.round(0.5 / STEP_SECONDS) - 1;
  const DASH_END = Math.round(1.3 / STEP_SECONDS) - 1;

  it('dashes to where the ship was when the windup began, not where it went', () => {
    const trail = lungeTo({ x: 1000, y: 500 }, { x: 150, y: 120 });
    const end = trail[DASH_END];
    expect(end?.x).toBeCloseTo(1000, 0);
    expect(end?.y).toBeCloseTo(500, 0);
  });

  it('takes 0.8 s and holds still for the 0.5 s windup it announces', () => {
    const trail = lungeTo({ x: 1000, y: 500 }, null);
    const speed = (i: number): number => Math.hypot((trail[i]?.x ?? 0) - (trail[i - 1]?.x ?? 0), (trail[i]?.y ?? 0) - (trail[i - 1]?.y ?? 0)) / STEP_SECONDS;
    expect(speed(DASH_FROM - 10)).toBeLessThan(40);
    expect(speed(DASH_FROM + 20)).toBeGreaterThan(100);
    const [from, mid, to] = [trail[DASH_FROM], trail[DASH_FROM + 48], trail[DASH_END]];
    expect(mid?.x).toBeCloseTo(((from?.x ?? 0) + (to?.x ?? 0)) / 2, 0);
    expect(mid?.y).toBeCloseTo(((from?.y ?? 0) + (to?.y ?? 0)) / 2, 0);
    expect(speed(DASH_END + 20)).toBeLessThan(40);
  });

  it('keeps the whole core inside the field, however far into a corner the ship was', () => {
    const trail = lungeTo({ x: BOSS_FIELD.width - 2, y: BOSS_FIELD.height - 2 }, null);
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

function calm(id: GalaxyId): GalaxyDef {
  return { ...galaxyById(id), kinds: { large: MUTE, medium: MUTE, small: MUTE }, events: [] };
}

function bossWorld(id: GalaxyId, opts: Partial<WorldOptions> = {}): GalaxyWorld {
  const world = new World({
    seed: 3,
    field: BOSS_FIELD,
    rules: { kind: 'galaxy', galaxy: calm(id), mode: 'rank' },
    startLives: 5,
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

describe('the Sentinel in a boss galaxy', () => {
  it('is absent from a survival galaxy and until the approach is over', () => {
    expect(bossWorld('1-5').world.boss).toBeNull();
    const g = bossWorld('1-6');
    playWorld(g, APPROACH - 0.1);
    expect(g.world.boss).toBeNull();
    playWorld(g, 0.2);
    expect(g.world.boss).toMatchObject({ state: 'intro', hp: 20, maxHp: 20, phase: 1, radius: 70, windup: null });
    expect(ofType(g.log, 'bossIntro')).toEqual([{ type: 'bossIntro', id: 'sentinel' }]);
  });

  it('takes its HP from the Dimension', () => {
    const g = bossWorld('3-6');
    playWorld(g, APPROACH + 0.1);
    expect(g.world.boss?.maxHp).toBe(32);
  });

  it('hands out one view object that it updates in place', () => {
    const g = bossWorld('1-6');
    playWorld(g, APPROACH + 0.1);
    const view = g.world.boss;
    playWorld(g, 6);
    expect(g.world.boss).toBe(view);
    expect(view?.state).toBe('fighting');
  });

  it('consumes shots on the core and ignores them while it is invulnerable', () => {
    const g = bossWorld('1-6');
    playWorld(g, APPROACH + INTRO - 0.2, aimAtBoss);
    const inIntro = (): boolean => g.world.boss?.state === 'intro';
    expect(inIntro()).toBe(true);
    const intro = g.world.boss;
    let swallowed = 0;
    const core = (p: { x: number; y: number }): boolean => Math.hypot(p.x - (intro?.x ?? 0), p.y - (intro?.y ?? 0)) < (intro?.radius ?? 0);
    playWorld(g, 0.15, aimAtBoss, () => {
      expect(g.world.projectiles.filter(core)).toEqual([]);
      swallowed++;
    });
    expect(swallowed).toBeGreaterThan(0);
    expect(g.world.boss?.hp).toBe(20);
  });

  it('takes 1 damage per shot that reaches the core, and the shot is gone', () => {
    const g = bossWorld('1-6');
    playWorld(g, APPROACH + INTRO + 0.05, aimAtBoss);
    let lost = 0;
    let previous = g.world.boss?.hp ?? 0;
    playWorld(g, 2, aimAtBoss, () => {
      const hp = g.world.boss?.hp ?? 0;
      expect(previous - hp).toBeLessThanOrEqual(1);
      lost += previous - hp;
      previous = hp;
    });
    expect(lost).toBeGreaterThanOrEqual(3);
    expect(g.world.score).toBe(0);
  });

  it('counts the core touching the ship as a ship hit, but not during the intro', () => {
    const g = bossWorld('1-6', { initialShip: { ...HOME, angle: 0 } });
    playWorld(g, APPROACH + INTRO - 0.1);
    expect(g.world.lives).toBe(5);
    playWorld(g, 0.3);
    const hits = ofType(g.log, 'shipHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.livesLeft).toBe(4);
    expect(g.world.ship.invulnerable).toBe(true);
  });

  it('lets an invulnerable ship pass through the core', () => {
    const g = bossWorld('1-6', { initialShip: { ...HOME, angle: 0 } });
    const ship: Ship = g.world.ship;
    playWorld(g, APPROACH + INTRO - 0.1);
    ship.invulnerable = true;
    ship.invulnerableFor = 100;
    playWorld(g, 0.5);
    expect(ofType(g.log, 'shipHit')).toEqual([]);
  });

  it('keeps shard rocks and their fragments pass-through', () => {
    const g = bossWorld('1-6');
    let fragments = 0;
    playWorld(g, 40, aimAtBoss, () => {
      for (const a of g.world.asteroids) {
        expect(a.transient, `size ${String(a.size)} rock`).toBe(true);
        if (a.size === 3) fragments++;
      }
    });
    expect(fragments).toBeGreaterThan(0);
  });
});

describe('beating the Sentinel', () => {
  interface KillStep {
    readonly events: SimEvent[];
    readonly scored: number;
    readonly combo: number;
    readonly at: number;
  }

  /** Plays seed `seed` of 3-6 with the ship shooting at the core until the galaxy clears. */
  function beaten(seed: number): { g: GalaxyWorld; kill: KillStep | null } {
    const g = bossWorld('3-6', { seed });
    let kill: KillStep | null = null;
    let before = 0;
    playWorld(
      g,
      120,
      (w) => {
        before = w.score;
        return aimAtBoss(w);
      },
      (events) => {
        if (kill === null && g.world.boss?.state === 'dying') {
          kill = { events: events.map((e) => ({ ...e })), scored: g.world.score - before, combo: g.world.combo, at: g.world.elapsed };
        }
      },
    );
    return { g, kill };
  }

  it('scores 1000 x the Dimension as a combo kill, then warps out and clears the galaxy', () => {
    const { g, kill } = beaten(3);
    if (kill === null) throw new Error('the Sentinel never reached dying in 120 s');
    const rocks = ofType(kill.events, 'asteroidDestroyed').reduce((sum, e) => sum + e.points, 0);
    expect(kill.scored - rocks).toBe(3000 * comboMultiplier(kill.combo));

    expect(g.world.status).toBe('cleared');
    const types = g.log.map((e) => e.type);
    const [down, warp, cleared] = [types.indexOf('bossDown'), types.indexOf('warpOut'), types.indexOf('galaxyCleared')];
    expect(down).toBeGreaterThan(-1);
    expect(down).toBeLessThan(warp);
    expect(warp).toBeLessThan(cleared);
    expect(types.filter((t) => t === 'galaxyCleared')).toHaveLength(1);
    expect(g.world.boss).toMatchObject({ state: 'down', hp: 0 });
  });

  it('is invulnerable and attack-free for 2 s of dying, then warps for 1.5 s before it clears', () => {
    const { g, kill } = beaten(3);
    const timeOf = (type: SimEvent['type']): number => g.times[g.log.findIndex((e) => e.type === type)] ?? Number.NaN;
    expect(timeOf('bossDown') - (kill?.at ?? 0)).toBeCloseTo(2, 1);
    expect(timeOf('warpOut')).toBe(timeOf('bossDown'));
    expect(timeOf('galaxyCleared') - timeOf('bossDown')).toBeCloseTo(1.5, 1);
  });

  it('announces both phase changes on the way', () => {
    const { g } = beaten(3);
    expect(ofType(g.log, 'bossPhase').map((e) => e.phase)).toEqual([2, 3]);
    expect(ofType(g.log, 'bossWindup').length).toBeGreaterThan(3);
  });

  it('runs the same way twice for one seed', () => {
    const [a, b] = [beaten(3).g, beaten(3).g];
    expect(a.log).toEqual(b.log);
    expect(a.times).toEqual(b.times);
  });
});
