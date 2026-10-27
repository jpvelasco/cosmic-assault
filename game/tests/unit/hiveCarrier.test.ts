import { describe, expect, it } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { DRONE_SEPARATION } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import type { AttackId, GalaxyDef, GalaxyId } from '../../src/content/types';
import { bossTarget, BossRunner, MIN_WINDUP_SECONDS, type BossSetup } from '../../src/sim/boss/bossRunner';
import { createHiveCarrier, DRONE_CAP, HANGAR_HALF_ARC, HANGAR_OPEN_SECONDS, LAUNCH_WAVES, TURN_RATE } from '../../src/sim/boss/hiveCarrier';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { FoeField } from '../../src/sim/foes/foeField';
import { turnBetween } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena, type Timed } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const DEF = BOSSES.hiveCarrier;
const MAX_HP = 70;
const INTRO = 2;
const APPROACH = 20;
/** The foes stream's seed in these rigs. */
const FOES_SEED = 99;

interface Rig {
  readonly r: BossRunner;
  readonly arena: StubArena;
  readonly foes: FoeField;
}

/** A Hive Carrier on a stub arena whose ship sits still at bottom-centre, launching into a foe field of its own. */
function carrier(seed = 1, arena: StubArena = stubArena()): Rig {
  const foes = new FoeField(arena, createRng(FOES_SEED), { score: (base) => base, killed: () => undefined });
  const setup: BossSetup = { maxHp: MAX_HP, rng: createRng(seed), rockSpeed: 1, field: BOSS_FIELD, foes };
  return { r: new BossRunner(DEF, createHiveCarrier(setup), setup), arena, foes };
}

const ATTACKS = createHiveCarrier({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD, foes: carrier().foes }).attacks;

/** Steps the carrier only: its drones are placed but never moved, so none is lost. */
const stepper = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};

/** A Hive Carrier whose intro is over. */
function fighting(seed = 1, arena?: StubArena): Rig {
  const rig = carrier(seed, arena);
  runFor(stepper(rig.r), rig.arena, INTRO + 0.05);
  expect(rig.r.state).toBe('fighting');
  return rig;
}

/** Steps until the hangar has just opened; throws if it does not within `seconds`. */
function untilOpen(rig: Rig, seconds = 10): void {
  for (let i = 0; i < Math.round(seconds / STEP_SECONDS); i++) {
    runFor(stepper(rig.r), rig.arena, STEP_SECONDS);
    if (rig.r.view.vulnerable) return;
  }
  throw new Error(`the hangar should open within ${String(seconds)} s`);
}

/** The point on the hull's rim at `offset` radians round from where it faces. */
function rim(rig: Rig, offset: number): { x: number; y: number } {
  const { x, y, radius, facing } = rig.r.view;
  return { x: x + Math.cos(facing + offset) * radius, y: y + Math.sin(facing + offset) * radius };
}

/** Lands a blow at `at`. */
const hitAt = (rig: Rig, at: { x: number; y: number }, damage = 1) => rig.r.hit(damage, at.x, at.y);

/** Wounds the carrier through its open hangar down to `hp`. */
function woundTo(rig: Rig, hp: number): void {
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
  it('is a radius-100, 70 HP hull on three phases of launches, broadsides and retreats, resting less each phase', () => {
    expect(DEF).toMatchObject({ name: 'Hive Carrier', radius: 100, hp: 70 });
    expect(DEF.phases).toEqual([['launch', 'broadside'], ['launch', 'retreat', 'broadside'], ['launch', 'broadside', 'launch', 'retreat']]);
    expect(DEF.rest).toEqual([2.2, 1.6, 1.2]);
    expect(ATTACKS.launch.windup).toBe(0.7);
    expect(ATTACKS.broadside.windup).toBe(0.6);
    expect(HANGAR_OPEN_SECONDS).toBe(2.5);
    expect(DRONE_CAP).toBe(8);
    expect(LAUNCH_WAVES).toEqual({ 1: 3, 2: 4, 3: 5 });
  });

  it('guards 2-★, while the later Dimensions keep the Sentinel for now', () => {
    expect(galaxyById('2-6').boss).toBe('hiveCarrier');
    expect(bossHp(DEF, 2)).toBe(MAX_HP + 6);
    for (const id of ['3-6', '4-6', '5-6'] as const) expect(galaxyById(id).boss).toBe('sentinel');
  });

  it('needs the galaxy\'s foes to launch its drones into, and says so', () => {
    expect(() => createHiveCarrier({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD })).toThrow(/setup\.foes/);
  });
});

