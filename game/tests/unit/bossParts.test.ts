import { describe, expect, it, vi } from 'vitest';
import { BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { BOSSES, type BossDef } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { BossId } from '../../src/content/types';
import { bossTarget, MAX_SHOVE_SPEED } from '../../src/sim/boss/bossRules';
import { BossRunner, DYING_SECONDS } from '../../src/sim/boss/bossRunner';
import type { AttackSpec, BossBehaviour, BossFactory, BossPart, BossView } from '../../src/sim/boss/behaviour';
import { BLAST, STEP_SECONDS } from '../../src/sim/config';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { TAU } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { NO_CONTROLS } from '../../src/sim/controls';
import { projectileFromShot, type Projectile } from '../../src/sim/projectile';
import { comboMultiplier } from '../../src/sim/scoring';
import { createShip } from '../../src/sim/ship';
import { PlayerShots, type ShotTargets } from '../../src/sim/shots';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, breakPart, FIXTURE, FIXTURE_DEF, liveParts, ofType, runFor, type StubArena, stubArena, timedOfType } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const DEF: BossDef = FIXTURE_DEF;
const PARTS = 4;
/** How far the probe's parts sit from the core's centre. */
const PART_REACH = 100;
const PART_RADIUS = 12;

const stepper = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};


interface Probe extends BossBehaviour {
  /** Every dt the step hook saw, with the boss's state at the time. */
  readonly seen: (readonly [number, BossView['state']])[];
}

/**
 * A boss with four 2 HP parts held at fixed bearings around its core, whose core can be hurt once one part or none is
 * left. Its one attack, held for 0.2 s, shoves the ship by `shove` (x only).
 */
function probe(shove = 0): Probe {
  const parts: BossPart[] = Array.from({ length: PARTS }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: PART_RADIUS, hp: 2, maxHp: 2 }));
  const seen: (readonly [number, BossView['state']])[] = [];
  const spec: AttackSpec = {
    windup: 0.4,
    active: 0.2,
    run: (ctx) => {
      if (ctx.age === 0) ctx.shoveX = shove;
    },
  };
  return {
    driftSpeed: 0,
    // Every attack any boss names, so the probe can stand in for any of them.
    attacks: { quake: spec, dive: spec, shardVolley: spec, pulse: spec },
    parts,
    reach: PART_REACH + PART_RADIUS,
    step: (ctx) => {
      seen.push([ctx.dt, ctx.boss.state]);
      parts.forEach((part, i) => {
        part.x = ctx.boss.x + Math.cos((i / PARTS) * TAU) * PART_REACH;
        part.y = ctx.boss.y + Math.sin((i / PARTS) * TAU) * PART_REACH;
      });
    },
    vulnerable: (boss) => liveParts(boss).length <= 1,
    seen,
  };
}

function runnerOf(behaviour: BossBehaviour, maxHp = 30): BossRunner {
  return new BossRunner(DEF, behaviour, { maxHp, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD });
}

function fighting(behaviour: BossBehaviour = probe(), arena: StubArena = stubArena()): { r: BossRunner; arena: StubArena } {
  const r = runnerOf(behaviour);
  runFor(stepper(r), arena, BOSS_INTRO_SECONDS + 0.05);
  expect(r.state).toBe('fighting');
  return { r, arena };
}

