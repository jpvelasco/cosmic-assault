import { describe, expect, it, vi } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { AttackId } from '../../src/content/types';
import { launchSlot, launchSlotsFor } from '../../src/sim/boss/attacks';
import { createEclipse, DIVE_SECONDS, ECLIPSE_CAP, ECLIPSE_CORONA, ECLIPSE_REACH, ECLIPSE_VOLLEY, ECLIPSE_WAVES, QUAKE_ROCKS } from '../../src/sim/boss/eclipse';
import type { BossBehaviour, BossPart, BossPhase, BossSetup, BossView, Point } from '../../src/sim/boss/behaviour';
import { clearSpot, respawnClearance } from '../../src/sim/respawn';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { Bolts } from '../../src/sim/foes/bolts';
import { FoeField } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { BOSS_FIELD, runFor, stubArena, type StubArena } from '../helpers/bossArena';

const DEF = BOSSES.eclipse;
const spot: Point = { x: 0, y: 0 };
const MAX_HP = 134;
const INTRO = 2;
const FOES_SEED = 99;
/** The earlier bosses whose moves the Eclipse remixes, by id. */
const EARLIER = { monolith: BOSSES.monolith, hiveCarrier: BOSSES.hiveCarrier, warden: BOSSES.warden, leviathan: BOSSES.leviathan };

interface Rig {
  readonly r: BossRunner;
  readonly arena: StubArena;
  readonly bolts: Bolts;
  readonly foes: FoeField;
}

/** An Eclipse on a stub arena of `arena`'s field, with a bolt field and a foe field of its own. */
function eclipse(seed = 1, arena: StubArena = stubArena()): Rig {
  const bolts = new Bolts(arena);
  const foes = new FoeField(arena, createRng(FOES_SEED), { score: (base) => base, killed: () => undefined });
  const setup: BossSetup = { maxHp: MAX_HP, rng: createRng(seed), rockSpeed: 1, field: arena.field(), bolts, foes };
  return { r: new BossRunner(DEF, createEclipse(setup), setup), arena, bolts, foes };
}

/** Steps the Eclipse and flies its bolts and foes, as a galaxy does. */
const stepper = (rig: Rig) => (dt: number, arena: StubArena) => {
  rig.bolts.step(dt);
  rig.foes.step(dt);
  rig.r.step(dt, arena);
};

function fighting(seed = 1, arena?: StubArena): Rig {
  const rig = eclipse(seed, arena);
  runFor(stepper(rig), rig.arena, INTRO + 0.05);
  expect(rig.r.state).toBe('fighting');
  return rig;
}

const ATTACKS = createEclipse({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD, bolts: new Bolts(stubArena()), foes: eclipse().foes }).attacks;

const live = (boss: Readonly<BossView>): Readonly<BossPart>[] => boss.parts.filter((p) => p.hp > 0);

/** Breaks shards, in part order, until `count` are left standing. */
function breakUntil(r: BossRunner, count: number): void {
  for (let i = 0; i < r.view.parts.length && live(r.view).length > count; i++) {
    while ((r.view.parts[i]?.hp ?? 0) > 0 && r.state === 'fighting') r.hitPart(i, 1);
  }
}

/** Takes the Eclipse to `phase` by blows on its core, breaking shards whenever its core is shielded. */
function toPhase(rig: Rig, phase: BossPhase): void {
  for (let i = 0; i < 4000 && rig.r.view.phase < phase; i++) {
    if (rig.r.view.vulnerable) rig.r.hit(1);
    else breakUntil(rig.r, 4);
    stepper(rig)(STEP_SECONDS, rig.arena);
  }
  expect(rig.r.view.phase).toBe(phase);
}

/** Steps until `done` holds, returning how many steps that took; fails if it takes longer than `seconds`. */
function stepUntil(rig: Rig, done: (view: Readonly<BossView>) => boolean, seconds = 60): number {
  for (let step = 1; step <= seconds / STEP_SECONDS; step++) {
    stepper(rig)(STEP_SECONDS, rig.arena);
    if (done(rig.r.view)) return step;
  }
  throw new Error(`the condition did not hold within ${String(seconds)} s`);
}