describe('the Hive Carrier\'s hangar', () => {
  it('is shut through the intro and the first rest: every blow deflects, and nothing aims at it', () => {
    const rig = carrier();
    runFor(stepper(rig.r), rig.arena, INTRO + 1);
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

  it('opens on the step each launch runs and stays open 2.5 s, then deflects every blow until the next', () => {
    const rig = fighting();
    const log = runFor(stepper(rig.r), rig.arena, 12);
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
    runFor(stepper(rig.r), rig.arena, HANGAR_OPEN_SECONDS);
    expect(rig.r.view.vulnerable).toBe(false);
    expect(hitAt(rig, rim(rig, 0))).toBe('deflected');
  });

  it('always opens again after a launch, even one the drone cap leaves empty, and stays open 2.5 s (RF 4)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const rig = fighting(seed);
      // Fill the cap before the first launch: every launch of the fight is then skipped.
      for (let i = 0; i < DRONE_CAP; i++) rig.foes.launch('drone', 100 + 40 * i, 650, 0);
      const open: [number, boolean][] = [];
      const log = runFor(stepper(rig.r), rig.arena, 120, () => {
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
  it('launches 3, 4 or 5 by phase from the hangar mouth, heading out of it, apart', () => {
    for (const [hp, wave] of [[MAX_HP, 3], [40, 4], [20, 5]] as const) {
      const rig = fighting();
      woundTo(rig, hp);
      rig.foes.clear();
      for (let i = 0; i < Math.round(12 / STEP_SECONDS) && rig.foes.list.length === 0; i++) runFor(stepper(rig.r), rig.arena, STEP_SECONDS);
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

  it('never has more than 8 of its drones alive, and tops a wave up to the cap', () => {
    const rig = fighting();
    for (let i = 0; i < 6; i++) rig.foes.launch('drone', 100 + 40 * i, 650, 0);
    const log = runFor(stepper(rig.r), rig.arena, 120, () => {
      expect(rig.foes.launched).toBeLessThanOrEqual(DRONE_CAP);
    });
    const first = launchTimes(log)[0] ?? Number.NaN;
    expect(timedOfType(log, 'foeSpawned').filter((l) => near(l.at, first))).toHaveLength(2);
    expect(rig.foes.launched).toBe(DRONE_CAP);
    expect(timedOfType(log, 'foeSpawned')).toHaveLength(2);
  });

  it('launches again once its drones are shot down', () => {
    const rig = fighting();
    const log = runFor(stepper(rig.r), rig.arena, 60, () => {
      if (rig.foes.launched >= DRONE_CAP) rig.foes.clear();
    });
    expect(timedOfType(log, 'foeSpawned').length).toBeGreaterThan(DRONE_CAP);
  });

  it('places them without a draw from the foes stream: it moves after the launch as any drone does', () => {
    const rig = fighting();
    runFor(stepper(rig.r), rig.arena, 12);
    expect(rig.foes.launched).toBeGreaterThan(0);
    expect(rig.foes.rng.next()).toBe(createRng(FOES_SEED).next());
  });
});

describe('the Hive Carrier\'s flight', () => {
  it('crosses the top third of the field, never leaving it, in a fight with every attack', () => {
    for (const seed of [1, 2, 3]) {
      const rig = fighting(seed);
      let [left, right] = [Infinity, -Infinity];
      runFor(stepper(rig.r), rig.arena, 120, () => {
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
    runFor(stepper(rig.r), rig.arena, 4, () => {
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
    runFor(stepper(rig.r), rig.arena, 20, () => {
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
    const log = runFor(stepper(rig.r), rig.arena, 8);
    const at = timedOfType(log, 'bossWindup').find((l) => l.event.attack === 'broadside');
    if (at === undefined) throw new Error('a broadside should follow the first launch');
    const rocks = rig.arena.asteroids;
    expect(rocks.length).toBeGreaterThanOrEqual(4);
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
    runFor(stepper(rig.r), rig.arena, 3.5);
    // Park the ship just under the hull, in the broadside's line.
    const { x, y, radius } = rig.r.view;
    Object.assign(arena.ship, { x, y: y + radius + 40 });
    runFor(stepper(rig.r), rig.arena, 6);
    for (const rock of arena.asteroids) expect(Math.hypot(rock.px - arena.ship.x, rock.py - arena.ship.y)).toBeGreaterThan(60);
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
    runFor(stepper(rig.r), rig.arena, 40, () => {
      const { windup, x } = rig.r.view;
      const moved = Math.abs(x - lastX);
      lastX = x;
      if (windup === null) {
        steps = 0;
        rocks = rig.arena.asteroids.length;
        return;
      }
      steps++;
      seen.set(windup, Math.max(seen.get(windup) ?? 0, steps * STEP_SECONDS));
      expect(rig.arena.asteroids.length, `${windup}: no rocks`).toBe(rocks);
      expect(rig.arena.events.filter((e) => e.type === 'foeSpawned' || e.type === 'hangarOpen'), `${windup}: no drones`).toEqual([]);
      expect(moved, `${windup}: no retreat`).toBeLessThan(1);
    });
    for (const id of ['launch', 'broadside', 'retreat'] as const) expect(seen.get(id) ?? 0, id).toBeGreaterThanOrEqual(ATTACKS[id].windup - 2 * STEP_SECONDS);
  });

  it('runs each phase\'s attacks in the same order whatever the seed', () => {
    const order = (seed: number, hp: number): AttackId[] => {
      const rig = fighting(seed);
      woundTo(rig, hp);
      return timedOfType(runFor(stepper(rig.r), rig.arena, 40), 'bossWindup').map((l) => l.event.attack).slice(0, 4);
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
    runFor(stepper(rig.r), rig.arena, 40, () => {
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
  function calm(id: GalaxyId): GalaxyDef {
    return { ...galaxyById(id), kinds: MUTED_KINDS, events: [] };
  }

  it('takes a life off a ship that never moves or fires, in a 120 s fight', () => {
    for (const seed of [1, 2, 3]) {
      const world = new World({ seed, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm('2-6'), mode: 'free' } });
      const hitsAt: string[] = [];
      for (let i = 0; i < Math.round((APPROACH + INTRO + 120) / STEP_SECONDS) && world.status === 'playing'; i++) {
        for (const e of world.step(STEP_SECONDS, NO_CONTROLS)) if (e.type === 'shipHit') hitsAt.push(world.boss?.state ?? 'none');
      }
      expect(world.boss?.id).toBe('hiveCarrier');
      expect(world.deaths, `seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
      expect(new Set(hitsAt)).toEqual(new Set(['fighting']));
    }
  });
});