describe('a boss with parts', () => {
  it('shows its behaviour\'s parts on the view, the same objects every step, with their previous pose', () => {
    const behaviour = probe();
    const r = runnerOf(behaviour);
    expect(r.view.parts).toBe(behaviour.parts);
    const arena = stubArena();
    runFor(stepper(r), arena, 0.5);
    const part = r.view.parts[0] as BossPart;
    part.x += 7;
    runFor(stepper(r), arena, STEP_SECONDS);
    // The step remembers where the part was (moved by 7), then the behaviour puts it back.
    expect(part.px).toBeCloseTo(part.x + 7, 9);
  });

  it('has none for a boss whose behaviour has none', () => {
    expect(runnerOf(FIXTURE).view.parts).toEqual([]);
  });

  it('finds the live part a circle overlaps, and none once it breaks', () => {
    const { r } = fighting();
    const part = r.view.parts[1] as BossPart;
    expect(r.partAt(part.x + PART_RADIUS, part.y, 2)).toBe(1);
    expect(r.partAt(r.view.x, r.view.y, 2)).toBe(-1);
    expect(r.hitPart(1, 1)).toBe('hit');
    expect(part.hp).toBe(1);
    expect(r.hitPart(1, 1)).toBe('broken');
    expect(part.hp).toBe(0);
    expect(r.partAt(part.x, part.y, 2)).toBe(-1);
    expect(r.touches(part.x, part.y, 2)).toBe(false);
  });

  it('cannot have its parts hurt in its intro or dying', () => {
    const r = runnerOf(probe());
    runFor(stepper(r), stubArena(), 0.5);
    expect(r.hitPart(0, 1)).toBe('blocked');
    expect(r.view.parts[0]?.hp).toBe(2);
  });

  it('counts a live part as touching, like the core', () => {
    const { r } = fighting();
    const part = r.view.parts[2] as BossPart;
    expect(r.touches(part.x, part.y + PART_RADIUS + 9, 10)).toBe(true);
    expect(r.touches(r.view.x, r.view.y, 1)).toBe(true);
    expect(r.touches(r.view.x + PART_REACH * 3, r.view.y, 1)).toBe(false);
  });

  it('runs the behaviour\'s step every step with its length, through the intro, fight and dying, but not once down', () => {
    const behaviour = probe();
    const r = runnerOf(behaviour, 1);
    const arena = stubArena();
    runFor(stepper(r), arena, BOSS_INTRO_SECONDS + 0.05);
    for (let i = 0; i < PARTS - 1; i++) breakPart(r, i);
    expect(r.hit(1)).toBe('killed');
    runFor(stepper(r), arena, 3);
    const states = new Set(behaviour.seen.map(([, state]) => state));
    expect(states).toEqual(new Set(['intro', 'fighting', 'dying']));
    for (const [dt] of behaviour.seen) expect(dt).toBe(STEP_SECONDS);
    // The step it goes down on runs none.
    expect(behaviour.seen.length).toBe(Math.round((BOSS_INTRO_SECONDS + 0.05 + DYING_SECONDS) / STEP_SECONDS) - 1);
  });

  it('stretches its parts to a resized field', () => {
    const { r } = fighting();
    const part = r.view.parts[0] as BossPart;
    const before = { x: part.x, y: part.y };
    r.resize(BOSS_FIELD, { width: BOSS_FIELD.width * 2, height: BOSS_FIELD.height });
    expect(part.x).toBeGreaterThan(before.x);
    expect(part.px).toBeGreaterThan(before.x);
    expect(part.y).toBeCloseTo(before.y, 9);
  });

  it('keeps its parts\' reach inside the field as it drifts', () => {
    const drifting: BossBehaviour = { ...probe(), driftSpeed: 400 };
    const { r, arena } = fighting(drifting);
    const reach = PART_REACH + PART_RADIUS;
    runFor(stepper(r), arena, 20, () => {
      expect(r.view.x).toBeGreaterThanOrEqual(reach - 1e-6);
      expect(r.view.x).toBeLessThanOrEqual(BOSS_FIELD.width - reach + 1e-6);
      expect(r.view.y).toBeGreaterThanOrEqual(reach - 1e-6);
      expect(r.view.y).toBeLessThanOrEqual(BOSS_FIELD.height - reach + 1e-6);
    });
  });
});

