import { describe, expect, it } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { AttackId, GalaxyDef, GalaxyId } from '../../src/content/types';
import { bossTarget, BossRunner, MAX_SHOVE_SPEED, MIN_WINDUP_SECONDS, type BossSetup, type BossView } from '../../src/sim/boss/bossRunner';
import { createMonolith, EXPOSED_AT, ORBIT_RADIUS, ORBIT_SPEED, REGROW_CAP, REGROW_SECONDS, SHARD_COUNTS, SHARD_HP, SHARD_RADIUS } from '../../src/sim/boss/monolith';
import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const DEF = BOSSES.monolith;
const MAX_HP = 60;
const INTRO = 2;
const APPROACH = 20;
const ATTACKS = createMonolith(setupFor(1)).attacks;
/** Positions settle to float residue, not exactly. */
const ORBIT_TOLERANCE = 1e-6;

function setupFor(seed: number): BossSetup {
  return { maxHp: MAX_HP, rng: createRng(seed), rockSpeed: 1, field: BOSS_FIELD };
}

function monolith(seed = 1): BossRunner {
  const setup = setupFor(seed);
  return new BossRunner(DEF, createMonolith(setup), setup);
}

const stepper = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};

const liveShards = (boss: Readonly<BossView>): number => boss.parts.filter((p) => p.hp > 0).length;

/** A Monolith whose intro is over. */
function fighting(seed = 1, arena: StubArena = stubArena()): { r: BossRunner; arena: StubArena } {
  const r = monolith(seed);
  runFor(stepper(r), arena, INTRO + 0.05);
  expect(r.state).toBe('fighting');
  return { r, arena };
}

/** Breaks live shards, lowest first, until `left` remain. */
function breakTo(r: BossRunner, left: number): void {
  r.view.parts.forEach((part, i) => {
    while (part.hp > 0 && liveShards(r.view) > left) r.hitPart(i, 1);
  });
}

/** Lays the core bare and knocks it down to `hp`. */
function exposedAt(r: BossRunner, hp: number): void {
  breakTo(r, EXPOSED_AT);
  if (hp < r.hp) expect(r.hit(r.hp - hp)).toBe('hit');
}

/** Distance of each live shard from the core. */
const orbitDistances = (boss: Readonly<BossView>): number[] => boss.parts.filter((p) => p.hp > 0).map((p) => Math.hypot(p.x - boss.x, p.y - boss.y));

describe('the Monolith definition', () => {
  it('is a radius-90, 60 HP core on three phases of shard volleys, quakes and pulses, resting less each phase', () => {
    expect(DEF).toMatchObject({ name: 'Monolith', radius: 90, hp: 60 });
    expect(bossHp(DEF, 1)).toBe(60);
    expect(DEF.phases).toEqual([['shardVolley'], ['shardVolley', 'quake'], ['quake', 'shardVolley', 'pulse']]);
    expect(DEF.rest).toEqual([2.0, 1.5, 1.0]);
    expect(ATTACKS.shardVolley.windup).toBe(0.6);
    expect(ATTACKS.quake.windup).toBe(0.8);
    expect(ATTACKS.pulse.windup).toBe(0.5);
  });

  it('guards 1-★, while the later Dimensions keep the Sentinel for now', () => {
    expect(galaxyById('1-6').boss).toBe('monolith');
    for (const id of ['3-6', '4-6', '5-6'] as const) expect(galaxyById(id).boss).toBe('sentinel');
  });
});

describe('the Monolith\'s shards', () => {
  it('number 8 to 12, drawn from the boss stream, each with 2 HP', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      const { parts } = monolith(seed).view;
      counts.add(parts.length);
      for (const part of parts) expect(part).toMatchObject({ hp: SHARD_HP, maxHp: SHARD_HP });
    }
    expect(SHARD_HP).toBe(2);
    expect(SHARD_COUNTS).toEqual([8, 12]);
    expect([...counts].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12]);
  });

  it('ring the core from the start, and orbit it at 0.6 rad/s', () => {
    const r = monolith();
    for (const d of orbitDistances(r.view)) expect(d).toBeCloseTo(ORBIT_RADIUS, 6);
    const shard = r.view.parts[0];
    const bearing = (): number => Math.atan2((shard?.y ?? 0) - r.view.y, (shard?.x ?? 0) - r.view.x);
    const arena = stubArena();
    runFor(stepper(r), arena, 0.5);
    const before = bearing();
    runFor(stepper(r), arena, 1);
    const turned = bearing() - before;
    expect(ORBIT_SPEED).toBe(0.6);
    expect(turned - Math.round(turned / (2 * Math.PI)) * 2 * Math.PI).toBeCloseTo(0.6, 6);
  });
});