/** Every earlier boss whose moves include `id`. */
const earlierOf = (id: AttackId): string[] => Object.entries(EARLIER).filter(([, def]) => def.phases.flat().includes(id)).map(([name]) => name);

describe('the Eclipse definition', () => {
  it('is a radius-70 core of 56 HP (80 at 5-★) on three phases of moves, resting less each phase', () => {
    expect(DEF).toMatchObject({ name: 'Eclipse', radius: 70, hp: 56 });
    expect(bossHp(DEF, 5)).toBe(80);
    expect(DEF.phases).toEqual([
      ['shardVolley', 'quake', 'pulse'],
      ['launch', 'turretVolley', 'shardVolley'],
      ['dive', 'turretVolley', 'launch', 'quake', 'pulse'],
    ]);
    expect(DEF.rest).toEqual([1.8, 1.3, 0.9]);
  });

  it('guards 5-★, the last Dimension, and no galaxy names a retired boss or attack', () => {
    expect(galaxyById('5-6').boss).toBe('eclipse');
    expect(Object.keys(BOSSES)).not.toContain('sentinel');
    for (const g of GALAXIES) {
      const named = JSON.stringify(g);
      for (const id of ['sentinel', 'shardRing', 'lunge']) expect(named, `${g.id} names ${id}`).not.toContain(`"${id}"`);
    }
  });

  it('draws every move from an earlier boss, and phases 2 and 3 each from at least two of them', () => {
    for (const id of Object.keys(ATTACKS) as AttackId[]) expect(earlierOf(id), id).not.toHaveLength(0);
    DEF.phases.forEach((list, i) => {
      if (i === 0) return;
      expect(new Set(list.flatMap(earlierOf)).size, `phase ${String(i + 1)}`).toBeGreaterThanOrEqual(2);
    });
  });

  it('names exactly the moves its attacks make, each with a windup of at least the minimum', () => {
    expect(new Set(Object.keys(ATTACKS))).toEqual(new Set(DEF.phases.flat()));
    for (const [id, spec] of Object.entries(ATTACKS)) expect(spec.windup, id).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
  });

  it('needs the galaxy\'s foes to launch its drones into, and says so', () => {
    expect(() => createEclipse({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD, bolts: new Bolts(stubArena()) })).toThrow(/setup\.foes/);
  });

  it('is refused by the runner if a move its phases name is missing', () => {
    const setup: BossSetup = { maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: stubArena().field(), bolts: new Bolts(stubArena()), foes: eclipse().foes };
    const full = createEclipse(setup);
    const lacking: BossBehaviour = { ...full, attacks: Object.fromEntries(Object.entries(full.attacks).filter(([id]) => id !== 'dive')) };
    expect(() => new BossRunner(DEF, lacking, setup)).toThrow(/dive/);
  });
});

