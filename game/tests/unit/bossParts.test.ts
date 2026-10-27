import { describe, expect, it } from 'vitest';
import { BOSSES, type BossDef } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { BossId } from '../../src/content/types';
import { bossTarget, BossRunner, DYING_SECONDS, MAX_SHOVE_SPEED, type AttackSpec, type BossBehaviour, type BossFactory, type BossPart, type BossView } from '../../src/sim/boss/bossRunner';
import { SENTINEL } from '../../src/sim/boss/sentinel';
import { STEP_SECONDS } from '../../src/sim/config';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { TAU } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const DEF: BossDef = BOSSES.sentinel;
const INTRO = 2;
const PARTS = 4;
/** How far the probe's parts sit from the core's centre. */
const PART_REACH = 100;
const PART_RADIUS = 12;

const stepper = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};

const livePartsOf = (boss: Readonly<BossView>): number => boss.parts.filter((p) => p.hp > 0).length;

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
    attacks: { shardRing: spec, lunge: spec, shardVolley: spec, quake: spec, pulse: spec },
    parts,
    reach: PART_REACH + PART_RADIUS,
    step: (ctx) => {
      seen.push([ctx.dt, ctx.boss.state]);
      parts.forEach((part, i) => {
        part.x = ctx.boss.x + Math.cos((i / PARTS) * TAU) * PART_REACH;
        part.y = ctx.boss.y + Math.sin((i / PARTS) * TAU) * PART_REACH;
      });
    },
    vulnerable: (boss) => livePartsOf(boss) <= 1,
    seen,
  };
}

function runnerOf(behaviour: BossBehaviour, maxHp = 30): BossRunner {
  return new BossRunner(DEF, behaviour, { maxHp, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD });
}

function fighting(behaviour: BossBehaviour = probe(), arena: StubArena = stubArena()): { r: BossRunner; arena: StubArena } {
  const r = runnerOf(behaviour);
  runFor(stepper(r), arena, INTRO + 0.05);
  expect(r.state).toBe('fighting');
  return { r, arena };
}

/** Breaks part `index` with as many 1-damage hits as it takes. */
function breakPart(r: BossRunner, index: number): void {
  while ((r.view.parts[index]?.hp ?? 0) > 0) r.hitPart(index, 1);
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
    expect(runnerOf(SENTINEL).view.parts).toEqual([]);
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
    runFor(stepper(r), arena, INTRO + 0.05);
    for (let i = 0; i < PARTS - 1; i++) breakPart(r, i);
    expect(r.hit(1)).toBe('killed');
    runFor(stepper(r), arena, 3);
    const states = new Set(behaviour.seen.map(([, state]) => state));
    expect(states).toEqual(new Set(['intro', 'fighting', 'dying']));
    for (const [dt] of behaviour.seen) expect(dt).toBe(STEP_SECONDS);
    // The step it goes down on runs none.
    expect(behaviour.seen.length).toBe(Math.round((INTRO + 0.05 + DYING_SECONDS) / STEP_SECONDS) - 1);
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
    const r = runnerOf(SENTINEL);
    const log = runFor(stepper(r), stubArena(), 12);
    expect(r.view.vulnerable).toBe(true);
    expect(log.filter((l) => l.event.type === 'bossExposed' || l.event.type === 'bossShielded')).toEqual([]);
  });

  it('points a shot at the core when it can be hurt, else at a live part, and nowhere outside the fight', () => {
    const r = runnerOf(probe());
    const arena = stubArena();
    runFor(stepper(r), arena, 0.5);
    expect(bossTarget(r.view)).toBeNull();
    runFor(stepper(r), arena, INTRO);
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
    expect(new Set(seen)).toEqual(new Set([null, 'shardRing']));
  });

  it('shoves the ship once, on the next hazard path, never past the speed cap', () => {
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
    const lacking: BossBehaviour = { driftSpeed: 0, attacks: { shardRing: SENTINEL.attacks.shardRing } };
    expect(() => runnerOf(lacking)).toThrow(/lunge/);
  });
});

describe('GalaxyRun with a boss that has parts', () => {
  /** Every boss played by the probe. */
  const probes = (shove = 0): Readonly<Record<BossId, BossFactory>> => Object.fromEntries(Object.keys(BOSSES).map((id) => [id, () => probe(shove)])) as unknown as Record<BossId, BossFactory>;

  function probeRun(shove = 0): { arena: StubArena; run: GalaxyRun } {
    const arena = stubArena();
    const galaxy = { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [] };
    const run = new GalaxyRun(galaxy, 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: createRng(5) }, arena, 0, probes(shove));
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
    expect(run.hitBoss(part.x, part.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossPartHit', part: 0, x: part.x, y: part.y, hp: 1 }]);
    arena.events.length = 0;
    expect(run.hitBoss(part.x, part.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossPartBroken', part: 0, x: part.x, y: part.y }]);
    expect(boss.hp).toBe(boss.maxHp);
  });

  it('spends a shot on a shielded core with a deflection, not a hit', () => {
    const { arena, run, boss } = galaxyRun();
    expect(run.hitBoss(boss.x, boss.y, 3)).toBe(true);
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
});