describe('the Monolith\'s core', () => {
  it('deflects every blow while 4 or more shards remain', () => {
    const { r } = fighting();
    for (let left = r.view.parts.length; left >= EXPOSED_AT + 1; left--) {
      breakTo(r, left);
      expect(r.view.vulnerable, `${String(left)} shards`).toBe(false);
      expect(r.hit(1)).toBe('deflected');
    }
    expect(r.hp).toBe(MAX_HP);
  });

  it('is laid bare once 3 or fewer remain, and is hurt by hits, announcing it once', () => {
    const { r, arena } = fighting();
    breakTo(r, 3);
    expect(EXPOSED_AT).toBe(3);
    expect(r.view.vulnerable).toBe(true);
    expect(r.hit(1)).toBe('hit');
    const log = runFor(stepper(r), arena, 0.5);
    expect(timedOfType(log, 'bossExposed')).toHaveLength(1);
    breakTo(r, 0);
    expect(r.hit(1)).toBe('hit');
    expect(r.hp).toBe(MAX_HP - 2);
  });

  it('is aimed at through its shards while they shield it, and at itself once bare', () => {
    const { r } = fighting();
    expect(r.view.parts).toContain(bossTarget(r.view));
    breakTo(r, 3);
    expect(bossTarget(r.view)).toBe(r.view);
  });
});

describe('Monolith regrowth', () => {
  /** Shards alive after each step, for `seconds`. */
  function liveCounts(r: BossRunner, arena: StubArena, seconds: number): number[] {
    const counts: number[] = [];
    runFor(stepper(r), arena, seconds, () => counts.push(liveShards(r.view)));
    return counts;
  }

  it('grows a shard back every 6 s while the core is bare, until it is shielded again', () => {
    const { r, arena } = fighting();
    breakTo(r, 0);
    const log: SimEvent[] = [];
    const counts: number[] = [];
    runFor(stepper(r), arena, 40, () => {
      counts.push(liveShards(r.view));
      log.push(...arena.events);
    });
    const regrownAt = counts.flatMap((n, i) => (i > 0 && n > (counts[i - 1] ?? 0) ? [(i + 1) * STEP_SECONDS] : []));
    expect(REGROW_SECONDS).toBe(6);
    expect(regrownAt.map((t) => Math.round(t))).toEqual([6, 12, 18, 24]);
    expect(counts.at(-1)).toBe(EXPOSED_AT + 1);
    expect(log.filter((e) => e.type === 'bossShielded')).toHaveLength(1);
    expect(r.hit(1)).toBe('deflected');
  });

  it('never grows while the core is shielded', () => {
    const { r, arena } = fighting();
    breakTo(r, 4);
    expect(new Set(liveCounts(r, arena, 30))).toEqual(new Set([4]));
  });

  it('starts the 6 s afresh each time the core is laid bare', () => {
    const { r, arena } = fighting();
    breakTo(r, 3);
    liveCounts(r, arena, 5);
    // Shielded again 5 s into the wait (as if a shard had grown back), then laid bare again.
    const broken = r.view.parts.find((p) => p.hp === 0);
    if (broken === undefined) throw new Error('expected a broken shard');
    broken.hp = SHARD_HP;
    liveCounts(r, arena, 0.1);
    expect(r.view.vulnerable).toBe(false);
    breakTo(r, 3);
    expect(new Set(liveCounts(r, arena, 5.9))).toEqual(new Set([3]));
    expect(liveCounts(r, arena, 0.2).at(-1)).toBe(4);
  });

  it('never holds more than 6 shards it has grown back, however the fight goes', () => {
    expect(REGROW_CAP).toBe(6);
    for (let seed = 1; seed <= 6; seed++) {
      const { r, arena } = fighting(seed);
      const rng = createRng(seed * 31);
      let regrown = 0;
      breakTo(r, 0);
      runFor(stepper(r), arena, 120, () => {
        const before = liveShards(r.view);
        if (rng.chance(0.004)) breakTo(r, rng.int(0, before + 1));
        regrown = Math.max(regrown, liveShards(r.view));
        expect(liveShards(r.view)).toBeLessThanOrEqual(REGROW_CAP);
      });
      expect(regrown).toBeGreaterThan(0);
    }
  });

  it('is always beatable: a ship landing one shot a second where it does harm beats it within 3 minutes', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { r, arena } = fighting(seed);
      let clock = 0;
      runFor(stepper(r), arena, 180, () => {
        clock += STEP_SECONDS;
        const target = bossTarget(r.view);
        if (clock < 1 || target === null) return;
        clock -= 1;
        const part = r.partAt(target.x, target.y, 1);
        if (part >= 0) r.hitPart(part, 1);
        else r.hit(1);
      });
      expect(r.state, `seed ${String(seed)}`).not.toBe('fighting');
    }
  });
});