describe('a boss whose core is only sometimes vulnerable', () => {
  it('deflects a blow on its core while its behaviour says it cannot be hurt, losing no HP', () => {
    const { r } = fighting();
    expect(r.view.vulnerable).toBe(false);
    expect(r.hit(1)).toBe('deflected');
    expect(r.hp).toBe(30);
  });

  it('can be hurt as soon as the part that exposes it breaks, without waiting for a step', () => {
    const { r } = fighting();
    for (let i = 0; i < PARTS - 1; i++) breakPart(r, i);
    expect(r.view.vulnerable).toBe(true);
    expect(r.hit(1)).toBe('hit');
    expect(r.hp).toBe(29);
  });

  it('announces the core exposed, and shielded again, once per change and only while fighting', () => {
    const behaviour = probe();
    const { r, arena } = fighting(behaviour);
    for (let i = 0; i < PARTS - 1; i++) breakPart(r, i);
    const exposed = runFor(stepper(r), arena, 0.5);
    expect(timedOfType(exposed, 'bossExposed').map((l) => l.event)).toEqual([{ type: 'bossExposed', x: r.view.x, y: r.view.y }]);
    (behaviour.parts?.[0] as BossPart).hp = 2;
    const shielded = runFor(stepper(r), arena, 0.5);
    expect(timedOfType(shielded, 'bossShielded')).toHaveLength(1);
    expect(timedOfType(shielded, 'bossExposed')).toHaveLength(0);
  });

  it('says nothing of a boss that is always vulnerable', () => {
    const r = runnerOf(FIXTURE);
    const log = runFor(stepper(r), stubArena(), 12);
    expect(r.view.vulnerable).toBe(true);
    expect(log.filter((l) => l.event.type === 'bossExposed' || l.event.type === 'bossShielded')).toEqual([]);
  });

  it('points a shot at the core when it can be hurt, else at a live part, and nowhere outside the fight', () => {
    const r = runnerOf(probe());
    const arena = stubArena();
    runFor(stepper(r), arena, 0.5);
    expect(bossTarget(r.view)).toBeNull();
    runFor(stepper(r), arena, BOSS_INTRO_SECONDS);
    expect(bossTarget(r.view)).toBe(r.view.parts[0]);
    breakPart(r, 0);
    expect(bossTarget(r.view)).toBe(r.view.parts[1]);
    breakPart(r, 1);
    breakPart(r, 2);
    expect(bossTarget(r.view)).toBe(r.view);
  });
});

describe('a boss attack under way', () => {
  it('is on the view while it runs, and only then', () => {
    const { r, arena } = fighting();
    const seen: (string | null)[] = [];
    runFor(stepper(r), arena, 8, () => {
      seen.push(r.view.active);
      if (r.view.active !== null) expect(r.view.windup).toBeNull();
    });
    expect(new Set(seen)).toEqual(new Set([null, 'quake']));
  });

  it('shoves the ship on the next hazard path after the attack asks, never past the speed cap', () => {
    const { r, arena } = fighting(probe(5000));
    const ship = createShip(BOSS_FIELD.width / 2, 600);
    let shoved = 0;
    runFor(stepper(r), arena, 6, () => {
      const before = ship.vx;
      r.shove(ship);
      if (ship.vx !== before) shoved++;
      expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(MAX_SHOVE_SPEED + 1e-9);
    });
    expect(shoved).toBeGreaterThanOrEqual(1);
    expect(ship.vx).toBeCloseTo(MAX_SHOVE_SPEED, 9);
  });

  it('refuses a behaviour that lacks an attack its definition names, saying which', () => {
    const lacking: BossBehaviour = { driftSpeed: 0, attacks: { quake: FIXTURE.attacks.quake } };
    expect(() => runnerOf(lacking)).toThrow(/dive/);
  });
});