describe('the Eclipse corona', () => {
  it('holds 10 shards of radius 14 and 2 HP on an orbit of 112, reaching 126, and moves with its core', () => {
    const { r } = eclipse();
    expect(ECLIPSE_CORONA).toMatchObject({ counts: [10, 10], radius: 14, hp: 2, orbit: 112, exposedAt: 4 });
    expect(r.view.parts).toHaveLength(10);
    for (const part of r.view.parts) {
      expect(part).toMatchObject({ radius: 14, hp: 2, maxHp: 2 });
      expect(Math.hypot(part.x - r.view.x, part.y - r.view.y)).toBeCloseTo(112, 9);
    }
    expect(r.reach).toBe(126);
    expect(ECLIPSE_REACH).toBe(126);
  });

  it('is shielded with five or more shards, and bare with four or fewer, saying so on the view', () => {
    const rig = fighting();
    expect(rig.r.view.vulnerable).toBe(false);
    breakUntil(rig.r, 5);
    expect(live(rig.r.view)).toHaveLength(5);
    expect(rig.r.view.vulnerable).toBe(false);
    expect(rig.r.hit(1)).toBe('deflected');
    breakUntil(rig.r, 4);
    expect(live(rig.r.view)).toHaveLength(4);
    expect(rig.r.view.vulnerable).toBe(true);
    expect(rig.r.hit(1)).toBe('hit');
  });

  it('grows one shard back every regrowth interval while bare, and shields the core again at five', () => {
    const rig = fighting();
    breakUntil(rig.r, 4);
    const { regrowSeconds } = ECLIPSE_CORONA;
    runFor(stepper(rig), rig.arena, regrowSeconds - 0.2);
    expect(live(rig.r.view)).toHaveLength(4);
    runFor(stepper(rig), rig.arena, 0.4);
    expect(live(rig.r.view)).toHaveLength(5);
    expect(rig.r.view.vulnerable).toBe(false);
  });

  it('regrows a shard only where the ship is clear of it, on every regrowth of a fight with the ship roaming', () => {
    const clearance = ECLIPSE_CORONA.growClearance;
    expect(clearance, 'the corona declares its grow clearance').toBeDefined();
    const rng = createRng(21);
    let regrown = 0;
    const rig = fighting(3);
    breakUntil(rig.r, 4);
    for (let step = 0; step < 90 / STEP_SECONDS; step++) {
      if (step % 240 === 0) Object.assign(rig.arena.ship, { x: rng.range(0, BOSS_FIELD.width), y: rng.range(0, BOSS_FIELD.height) });
      const before = rig.r.view.parts.map((p) => p.hp);
      stepper(rig)(STEP_SECONDS, rig.arena);
      rig.r.view.parts.forEach((part, i) => {
        if ((before[i] ?? 0) > 0 || part.hp <= 0) return;
        regrown++;
        const { ship } = rig.arena;
        expect(Math.hypot(part.x - ship.x, part.y - ship.y), `regrowth at step ${String(step)}`).toBeGreaterThanOrEqual(clearance ?? Infinity);
      });
      if (!rig.r.view.vulnerable) breakUntil(rig.r, 4);
    }
    expect(regrown, 'the fight regrew shards to check').toBeGreaterThanOrEqual(3);
  });

  it('skips the broken slot a ship sits on when its regrowth falls due, and grows the next clear one', () => {
    const clearance = ECLIPSE_CORONA.growClearance;
    expect(clearance, 'the corona declares its grow clearance').toBeDefined();
    const rig = fighting(9);
    breakUntil(rig.r, 4);
    // Just before the regrowth is due, the ship takes the first broken slot.
    runFor(stepper(rig), rig.arena, ECLIPSE_CORONA.regrowSeconds - 0.05);
    const first = rig.r.view.parts.findIndex((p) => p.hp <= 0);
    expect(first).toBeGreaterThanOrEqual(0);
    Object.assign(rig.arena.ship, { x: rig.r.view.parts[first]?.x, y: rig.r.view.parts[first]?.y });
    const before = rig.r.view.parts.map((p) => p.hp);
    // Steps on until the regrowth falls due and a shard grows back, the ship still on the slot it left empty.
    const grownNow = () => rig.r.view.parts.some((p, i) => (before[i] ?? 0) <= 0 && p.hp > 0);
    for (let step = 0; step < 1 / STEP_SECONDS && !grownNow(); step++) {
      stepper(rig)(STEP_SECONDS, rig.arena);
      expect(rig.r.view.parts[first]?.hp, 'the slot the ship is on stays empty').toBe(0);
    }
    const { parts } = rig.r.view;
    const grown = parts.map((_, i) => i).filter((i) => (before[i] ?? 0) <= 0 && (parts[i]?.hp ?? 0) > 0);
    expect(grown, 'exactly one shard grows, on a slot other than the ship\'s').toHaveLength(1);
    const grownPart = parts[grown[0] ?? -1];
    expect(Math.hypot((grownPart?.x ?? 0) - rig.arena.ship.x, (grownPart?.y ?? 0) - rig.arena.ship.y)).toBeGreaterThanOrEqual(clearance ?? Infinity);
  });

  it('carries no armour on any shard, so every blow on one breaks it', () => {
    const rig = fighting(11);
    for (const part of rig.r.view.parts) expect(part.armoured).toBe(false);
  });

  it('always becomes breakable: a shielded core offers a live shard, and every shard stays inside the field through random breaks, volleys and ship positions', { timeout: 60_000 }, () => {
    let shielded = 0;
    for (const seed of [1, 2]) {
      for (const aspect of [4 / 3, 21 / 9]) {
        const arena = stubArena(undefined, { width: 720 * aspect, height: 720 });
        const rig = eclipse(seed, arena);
        const rng = createRng(seed * 7 + 1);
        runFor(stepper(rig), arena, INTRO + 0.05);
        for (let step = 0; step < 40 / STEP_SECONDS && rig.r.state === 'fighting'; step++) {
          if (step % 240 === 0) Object.assign(arena.ship, { x: rng.range(0, arena.field().width), y: rng.range(0, arena.field().height) });
          if (rng.chance(0.01)) breakUntil(rig.r, rng.int(4, 10));
          stepper(rig)(STEP_SECONDS, arena);
          for (const part of live(rig.r.view)) {
            expect(part.x - part.radius, `seed ${String(seed)} aspect ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(-1e-6);
            expect(part.x + part.radius).toBeLessThanOrEqual(arena.field().width + 1e-6);
            expect(part.y - part.radius).toBeGreaterThanOrEqual(-1e-6);
            expect(part.y + part.radius).toBeLessThanOrEqual(arena.field().height + 1e-6);
          }
          if (!rig.r.view.vulnerable) {
            shielded++;
            expect(live(rig.r.view).length, 'a shielded core keeps at least five shards').toBeGreaterThan(4);
            expect(rig.r.view.target, 'a shielded core offers a shard').not.toBeNull();
          }
        }
      }
    }
    // The sweep must reach the shielded state it checks, or it proves nothing.
    expect(shielded).toBeGreaterThan(100);
  });

  it('keeps every shard its volley throws inside the field, even with the ship in a corner', () => {
    const arena = stubArena(createShip(2, 2));
    const rig = eclipse(1, arena);
    runFor(stepper(rig), arena, INTRO + 0.05);
    stepUntil(rig, (view) => view.active === 'shardVolley', 30);
    let flights = 0;
    for (let step = 0; step < ECLIPSE_VOLLEY.seconds / STEP_SECONDS && rig.r.view.active === 'shardVolley'; step++) {
      stepper(rig)(STEP_SECONDS, arena);
      flights++;
      for (const part of live(rig.r.view)) {
        expect(part.x).toBeGreaterThanOrEqual(part.radius - 1e-6);
        expect(part.y).toBeGreaterThanOrEqual(part.radius - 1e-6);
      }
    }
    expect(flights).toBeGreaterThan(0);
  });
});

describe('the Eclipse moves', () => {
  it('runs each move with its own numbers, from the shared modules', () => {
    expect(ATTACKS.shardVolley).toMatchObject({ windup: 1.2 });
    expect(ATTACKS.shardVolley.active).toBe(ECLIPSE_VOLLEY.seconds);
    expect(QUAKE_ROCKS).toEqual({ 1: 6, 2: 8, 3: 10 });
    expect(ATTACKS.quake).toMatchObject({ windup: 0.8, active: 0 });
    expect(ATTACKS.pulse).toMatchObject({ windup: 0.6, active: 0.3 });
    expect(ATTACKS.launch).toMatchObject({ windup: 0.7, active: 0 });
    expect(ATTACKS.turretVolley).toMatchObject({ windup: 0.6, active: 0.4 });
    expect(ATTACKS.dive).toMatchObject({ windup: 1, active: DIVE_SECONDS });
    expect(ECLIPSE_CAP).toBe(8);
    expect(ECLIPSE_WAVES).toEqual({ 1: 2, 2: 2, 3: 3 });
  });

  it('telegraphs its dive long enough for a ship at rest to thrust out of the core\'s lane, with a 5% margin', () => {
    const leave = Math.sqrt((2 * (DEF.radius + PLAYER.radius)) / PLAYER.thrust);
    expect(ATTACKS.dive.windup).toBeGreaterThanOrEqual(1.05 * leave);
  });

  it('declares its honest threat for each move: lanes to the aim for the shard volley and dive, a shove for the pulse, a ring for the turret volley', () => {
    const seen: Record<string, unknown> = {};
    for (const phase of [1, 2, 3] as const) {
      const rig = fighting(phase);
      if (phase > 1) toPhase(rig, phase);
      for (let step = 0; step < 40 / STEP_SECONDS; step++) {
        stepper(rig)(STEP_SECONDS, rig.arena);
        const threat = rig.r.view.threat;
        if (threat !== null) seen[threat.attack] = threat;
      }
    }
    expect(seen.shardVolley).toMatchObject({ kind: 'lane', reach: 74 });
    expect(seen.dive).toMatchObject({ kind: 'lane', reach: ECLIPSE_REACH });
    expect(seen.pulse).toMatchObject({ kind: 'shove' });
    // Its bolts fly outward along rays no threat kind describes yet, so the turret volley declares none.
    expect(seen.turretVolley).toMatchObject({ kind: 'none' });
    expect(seen.quake).toMatchObject({ kind: 'none' });
    expect(seen.launch).toMatchObject({ kind: 'none' });
  });

  it('fires its quake\'s rocks from the core\'s rim, by phase, all pass-through', () => {
    // Only phases 1 and 3 hold a quake.
    for (const phase of [1, 3] as const) {
      const rig = fighting(3);
      if (phase > 1) toPhase(rig, phase);
      stepUntil(rig, (view) => view.windup === 'quake', 60);
      rig.arena.asteroids.length = 0;
      stepUntil(rig, (view) => view.active === 'quake', 5);
      stepper(rig)(STEP_SECONDS, rig.arena);
      expect(rig.arena.asteroids, `phase ${String(phase)}`).toHaveLength(QUAKE_ROCKS[phase]);
      for (const rock of rig.arena.asteroids) expect(rock.transient).toBe(true);
    }
  });

  it('shoves the ship straight away from the core as its pulse goes active, by the speed its threat declares', () => {
    const rig = fighting(4);
    const { ship } = rig.arena;
    // Below the core, so the push runs straight down the field.
    Object.assign(ship, { x: rig.r.view.x, y: rig.r.view.y + 200 });
    stepUntil(rig, (view) => view.windup === 'pulse', 60);
    const threat = rig.r.view.threat;
    expect(threat).toMatchObject({ kind: 'shove' });
    stepUntil(rig, (view) => view.active === 'pulse', 5);
    // The pulse's shove is asked for on the step its run first makes it, and the ship takes it on the hazard path.
    stepper(rig)(STEP_SECONDS, rig.arena);
    rig.r.shove(ship);
    const shoved = Math.hypot(ship.vx, ship.vy);
    expect(ship.vy).toBeGreaterThan(0);
    expect(shoved).toBeGreaterThan(0);
    expect(shoved).toBeLessThanOrEqual(threat?.kind === 'shove' ? threat.speed + 1e-6 : 0);
  });

  it('dives its core to the aim as a dash held inside the field, with its lane declared at the full reach of the corona', () => {
    const arena = stubArena(createShip(BOSS_FIELD.width - 2, BOSS_FIELD.height - 2));
    const rig = eclipse(2, arena);
    runFor(stepper(rig), arena, INTRO + 0.05);
    toPhase(rig, 3);
    stepUntil(rig, (view) => view.windup === 'dive', 60);
    expect(rig.r.view.threat).toMatchObject({ kind: 'lane', reach: ECLIPSE_REACH });
    const { aim } = rig.r.view;
    expect(aim.x).toBeLessThanOrEqual(arena.field().width - ECLIPSE_REACH + 1e-6);
    expect(aim.y).toBeLessThanOrEqual(arena.field().height - ECLIPSE_REACH + 1e-6);
    stepUntil(rig, (view) => view.active === 'dive', 5);
    stepUntil(rig, (view) => view.active !== 'dive', DIVE_SECONDS + 0.5);
    // The dash ends on the aim, to a unit: its last run step lands it there to float precision.
    expect(Math.hypot(rig.r.view.x - aim.x, rig.r.view.y - aim.y)).toBeLessThan(1);
  });

  it('launches a wave by phase from clear slots, never more than its cap alive', () => {
    const rig = fighting(5);
    toPhase(rig, 3);
    rig.foes.clear();
    stepUntil(rig, (view) => view.active === 'launch', 60);
    stepper(rig)(STEP_SECONDS, rig.arena);
    expect(rig.foes.launched).toBe(ECLIPSE_WAVES[3]);
    for (let step = 0; step < 60 / STEP_SECONDS; step++) {
      stepper(rig)(STEP_SECONDS, rig.arena);
      expect(rig.foes.launched).toBeLessThanOrEqual(ECLIPSE_CAP);
    }
  });

  it('forms every drone its launch sends out on a mouth slot the drawer marks, skipping the slot the ship is on', () => {
    const rig = fighting(7);
    toPhase(rig, 3);
    rig.foes.clear();
    const wave = ECLIPSE_WAVES[3];
    stepUntil(rig, (view) => view.windup === 'launch', 60);
    // The ship lies on the mouth's first slot, so that slot must stay empty.
    launchSlot(rig.r.view, 0, wave, spot);
    Object.assign(rig.arena.ship, { x: spot.x, y: spot.y });
    stepUntil(rig, (view) => view.active === 'launch', 5);
    stepper(rig)(STEP_SECONDS, rig.arena);
    const marks = launchSlotsFor(rig.r.view, BOSS_FIELD, rig.arena.ship, wave, wave, []).map((slot) => {
      launchSlot(rig.r.view, slot, wave, spot);
      return { x: spot.x, y: spot.y };
    });
    expect(rig.foes.list.length, 'drones launched').toBeGreaterThan(0);
    for (const drone of rig.foes.list) {
      const near = marks.some((mark) => Math.hypot(drone.x - mark.x, drone.y - mark.y) < 5);
      expect(near, `drone at ${String(drone.x)},${String(drone.y)} forms on no marked slot`).toBe(true);
    }
  });

  it('fires its turret volley radially from every live shard, along each shard\'s bearing from the core', () => {
    const rig = fighting(6);
    toPhase(rig, 2);
    stepUntil(rig, (view) => view.windup === 'turretVolley', 60);
    stepUntil(rig, (view) => view.active === 'turretVolley', 5);
    // Its run makes the bolts on the step after the one that made it active.
    const standing = live(rig.r.view);
    stepper(rig)(STEP_SECONDS, rig.arena);
    const bolts = rig.bolts.list.filter((b) => b.fromAttack && b.age === 0);
    expect(bolts).toHaveLength(standing.length);
    for (const bolt of bolts) {
      const heading = Math.atan2(bolt.vy, bolt.vx);
      const outward = standing.some((p) => {
        const bearing = Math.atan2(p.y - rig.r.view.y, p.x - rig.r.view.x);
        return Math.abs(Math.atan2(Math.sin(heading - bearing), Math.cos(heading - bearing))) < 0.05;
      });
      expect(outward, 'a bolt flies outward from a shard').toBe(true);
    }
  });
});

describe('the Eclipse\'s fairness', () => {
  it('keeps its respawn clear of the corona at every spot its core drifts to', () => {
    const rig = fighting(7);
    const margin = PLAYER.radius + ASTEROID.safeRadius;
    for (let step = 0; step < 30 / STEP_SECONDS; step++) {
      stepper(rig)(STEP_SECONDS, rig.arena);
      const spot = clearSpot(rig.r.view, rig.r.reach, rig.arena.field(), margin);
      expect(respawnClearance(rig.r.view, rig.r.reach, spot.x, spot.y)).toBeGreaterThanOrEqual(margin);
    }
  });

  it('keeps the whole corona inside the field, and the core\'s reach, as its fight begins', () => {
    const rig = fighting(8);
    const { width, height } = BOSS_FIELD;
    for (const part of rig.r.view.parts) {
      expect(part.x - part.radius).toBeGreaterThanOrEqual(0);
      expect(part.x + part.radius).toBeLessThanOrEqual(width);
      expect(part.y - part.radius).toBeGreaterThanOrEqual(0);
      expect(part.y + part.radius).toBeLessThanOrEqual(height);
    }
    expect(rig.r.view.x - rig.r.reach).toBeGreaterThanOrEqual(0);
    expect(rig.r.view.x + rig.r.reach).toBeLessThanOrEqual(width);
    expect(rig.r.view.y - rig.r.reach).toBeGreaterThanOrEqual(0);
    expect(rig.r.view.y + rig.r.reach).toBeLessThanOrEqual(height);
  });

  it('draws only from the fight\'s stream, never Math.random, and replays exactly', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const trail = (seed: number): number[] => {
        const rig = eclipse(seed);
        const poses: number[] = [];
        runFor(stepper(rig), rig.arena, 30, () => poses.push(rig.r.view.x, rig.r.view.y));
        return poses;
      };
      expect(trail(9)).toEqual(trail(9));
      expect(trail(9)).not.toEqual(trail(10));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