describe('Monolith attacks', () => {
  it('runs each phase\'s list in order, the same for every seed', () => {
    const order = (seed: number, hp: number): AttackId[] => {
      const { r, arena } = fighting(seed);
      if (hp < MAX_HP) exposedAt(r, hp);
      return timedOfType(runFor(stepper(r), arena, 30), 'bossWindup').map((l) => l.event.attack).slice(0, 6);
    };
    for (const seed of [1, 9]) {
      expect(order(seed, MAX_HP)).toEqual(Array<AttackId>(6).fill('shardVolley'));
      expect(order(seed, 40)).toEqual(['shardVolley', 'quake', 'shardVolley', 'quake', 'shardVolley', 'quake']);
      expect(order(seed, 20)).toEqual(['quake', 'shardVolley', 'pulse', 'quake', 'shardVolley', 'pulse']);
    }
  });

  it('telegraphs every attack for its windup, at least 0.35 s, with no hitbox, rock or shove during it', () => {
    for (const spec of Object.values(ATTACKS)) expect(spec.windup).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    const { r, arena } = fighting();
    exposedAt(r, 20);
    const ship = createShip(BOSS_FIELD.width / 2, 560);
    const seen = new Map<AttackId, number>();
    let rocksAtStart = 0;
    let windupSteps = 0;
    runFor(stepper(r), arena, 30, () => {
      const { windup } = r.view;
      const before = { vx: ship.vx, vy: ship.vy };
      r.shove(ship);
      if (windup === null) {
        if (windupSteps > 0) windupSteps = 0;
        rocksAtStart = arena.asteroids.length;
        return;
      }
      windupSteps++;
      seen.set(windup, Math.max(seen.get(windup) ?? 0, windupSteps * STEP_SECONDS));
      expect(arena.asteroids.length, `${windup}: no rocks`).toBe(rocksAtStart);
      for (const d of orbitDistances(r.view)) expect(Math.abs(d - ORBIT_RADIUS), `${windup}: shards on their orbit`).toBeLessThan(ORBIT_TOLERANCE);
      expect({ vx: ship.vx, vy: ship.vy }, `${windup}: no shove`).toEqual(before);
    });
    for (const id of ['shardVolley', 'quake', 'pulse'] as const) expect(seen.get(id) ?? 0, id).toBeGreaterThanOrEqual(ATTACKS[id].windup - 2 * STEP_SECONDS);
  });

  it('flies three shards at where the ship was as the volley wound up, and brings them back to their orbit', () => {
    const { r, arena } = fighting();
    Object.assign(arena.ship, { x: BOSS_FIELD.width / 2 + 200, y: 600 });
    const aim = { x: arena.ship.x, y: arena.ship.y };
    let closest = Infinity;
    let flying = 0;
    const volley = { started: false, ended: false };
    runFor(stepper(r), arena, 7, () => {
      if (r.view.active === 'shardVolley') volley.started = true;
      if (!volley.started || volley.ended) return;
      if (r.view.active === null) {
        volley.ended = true;
        for (const d of orbitDistances(r.view)) expect(d).toBeCloseTo(ORBIT_RADIUS, 6);
        return;
      }
      // The ship moving off does not move the aim, fixed as the windup began.
      Object.assign(arena.ship, { x: 100, y: 100 });
      const off = r.view.parts.filter((p) => p.hp > 0 && Math.abs(Math.hypot(p.x - r.view.x, p.y - r.view.y) - ORBIT_RADIUS) > 1);
      flying = Math.max(flying, off.length);
      for (const p of off) closest = Math.min(closest, Math.hypot(p.x - aim.x, p.y - aim.y));
    });
    expect(volley).toEqual({ started: true, ended: true });
    expect(flying).toBe(3);
    // Close enough to strike a ship that stayed put.
    expect(closest).toBeLessThan(SHARD_RADIUS + PLAYER.radius);
  });

  it('flies what shards it has left when fewer than three remain', () => {
    const { r, arena } = fighting();
    breakTo(r, 2);
    let flying = 0;
    runFor(stepper(r), arena, 5, () => {
      flying = Math.max(flying, orbitDistances(r.view).filter((d) => Math.abs(d - ORBIT_RADIUS) > 1).length);
    });
    expect(flying).toBe(2);
  });

  it('quakes a ring of small pass-through rocks out of the core', () => {
    const { r, arena } = fighting();
    exposedAt(r, 20);
    let ring: { count: number; core: { x: number; y: number } } | null = null;
    const rocks = arena.asteroids;
    runFor(stepper(r), arena, 4, () => {
      if (ring === null && rocks.length > 0) ring = { count: rocks.length, core: { x: r.view.x, y: r.view.y } };
    });
    expect(ring).not.toBeNull();
    for (const rock of rocks.slice(0, 10)) {
      expect(rock.size).toBe(2);
      expect(rock.transient).toBe(true);
    }
    expect((ring as { count: number } | null)?.count).toBe(10);
  });

  it('pulses the ship away from the core, once, never past the shove cap, and not from across the field', () => {
    const pulseShove = (shipAt: { x: number; y: number }): { vx: number; vy: number; pushes: number } => {
      const { r, arena } = fighting();
      exposedAt(r, 20);
      const { ship } = arena;
      Object.assign(ship, shipAt);
      let pushes = 0;
      runFor(stepper(r), arena, 8, () => {
        const before = { vx: ship.vx, vy: ship.vy };
        r.shove(ship);
        if (ship.vx !== before.vx || ship.vy !== before.vy) pushes++;
        expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(MAX_SHOVE_SPEED + 1e-9);
      });
      return { vx: ship.vx, vy: ship.vy, pushes };
    };
    const below = pulseShove({ x: BOSS_FIELD.width / 2, y: 460 });
    expect(below.pushes).toBe(1);
    expect(below.vy).toBeGreaterThan(0);
    expect(Math.abs(below.vx)).toBeLessThan(below.vy);
    const far = pulseShove({ x: 40, y: BOSS_FIELD.height - 40 });
    expect(far.pushes).toBe(0);
  });
});