describe('GalaxyRun with a boss that has parts', () => {
  /** Every boss played by the probe. */
  const probes = (shove = 0): Readonly<Record<BossId, BossFactory>> => Object.fromEntries(Object.keys(BOSSES).map((id) => [id, () => probe(shove)])) as unknown as Record<BossId, BossFactory>;

  function probeRun(shove = 0): { arena: StubArena; run: GalaxyRun } {
    const arena = stubArena();
    const galaxy = { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [] };
    const run = new GalaxyRun(galaxy, 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: () => createRng(5) }, arena, 0, probes(shove));
    return { arena, run };
  }

  /** A 1-6 galaxy whose boss is the probe, run on a stub arena until it is fighting. */
  function galaxyRun() {
    const { arena, run } = probeRun();
    for (let i = 0; i < Math.round(22.1 / STEP_SECONDS); i++) {
      arena.events.length = 0;
      arena.tick();
      run.beginStep();
      run.step(STEP_SECONDS);
    }
    arena.events.length = 0;
    const boss = run.boss;
    if (boss?.state !== 'fighting') throw new Error('the probe should be fighting 22.1 s in');
    return { arena, run, boss };
  }

  it('spends a shot on a part, reporting the hit and then the break, before the core behind it', () => {
    const { arena, run, boss } = galaxyRun();
    const part = boss.parts[0] as BossPart;
    expect(run.bosses.hitBoss(part.x, part.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossPartHit', part: 0, x: part.x, y: part.y, hp: 1 }]);
    arena.events.length = 0;
    expect(run.bosses.hitBoss(part.x, part.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossPartBroken', part: 0, x: part.x, y: part.y }]);
    expect(boss.hp).toBe(boss.maxHp);
  });

  it('spends a shot that overlaps both a part and the core once, on the part', () => {
    const { arena, run, boss } = galaxyRun();
    const part = boss.parts[0] as BossPart;
    // Part 0 sits 100 from the centre, on the core's rim: a shot 89 out touches both.
    const at = { x: boss.x + 89, y: boss.y };
    expect(Math.hypot(at.x - part.x, at.y - part.y)).toBeLessThan(PART_RADIUS + 3);
    expect(boss.radius + 3).toBeGreaterThan(89);
    expect(run.bosses.hitBoss(at.x, at.y, 3)).toBe(true);
    expect(arena.events.map((e) => e.type)).toEqual(['bossPartHit']);
    expect(part.hp).toBe(1);
  });

  it('spends a shot on a shielded core with a deflection, not a hit', () => {
    const { arena, run, boss } = galaxyRun();
    expect(run.bosses.hitBoss(boss.x, boss.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossDeflected', x: boss.x, y: boss.y }]);
    expect(boss.hp).toBe(boss.maxHp);
  });

  it('strikes a ship that runs into a live part', () => {
    const { run, boss } = galaxyRun();
    const part = boss.parts[3] as BossPart;
    expect(run.shipStruck(part.x, part.y - PART_RADIUS - 5, 10)).toBe(true);
    expect(run.shipStruck(boss.x + 400, boss.y + 400, 10)).toBe(false);
  });

  it('applies an attack\'s shove to the ship on its hazard path', () => {
    const { arena, run } = probeRun(120);
    let pushed = 0;
    for (let i = 0; i < Math.round(30 / STEP_SECONDS); i++) {
      arena.events.length = 0;
      arena.tick();
      run.beginStep();
      const before = arena.ship.vx;
      run.moveOwn(STEP_SECONDS, arena.ship);
      if (arena.ship.vx !== before) pushed++;
      run.step(STEP_SECONDS);
    }
    expect(pushed).toBeGreaterThan(0);
    expect(arena.ship.vx).toBeGreaterThan(0);
  });

  it('shoves nothing once the boss is beaten with a shove still to land', () => {
    const { arena, run } = probeRun(120);
    const steps = (): void => {
      arena.events.length = 0;
      arena.tick();
      run.beginStep();
      run.moveOwn(STEP_SECONDS, arena.ship);
      run.step(STEP_SECONDS);
    };
    // Up to its windup's end, then the step its attack runs, asking for a shove the next step would apply.
    for (let i = 0; i < Math.round(30 / STEP_SECONDS) && run.boss?.active == null; i++) steps();
    steps();
    const boss = run.boss;
    if (boss?.active == null) throw new Error('the probe should attack within 30 s');
    for (let target = bossTarget(boss); target !== null; target = bossTarget(boss)) run.bosses.hitBoss(target.x, target.y, 1);
    expect(boss.state).toBe('dying');
    steps();
    expect(arena.ship.vx).toBe(0);
    expect(arena.events.map((e) => e.type)).toContain('warpOut');
  });
  it('stops a piercing shot on a part and on the shielded core, whatever pierces it has left', () => {
    const { arena, run, boss } = galaxyRun();
    const shots = new PlayerShots(arena.events, () => 9000);
    const targets: ShotTargets = { rocks: [], foes: () => [], aim: () => null, hitBoss: (x, y, r) => run.bosses.hitBoss(x, y, r), hitFoe: () => -1, hitRock: () => -1 };
    const part = boss.parts[0] as BossPart;
    for (const at of [part, boss]) shots.fire([{ x: at.x, y: at.y, vx: 0, vy: 0 }], arena.ship, { pierce: 3, homingEvery: 0, wingman: false });
    shots.collide(targets);
    expect(shots.list).toEqual([]);
    expect(part.hp).toBe(1);
    expect(ofType(arena.events, 'bossDeflected')).toHaveLength(1);
  });

  describe('a blast', () => {
    /** The probe fighting, the ship `below` units under its core, and the parts named broken first. */
    function blastRig(below: number, broken: readonly number[] = []) {
      const rig = galaxyRun();
      const runner = rig.run.bosses.runner;
      if (runner === null) throw new Error('no boss');
      for (const i of broken) runner.hitPart(i, 2);
      rig.arena.events.length = 0;
      rig.arena.ship.x = rig.boss.x;
      rig.arena.ship.y = rig.boss.y + below;
      return { ...rig, blast: (kind: 'fieldBomb' | 'nova') => { rig.run['takePickup'](kind); } };
    }

    it('takes 1 off each live part a Field Bomb reaches, and nothing off a shielded core', () => {
      const { arena, boss, blast } = blastRig(150);
      blast('fieldBomb');
      // Parts 0-2 lie within 220 of the blast (plus their radius); part 3, above the core, does not.
      expect(boss.parts.map((p) => p.hp)).toEqual([1, 1, 1, 2]);
      expect(ofType(arena.events, 'bossPartHit').map((e) => e.part)).toEqual([0, 1, 2]);
      expect(ofType(arena.events, 'bossHit')).toEqual([]);
      expect(ofType(arena.events, 'bossDeflected')).toEqual([]);
      expect(boss.hp).toBe(boss.maxHp);
    });

    it('takes 2 off a vulnerable core a Field Bomb reaches, striking the rim facing the blast', () => {
      const { arena, boss, blast } = blastRig(150, [0, 1, 2]);
      expect(boss.vulnerable).toBe(true);
      blast('fieldBomb');
      expect(boss.hp).toBe(boss.maxHp - BLAST.fieldBomb.coreDamage);
      expect(ofType(arena.events, 'bossHit')).toEqual([{ type: 'bossHit', x: boss.x, y: boss.y + boss.radius, hp: boss.maxHp - 2 }]);
      expect(BLAST.fieldBomb).toEqual({ radius: 220, coreDamage: 2, partDamage: 1 });
    });

    it('takes 2 off every part a Nova reaches, then 4 off the core their breaking exposed', () => {
      const { arena, boss, blast } = blastRig(150);
      blast('nova');
      expect(boss.parts.map((p) => p.hp)).toEqual([0, 0, 0, 0]);
      expect(ofType(arena.events, 'bossPartBroken')).toHaveLength(4);
      expect(boss.hp).toBe(boss.maxHp - 4);
      expect(BLAST.nova).toEqual({ radius: 520, coreDamage: 4, partDamage: 2 });
    });

    it('leaves a boss out of its reach alone', () => {
      const { arena, boss, blast } = blastRig(400, [0, 1, 2]);
      blast('fieldBomb');
      expect(arena.events.map((e) => e.type)).toEqual(['blast']);
      expect(boss.hp).toBe(boss.maxHp);
    });

    it('scores the boss kill it lands, as a shot\'s would', () => {
      const { arena, boss, blast } = blastRig(150, [0, 1, 2]);
      boss.hp = 2;
      const award = vi.spyOn(arena, 'award');
      blast('fieldBomb');
      expect(boss.state).toBe('dying');
      expect(award).toHaveBeenCalledWith(1000 * comboMultiplier(1));
    });
  });
});

describe('a World with the Monolith', () => {
  it('breaks a 1 HP shard once when two shots reach it in the same step, the second going on', () => {
    const world = new World({ seed: 4, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [] }, mode: 'free' } });
    for (let i = 0; i < Math.round(22.1 / STEP_SECONDS); i++) world.step(STEP_SECONDS, NO_CONTROLS);
    const boss = world.boss;
    const run = (world as unknown as { run: GalaxyRun }).run;
    const part = boss?.parts[0];
    if (boss?.state !== 'fighting' || part === undefined) throw new Error('the Monolith should be fighting 22.1 s in');
    while (part.hp > 1) run.bosses.hitBoss(part.x, part.y, 1);
    expect(part.hp).toBe(1);
    const shots = world.projectiles as Projectile[];
    for (let i = 0; i < 2; i++) shots.push(projectileFromShot({ x: part.x, y: part.y, vx: 0, vy: 0 }, 9000 + i));
    const events = world.step(STEP_SECONDS, NO_CONTROLS).map((e) => e.type);
    expect(events.filter((t) => t === 'bossPartBroken')).toHaveLength(1);
    expect(events.filter((t) => t === 'bossPartHit')).toHaveLength(0);
    expect(part.hp).toBe(0);
    expect(world.projectiles.filter((p) => p.id === 9000 || p.id === 9001)).toHaveLength(1);
  });
});