describe('Monolith determinism', () => {
  it('replays exactly for a seed, and differs for another', () => {
    const play = (seed: number): unknown => {
      const { r, arena } = fighting(seed);
      const poses: number[] = [];
      const log = runFor(stepper(r), arena, 40, () => {
        if (arena.elapsed() > 12 && liveShards(r.view) > 0 && !r.view.vulnerable) breakTo(r, EXPOSED_AT);
        if (r.view.vulnerable && arena.elapsed() > 14 && arena.elapsed() < 15) r.hit(1);
        for (const p of r.view.parts) poses.push(p.x, p.y, p.hp);
      });
      return { log, poses, rocks: arena.asteroids.map((a) => [a.x, a.y, a.vx, a.vy]) };
    };
    expect(play(4)).toEqual(play(4));
    expect(play(4)).not.toEqual(play(5));
  });
});

describe('the Monolith in 1-★', () => {
  function calm(id: GalaxyId): GalaxyDef {
    return { ...galaxyById(id), kinds: MUTED_KINDS, events: [] };
  }

  it('takes a life off a ship that never moves or fires, in a 120 s fight', () => {
    for (const seed of [1, 2, 3]) {
      const world = new World({ seed, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm('1-6'), mode: 'free' } });
      const hitsAt: string[] = [];
      for (let i = 0; i < Math.round((APPROACH + INTRO + 120) / STEP_SECONDS) && world.status === 'playing'; i++) {
        for (const e of world.step(STEP_SECONDS, NO_CONTROLS)) if (e.type === 'shipHit') hitsAt.push(world.boss?.state ?? 'none');
      }
      expect(world.boss?.id).toBe('monolith');
      expect(world.deaths, `seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
      expect(new Set(hitsAt)).toEqual(new Set(['fighting']));
    }
  });
});
