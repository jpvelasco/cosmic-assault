import { afterEach, describe, expect, it, vi } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { AttackId, GalaxyDef } from '../../src/content/types';
import type { BossPart, BossSetup, BossView } from '../../src/sim/boss/behaviour';
import { bossClearance, bossTarget } from '../../src/sim/boss/bossRules';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import {
  coilAim,
  coilPoint,
  planCoil,
  swimPoint,
  type CoilPlan,
  COIL_NUDGE,
  COIL_OPENING,
  COIL_RADIUS,
  COIL_SECONDS,
  createLeviathan,
  DIVE_SECONDS,
  EASE_SECONDS,
  SEGMENT_COUNT,
  SEGMENT_GAP,
  SEGMENT_HP,
  SEGMENT_RADIUS,
  SWIM_MARGIN,
  SWIM_SPEED,
  TRAIL_STEP,
} from '../../src/sim/boss/leviathan';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import { TAU, turnBetween } from '../../src/sim/math';
import { createRng, type Rng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';
import { auditAttacks, fightRecorder } from '../helpers/telegraphAudit';

const DEF = BOSSES.leviathan;
/** Its HP in 4-★, the only galaxy it guards. */
const MAX_HP = bossHp(DEF, 4);
const INTRO = 2;
const APPROACH = 20;
const CENTRE = { x: BOSS_FIELD.width / 2, y: BOSS_FIELD.height / 2 };
/** Float residue from summing steps. */
const SLACK = 1e-6;

interface Rig {
  readonly r: BossRunner;
  readonly arena: StubArena;
  readonly bolts: Bolts;
}

/** A Leviathan on a stub arena whose still ship sits at `ship`, the field's centre unless given, with bolts to fire. */
function rig(seed = 1, ship = CENTRE, rng: Rng = createRng(seed), field: Field = BOSS_FIELD): Rig {
  const arena = stubArena(createShip(ship.x, ship.y), field);
  const bolts = new Bolts(arena);
  const setup: BossSetup = { maxHp: MAX_HP, rng, rockSpeed: 1, field, bolts };
  return { r: new BossRunner(DEF, createLeviathan(setup), setup), arena, bolts };
}

const stepper = (rigged: Rig) => (dt: number, arena: StubArena) => {
  rigged.r.step(dt, arena);
  rigged.bolts.step(dt);
};

/** A Leviathan whose intro is over. */
function fighting(seed = 1, ship = CENTRE): Rig {
  const rigged = rig(seed, ship);
  runFor(stepper(rigged), rigged.arena, INTRO + STEP_SECONDS);
  expect(rigged.r.state).toBe('fighting');
  return rigged;
}

const segments = (r: BossRunner): readonly BossPart[] => r.view.parts;
const liveSegments = (r: BossRunner): number => segments(r).filter((p) => p.hp > 0).length;
const distance = (a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Breaks the tail-most live segment with blows on it. */
function breakTail(r: BossRunner): void {
  const index = segments(r).findIndex((p) => p.hp > 0);
  const part = segments(r)[index] as BossPart;
  while (part.hp > 0) r.hitPart(index, 1);
}

/** Steps until `attack` winds up, or throws after `seconds`. */
function untilWindup(rigged: Rig, attack: AttackId, seconds = 30): void {
  for (let i = 0; i < Math.round(seconds / STEP_SECONDS); i++) {
    if (rigged.r.view.windup === attack) return;
    runFor(stepper(rigged), rigged.arena, STEP_SECONDS);
  }
  throw new Error(`${attack} should wind up within ${String(seconds)} s`);
}

/** Steps until the attack winding up goes active. */
function untilActive(rigged: Rig): void {
  const attack = rigged.r.view.windup;
  while (rigged.r.view.active !== attack) runFor(stepper(rigged), rigged.arena, STEP_SECONDS);
}

describe('the Leviathan definition', () => {
  it('is a radius-34 head of 70 HP, 88 in 4-★, losing 6 for each segment broken, on its three phases and rests', () => {
    expect(DEF).toMatchObject({ id: 'leviathan', name: 'Leviathan', hp: 70, radius: 34, partBreakDamage: 6, rest: [1.8, 1.4, 1.0] });
    expect(DEF.phases).toEqual([['spit', 'dive'], ['dive', 'spit', 'coil'], ['coil', 'dive', 'spit', 'dive']]);
    expect(MAX_HP).toBe(88);
  });

  it('guards 4-★', () => {
    expect(galaxyById('4-6').boss).toBe('leviathan');
  });

  it('telegraphs its dive for 1 s, its spit for 0.5 s and its coil for 0.9 s, every one at least the minimum', () => {
    const { attacks } = createLeviathan({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD, bolts: new Bolts(stubArena()) });
    expect({ dive: attacks.dive.windup, spit: attacks.spit.windup, coil: attacks.coil.windup }).toEqual({ dive: 1, spit: 0.5, coil: 0.9 });
    // Long enough for a ship at rest to thrust out of the head's lane, with a 5% margin.
    expect(attacks.dive.windup).toBeGreaterThanOrEqual(1.05 * Math.sqrt((2 * (DEF.radius + PLAYER.radius)) / PLAYER.thrust));
    for (const spec of Object.values(attacks)) expect(spec.windup).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    expect(attacks.dive).toMatchObject({ active: DIVE_SECONDS, threat: { kind: 'lane', reach: 'core' } });
    expect(attacks.coil).toMatchObject({ active: COIL_SECONDS, threat: { kind: 'ring', radius: COIL_RADIUS, reach: DEF.radius, around: 'aim' } });
    expect(attacks.spit.threat).toBeUndefined();
  });
});

describe('the Leviathan body', () => {
  it('is 8 segments of radius 24 and 3 HP, listed tail first, each 40 along the trail from the next', () => {
    const { r } = rig();
    expect(segments(r)).toHaveLength(SEGMENT_COUNT);
    expect([SEGMENT_COUNT, SEGMENT_RADIUS, SEGMENT_HP, SEGMENT_GAP]).toEqual([8, 24, 3, 40]);
    for (const part of segments(r)) expect(part).toMatchObject({ radius: SEGMENT_RADIUS, hp: SEGMENT_HP, maxHp: SEGMENT_HP });
    const chain = [...segments(r), r.view];
    for (let i = 0; i + 1 < chain.length; i++) {
      const gap = distance(chain[i] as BossPart, chain[i + 1] as BossPart);
      expect(gap, `segment ${String(i)}`).toBeLessThanOrEqual(SEGMENT_GAP + SLACK);
      expect(gap, `segment ${String(i)}`).toBeGreaterThan(SEGMENT_GAP * 0.9);
    }
  });

  it('arrives at the top of the field with its segments trailed behind the head, away from the centre, all inside the field', () => {
    for (const field of [BOSS_FIELD, { width: 960, height: 720 }, { width: 1680, height: 720 }]) {
      const { r } = rig(1, { x: field.width / 2, y: field.height / 2 }, createRng(1), field);
      const centre = { x: field.width / 2, y: field.height / 2 };
      expect(r.view).toMatchObject({ x: field.width / 2, y: SWIM_MARGIN });
      let previous = distance(r.view, centre);
      for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
        const part = segments(r)[i] as BossPart;
        expect(distance(part, centre), `segment ${String(i)}`).toBeGreaterThan(previous);
        previous = distance(part, centre);
        expect(part.x - part.radius).toBeGreaterThanOrEqual(0);
        expect(part.x + part.radius).toBeLessThanOrEqual(field.width);
        expect(part.y - part.radius).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('holds still at home through its intro', () => {
    const rigged = rig();
    const before = [rigged.r.view.x, rigged.r.view.y, ...segments(rigged.r).flatMap((p) => [p.x, p.y])];
    runFor(stepper(rigged), rigged.arena, INTRO - STEP_SECONDS);
    expect(rigged.r.state).toBe('intro');
    expect([rigged.r.view.x, rigged.r.view.y, ...segments(rigged.r).flatMap((p) => [p.x, p.y])]).toEqual(before);
  });

  it('swims a path inside the field margins at no more than 110 u/s, between its attacks', () => {
    const rigged = fighting();
    const { r } = rigged;
    let swimSteps = 0;
    let lastStrike = -Infinity;
    runFor(stepper(rigged), rigged.arena, 90, () => {
      const { view } = r;
      if (view.active === 'dive' || view.active === 'coil') lastStrike = rigged.arena.elapsed();
      // The ease back onto the path starts on the step the attack ends, after its last active one.
      if (view.windup !== null || view.active !== null || rigged.arena.elapsed() - lastStrike <= EASE_SECONDS + 2 * STEP_SECONDS) return;
      swimSteps++;
      expect(distance(view, { x: view.px, y: view.py }) / STEP_SECONDS).toBeLessThanOrEqual(SWIM_SPEED + SLACK);
      expect(view.x).toBeGreaterThanOrEqual(SWIM_MARGIN - SLACK);
      expect(view.x).toBeLessThanOrEqual(BOSS_FIELD.width - SWIM_MARGIN + SLACK);
      expect(view.y).toBeGreaterThanOrEqual(SWIM_MARGIN - SLACK);
      expect(view.y).toBeLessThanOrEqual(BOSS_FIELD.height - SWIM_MARGIN + SLACK);
    });
    expect(swimSteps * STEP_SECONDS).toBeGreaterThan(30);
  });

  it('turns its head the way it swims', () => {
    const rigged = fighting();
    runFor(stepper(rigged), rigged.arena, 0.5);
    const { view } = rigged.r;
    expect(turnBetween(view.facing, Math.atan2(view.y - view.py, view.x - view.px))).toBeCloseTo(0, 6);
  });
});

/** How far (x, y) lies from the line from `a` to `b`. */
function offPath(x: number, y: number, [ax = 0, ay = 0]: readonly number[], [bx = 0, by = 0]: readonly number[]): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

/** Lands one blow where a shot does harm now, on the core or the segment it names. */
function blow(r: BossRunner): void {
  const target = bossTarget(r.view);
  if (target === null) return;
  const index = segments(r).indexOf(target as BossPart);
  if (index >= 0) r.hitPart(index, 1);
  else r.hit(1, target.x, target.y);
}

/** Runs `rigged` for `seconds`, landing a blow a second where it does harm, calling `each` after every step. */
function batter(rigged: Rig, seconds: number, each: () => void = () => undefined): void {
  let step = 0;
  runFor(stepper(rigged), rigged.arena, seconds, () => {
    if (step++ % Math.round(1 / STEP_SECONDS) === 0) blow(rigged.r);
    each();
  });
}

describe('the Leviathan segment chain', () => {
  /** Every pose of the head and of each segment, step by step, over `seconds` of a fight landing a blow a second where it does harm. */
  function poses(seed: number, seconds: number): { head: number[][]; parts: number[][][] } {
    const rigged = fighting(seed);
    const head: number[][] = [];
    const parts: number[][][] = [];
    batter(rigged, seconds, () => {
      head.push([rigged.r.view.x, rigged.r.view.y]);
      parts.push(segments(rigged.r).map((p) => [p.x, p.y]));
    });
    return { head, parts };
  }

  it('lays every segment on the way the head has come, and the same way for the same seed', () => {
    const { head, parts } = poses(2, 60);
    expect(poses(2, 60)).toEqual({ head, parts });
    // Within a trail step of the way the head went over the last 5 s, checked every half second.
    const history = Math.round(5 / STEP_SECONDS);
    for (let s = history; s < parts.length; s += Math.round(0.5 / STEP_SECONDS)) {
      for (const [x = 0, y = 0] of parts[s] ?? []) {
        let nearest = Infinity;
        for (let k = s - history; k < s; k++) nearest = Math.min(nearest, offPath(x, y, head[k] ?? [], head[k + 1] ?? []));
        expect(nearest, `step ${String(s)}`).toBeLessThanOrEqual(TRAIL_STEP + SLACK);
      }
    }
  });

  it('never wraps: no body jumps across the field, and outside a coil the head stays inside it', () => {
    const rigged = fighting(3, { x: 200, y: 120 });
    const { r } = rigged;
    let coiledAt = -Infinity;
    batter(rigged, 100, () => {
      const { view } = r;
      if (view.active === 'coil') coiledAt = rigged.arena.elapsed();
      for (const body of [view, ...view.parts]) expect(distance(body, { x: body.px, y: body.py }), 'a step').toBeLessThan(SEGMENT_GAP);
      if (rigged.arena.elapsed() - coiledAt <= EASE_SECONDS + STEP_SECONDS) return;
      expect(view.x - view.radius).toBeGreaterThanOrEqual(-SLACK);
      expect(view.x + view.radius).toBeLessThanOrEqual(BOSS_FIELD.width + SLACK);
      expect(view.y - view.radius).toBeGreaterThanOrEqual(-SLACK);
      expect(view.y + view.radius).toBeLessThanOrEqual(BOSS_FIELD.height + SLACK);
    });
    expect(coiledAt).toBeGreaterThan(0);
  }, 30_000);

  it('keeps its chain through a resize: re-laid along its stretched trail on the next step, and smooth from then on', () => {
    const rigged = fighting();
    runFor(stepper(rigged), rigged.arena, 3);
    const narrow: Field = { width: 960, height: 720 };
    rigged.r.resize(BOSS_FIELD, narrow);
    const resized = stubArena(rigged.arena.ship, narrow);
    const after: Rig = { ...rigged, arena: resized };
    let first = true;
    runFor(stepper(after), resized, 4, () => {
      const chain = [...segments(rigged.r), rigged.r.view];
      if (!first) for (const body of chain) expect(distance(body, { x: body.px, y: body.py })).toBeLessThan(SEGMENT_GAP / 4);
      first = false;
      for (let i = 0; i + 1 < chain.length; i++) expect(distance(chain[i] as BossPart, chain[i + 1] as BossPart)).toBeLessThanOrEqual(SEGMENT_GAP + SLACK);
      for (const body of chain) expect(body.x).toBeLessThanOrEqual(narrow.width);
    });
  });
});

describe('dismantling the Leviathan', () => {
  it('can be hurt only on its tail-most segment, which the shots are aimed at; the rest deflect, and so does the head', () => {
    const { r } = fighting();
    expect(r.view.target).toBe(segments(r)[0]);
    for (let i = 1; i < SEGMENT_COUNT; i++) {
      expect(r.hitPart(i, 1), `segment ${String(i)}`).toBe('deflected');
      expect(segments(r)[i]?.armoured).toBe(true);
    }
    expect(segments(r)[0]?.armoured).toBe(false);
    expect(r.hit(1)).toBe('deflected');
    expect(r.hitPart(0, 1)).toBe('hit');
    expect(r.hp).toBe(MAX_HP);
  });

  it('shortens tail first: each break moves the target to the next segment and takes 6 off the head', () => {
    const { r } = fighting();
    for (let broken = 1; broken < SEGMENT_COUNT; broken++) {
      breakTail(r);
      expect(liveSegments(r)).toBe(SEGMENT_COUNT - broken);
      expect(r.view.target).toBe(segments(r)[broken]);
      expect(r.hp).toBe(MAX_HP - 6 * broken);
      expect(r.view.vulnerable).toBe(false);
    }
  });

  it('lays its head bare once the last segment breaks, announcing it once, and is then hurt on the head', () => {
    const rigged = fighting();
    const { r } = rigged;
    for (let i = 0; i < SEGMENT_COUNT - 1; i++) breakTail(r);
    const before = runFor(stepper(rigged), rigged.arena, 0.5);
    expect(timedOfType(before, 'bossExposed')).toHaveLength(0);
    breakTail(r);
    expect(r.view.vulnerable).toBe(true);
    expect(r.view.target).toBe(r.view);
    const log = runFor(stepper(rigged), rigged.arena, 2);
    expect(timedOfType(log, 'bossExposed')).toHaveLength(1);
    expect(r.hit(1)).toBe('hit');
    expect(r.hp).toBe(MAX_HP - 6 * SEGMENT_COUNT - 1);
  });

  it('advances its phases as it is dismantled, but no break ever kills it', () => {
    const rigged = fighting();
    const { r } = rigged;
    for (let i = 0; i < 4; i++) breakTail(r);
    expect(r.phase).toBe(1);
    breakTail(r);
    expect(r.phase).toBe(2);
    const log = runFor(stepper(rigged), rigged.arena, STEP_SECONDS);
    expect(timedOfType(log, 'bossPhase').map((l) => l.event.phase)).toEqual([2]);

    const low = fighting(2);
    low.r.view.hp = 3;
    for (let i = 0; i < SEGMENT_COUNT; i++) breakTail(low.r);
    expect(low.r.hp).toBe(1);
    expect(low.r.state).toBe('fighting');
  });

  it('is always beatable: one blow a second where a shot does harm beats it within two minutes of its arrival, on every seed tried', () => {
    for (const seed of [1, 2, 3, 4]) {
      const rigged = rig(seed);
      batter(rigged, INTRO + 120);
      expect(rigged.r.state, `seed ${String(seed)}`).not.toBe('fighting');
    }
  });
});

describe('Leviathan attacks', () => {
  it('runs each phase\'s list in order', () => {
    const rigged = fighting();
    const log = runFor(stepper(rigged), rigged.arena, 12);
    expect(timedOfType(log, 'bossWindup').map((l) => l.event.attack).slice(0, 4)).toEqual(['spit', 'dive', 'spit', 'dive']);
  });

  it('holds its whole body still through every windup, and makes nothing before the windup ends', () => {
    const rigged = fighting(4, { x: 400, y: 500 });
    const { r } = rigged;
    const recorder = fightRecorder();
    const source = { get elapsed() { return rigged.arena.elapsed(); }, boss: r.view, asteroids: rigged.arena.asteroids, foes: [], bolts: rigged.bolts.list };
    let held: number[] | null = null;
    // A blow a second where it harms, so the fight runs through all three phases.
    batter(rigged, 120, () => {
      recorder.record(source, rigged.arena.events);
      const pose = [r.view.x, r.view.y, ...segments(r).flatMap((p) => [p.x, p.y])];
      if (r.view.windup === null) held = null;
      else if (held === null) held = pose;
      else expect(pose).toEqual(held);
    });
    const pairs = auditAttacks(recorder.steps);
    expect(new Set(pairs.map((p) => p.attack))).toEqual(new Set(['spit', 'dive', 'coil']));
    expect(pairs.find((p) => p.attack === 'spit')?.harm).toEqual(new Set(['bolts']));
  });

  it('dives at where the ship was as the windup began, over 1.0 s, its whole body down the lane', () => {
    const rigged = fighting(1, { x: 300, y: 560 });
    untilWindup(rigged, 'dive');
    const aim = { x: rigged.arena.ship.x, y: rigged.arena.ship.y };
    // The ship moves off; the dive still goes where it was.
    Object.assign(rigged.arena.ship, { x: 1000, y: 200 });
    untilActive(rigged);
    runFor(stepper(rigged), rigged.arena, DIVE_SECONDS);
    expect(distance(rigged.r.view, aim)).toBeLessThan(1);
    expect(rigged.r.view.threat).toBeNull();
  });

  it('spits a bolt from each live segment, square to the body, the sides alternating', () => {
    const rigged = fighting();
    breakTail(rigged.r);
    untilWindup(rigged, 'spit');
    untilActive(rigged);
    const log = runFor(stepper(rigged), rigged.arena, STEP_SECONDS);
    const fired = timedOfType(log, 'boltFired').map((l) => l.event);
    expect(fired).toHaveLength(SEGMENT_COUNT - 1);
    // Fired from where the body was as the step began, before it swam on.
    const sides = fired.map((bolt, i) => {
      const part = segments(rigged.r)[i + 1] as BossPart;
      const leader = (i + 2 < SEGMENT_COUNT ? segments(rigged.r)[i + 2] : rigged.r.view) as BossPart;
      expect([bolt.x, bolt.y]).toEqual([part.px, part.py]);
      const along = Math.atan2(leader.py - part.py, leader.px - part.px);
      expect(Math.abs(Math.cos(bolt.angle - along))).toBeLessThan(1e-9);
      return Math.sign(Math.sin(bolt.angle - along));
    });
    for (let i = 1; i < sides.length; i++) expect(sides[i]).toBe(-(sides[i - 1] ?? 0));
    for (const bolt of rigged.bolts.list) expect(bolt.fromAttack).toBe(true);
  });

  it('coils round where the ship was at radius 220 for 2.0 s, in through the 60° opening it showed, out of it while round, then out through it', () => {
    const rigged = fighting(1, CENTRE);
    for (let i = 0; i < 5; i++) breakTail(rigged.r);
    untilWindup(rigged, 'coil', 60);
    const centre = { x: rigged.arena.ship.x, y: rigged.arena.ship.y };
    const opening = Math.atan2(rigged.r.view.y - centre.y, rigged.r.view.x - centre.x);
    expect(rigged.r.view.threat).toMatchObject({ kind: 'ring', reach: DEF.radius, ring: { radius: COIL_RADIUS, around: 'aim' } });
    untilActive(rigged);
    const bearings: number[] = [];
    const radii: number[] = [];
    runFor(stepper(rigged), rigged.arena, COIL_SECONDS, () => {
      const { view } = rigged.r;
      bearings.push(turnBetween(opening, Math.atan2(view.y - centre.y, view.x - centre.x)));
      radii.push(distance(view, centre));
    });
    expect(rigged.r.view.active).toBeNull();
    // Circling: on the ring. It comes in through the opening, and once round out of it keeps out of it until it turns
    // out through it.
    const circling = bearings.map((b, i) => ({ b, r: radii[i] ?? 0 })).filter((s) => Math.abs(s.r - COIL_RADIUS) < SLACK);
    expect(circling.length * STEP_SECONDS).toBeGreaterThan(COIL_SECONDS * 0.5);
    const round = circling.findIndex(({ b }) => Math.abs(b) >= COIL_OPENING / 2);
    expect(round).toBeGreaterThanOrEqual(0);
    for (const { b } of circling.slice(round)) expect(Math.abs(b)).toBeGreaterThanOrEqual(COIL_OPENING / 2 - SLACK);
    // It leaves inside the opening, outside the ring.
    expect(Math.abs(bearings.at(-1) ?? Infinity)).toBeLessThan(COIL_OPENING / 2);
    expect(radii.at(-1)).toBeGreaterThan(COIL_RADIUS);
  });
});

describe('a Leviathan coil near the field\'s edge', () => {
  /**
   * Where a ship parks, 60 in from each corner and from the middle of each edge, and the least share of the coil's steps
   * the head spends on the field there.
   *
   * The ring's centre may move at most `COIL_NUDGE` (136) from the ship, so a ship that holds still stays 40 inside the
   * ring, clear of the head. At an edge's middle that is nearly enough: a ship 60 from the top gets a centre 196 down,
   * and the ring pokes 24 past the edge. At a corner it is not: the centre moves 136 along the diagonal, to about
   * (156, 156), and the ring overhangs both walls by 64, about half its round. Keeping the whole ring on would take a
   * centre 220 from both walls, 226 from the ship, so the ring would pass over a ship that held still.
   */
  const PARKED = [
    ['the top-left corner', { x: 60, y: 60 }, 0.4],
    ['the top-right corner', { x: 1220, y: 60 }, 0.4],
    ['the bottom-left corner', { x: 60, y: 660 }, 0.4],
    ['the bottom-right corner', { x: 1220, y: 660 }, 0.4],
    ['the top edge', { x: 640, y: 60 }, 0.8],
    ['the bottom edge', { x: 640, y: 660 }, 0.8],
    ['the left edge', { x: 60, y: 360 }, 0.8],
    ['the right edge', { x: 1220, y: 360 }, 0.8],
  ] as const;

  /**
   * The coil round a ship parked at `ship`: the share of its steps with the head on the field, the head's nearest pass
   * to the ship on the ring and over every active step, in to the ring and out, and the nearest pass of a live segment.
   */
  function coilRound(ship: { readonly x: number; readonly y: number }): { onField: number; onRing: number; head: number; segment: number; centre: { x: number; y: number } } {
    // The ship waits at the centre, where the dive before the coil goes, and parks at `ship` as the spit before it winds up.
    const rigged = fighting(1);
    for (let i = 0; i < 5; i++) breakTail(rigged.r);
    untilWindup(rigged, 'spit');
    Object.assign(rigged.arena.ship, ship);
    untilWindup(rigged, 'coil');
    for (const body of [rigged.r.view, ...rigged.r.view.parts.filter((p) => p.hp > 0)]) expect(distance(body, ship), 'clear as the coil winds up').toBeGreaterThan(body.radius + PLAYER.radius);
    const centre = { ...rigged.r.view.aim };
    untilActive(rigged);
    let steps = 0;
    let on = 0;
    const nearest = { onRing: Infinity, head: Infinity, segment: Infinity };
    runFor(stepper(rigged), rigged.arena, COIL_SECONDS, () => {
      const { view } = rigged.r;
      for (const body of [view, ...view.parts]) expect(distance(body, { x: body.px, y: body.py }), 'a step').toBeLessThan(SEGMENT_GAP);
      steps++;
      if (view.x >= 0 && view.y >= 0 && view.x <= BOSS_FIELD.width && view.y <= BOSS_FIELD.height) on++;
      nearest.head = Math.min(nearest.head, distance(view, ship));
      if (Math.abs(distance(view, centre) - COIL_RADIUS) < SLACK) nearest.onRing = Math.min(nearest.onRing, distance(view, ship));
      for (const part of view.parts) if (part.hp > 0) nearest.segment = Math.min(nearest.segment, distance(part, ship));
    });
    return { onField: on / steps, ...nearest, centre };
  }

  it.each(PARKED)('rings a ship parked at %s from a centre moved in toward the field, a still ship never touched', (_name, ship, floor) => {
    const { onField, onRing, head, segment, centre } = coilRound(ship);
    expect(distance(centre, ship)).toBeGreaterThan(0);
    expect(distance(centre, ship)).toBeLessThanOrEqual(COIL_NUDGE + SLACK);
    expect(onField).toBeGreaterThanOrEqual(floor);
    expect(onRing).toBeGreaterThanOrEqual(DEF.radius + PLAYER.radius + 40 - SLACK);
    expect(head).toBeGreaterThanOrEqual(DEF.radius + PLAYER.radius);
    expect(segment).toBeGreaterThanOrEqual(SEGMENT_RADIUS + PLAYER.radius);
  });

  it('plans every coil clear of a ship that holds still: over ship spots, swim-path phases and both turns', () => {
    // Seeded ship spots over the field, the head held at points round its swim path, and the head having swum either
    // way: the head never comes within touching distance of the ship at any moment of the coil, in, round and out.
    const spots = createRng(17);
    const plan: CoilPlan = { opening: 0, from: 0, turn: 1, turnsAt: 0, movesAt: 0 };
    const [head, aim, at] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    const touch = DEF.radius + PLAYER.radius;
    const turns = new Set<number>();
    let coils = 0;
    for (let n = 0; n < 400; n++) {
      const ship = { x: spots.range(60, BOSS_FIELD.width - 60), y: spots.range(60, BOSS_FIELD.height - 60) };
      coilAim(ship, BOSS_FIELD, aim);
      for (let k = 0; k < 32; k++) {
        swimPoint(BOSS_FIELD, (k / 32) * TAU, head);
        if (distance(head, ship) <= touch) continue;
        for (const swimTurn of [1, -1]) {
          planCoil(head, aim, ship, swimTurn, plan);
          turns.add(plan.turn);
          coils++;
          for (let t = 0; t <= COIL_SECONDS + SLACK; t += STEP_SECONDS) {
            coilPoint(plan, aim, t, at);
            if (distance(at, ship) < touch) throw new Error(`ship at ${ship.x.toFixed(1)}, ${ship.y.toFixed(1)}, head from ${head.x.toFixed(1)}, ${head.y.toFixed(1)}, swum ${String(swimTurn)}: ${distance(at, ship).toFixed(1)} away at ${t.toFixed(3)} s`);
          }
        }
      }
    }
    expect(coils).toBeGreaterThan(20_000);
    expect(turns).toEqual(new Set([1, -1]));
  }, 30_000);

  it('holds a head that starts inside the ring, on the centre side of the ship, round at its own distance before it swims out', () => {
    // The head 45 from the ship and 37 from the ring's centre, nearly on the ship's bearing: swimming out at once would
    // run it over the ship, so it waits for the ship to fall a quarter turn behind it.
    const [ship, head, aim, at] = [{ x: 171.9, y: 348.6 }, { x: 216.9, y: 343.4 }, { x: 254.0, y: 348.6 }, { x: 0, y: 0 }];
    const plan: CoilPlan = { opening: 0, from: 0, turn: 1, turnsAt: 0, movesAt: 0 };
    for (const swimTurn of [1, -1]) {
      planCoil(head, aim, ship, swimTurn, plan);
      expect(plan.from).toBeLessThan(COIL_RADIUS);
      expect(plan.movesAt).toBeGreaterThan(0);
      for (let t = 0; t <= COIL_SECONDS + SLACK; t += STEP_SECONDS) expect(distance(coilPoint(plan, aim, t, at), ship), `${t.toFixed(3)} s`).toBeGreaterThanOrEqual(DEF.radius + PLAYER.radius);
    }
  });

  it('never touches a ship that holds still where it was as a coil wound up, wherever the ship is and whichever way the head turns', () => {
    // Ships at seeded spots over the field, each met by every coil of a fight's second phase, from wherever the swim
    // and the attacks before it left the head; a ship already within reach of the body as a coil winds up is skipped.
    const spots = createRng(41);
    const turns = new Set<number>();
    let coils = 0;
    for (let n = 0; n < 24; n++) {
      const ship = { x: spots.range(60, BOSS_FIELD.width - 60), y: spots.range(60, BOSS_FIELD.height - 60) };
      const rigged = fighting(1 + n, ship);
      for (let i = 0; i < 5; i++) breakTail(rigged.r);
      let watching = false;
      let lastWindup: AttackId | null = null;
      runFor(stepper(rigged), rigged.arena, 40, () => {
        const { view } = rigged.r;
        if (view.windup === 'coil' && lastWindup !== 'coil') {
          const bodies = [view, ...view.parts.filter((p) => p.hp > 0)];
          watching = bodies.every((b) => distance(b, ship) > b.radius + PLAYER.radius + 8);
          if (watching) coils++;
        }
        lastWindup = view.windup;
        if (!watching || view.active !== 'coil') return;
        const label = `ship at ${ship.x.toFixed(0)}, ${ship.y.toFixed(0)}, ${rigged.arena.elapsed().toFixed(2)} s`;
        expect(distance(view, ship), label).toBeGreaterThanOrEqual(DEF.radius + PLAYER.radius);
        for (const part of view.parts) if (part.hp > 0) expect(distance(part, ship), label).toBeGreaterThanOrEqual(SEGMENT_RADIUS + PLAYER.radius);
        // Which way round the head goes, once it is on the ring.
        if (Math.abs(distance(view, view.aim) - COIL_RADIUS) < SLACK) {
          turns.add(Math.sign((view.x - view.aim.x) * (view.y - view.py) - (view.y - view.aim.y) * (view.x - view.px)));
        }
      });
    }
    expect(coils).toBeGreaterThan(30);
    expect(turns).toEqual(new Set([1, -1]));
  }, 30_000);

  it('centres the ring where the ship was when the whole ring fits on the field, and moves it no more than the nudge', () => {
    const at = { x: 0, y: 0 };
    coilAim({ x: 640, y: 360 }, BOSS_FIELD, at);
    expect(at).toEqual({ x: 640, y: 360 });
    coilAim({ x: 640, y: 60 }, BOSS_FIELD, at);
    expect(at).toEqual({ x: 640, y: 60 + COIL_NUDGE });
    coilAim({ x: 0, y: 0 }, BOSS_FIELD, at);
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(COIL_NUDGE, 9);
  });
});

describe('Leviathan determinism', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws only from the fight\'s own stream, never Math.random, and replays exactly', () => {
    const random = vi.spyOn(Math, 'random');
    const play = (): number[] => {
      const base = createRng(5);
      let draws = 0;
      const counted: Rng = new Proxy(base, { get: (target, key) => { const value = Reflect.get(target, key) as unknown; return typeof value === 'function' ? (...args: unknown[]) => { draws++; return (value as (...a: unknown[]) => unknown).apply(target, args); } : value; } });
      const rigged = rig(5, { x: 500, y: 500 }, counted);
      const trace: number[] = [];
      batter(rigged, 60, () => {
        trace.push(rigged.r.view.x, rigged.r.view.y, rigged.r.hp);
      });
      trace.push(draws);
      return trace;
    };
    const first = play();
    expect(play()).toEqual(first);
    expect(random).not.toHaveBeenCalled();
  });

  it('draws which way its swim turns first, so seeds differ on an empty field: the two sides are mirror images', () => {
    const body = (seed: number): readonly BossPart[] => createLeviathan({ maxHp: MAX_HP, rng: createRng(seed), rockSpeed: 1, field: BOSS_FIELD, bolts: new Bolts(stubArena()) }).parts ?? [];
    const bySide = new Map<number, readonly BossPart[]>();
    for (let seed = 1; seed <= 20; seed++) {
      const parts = body(seed);
      bySide.set(Math.sign((parts[0] as BossPart).x - BOSS_FIELD.width / 2), parts);
    }
    const right = bySide.get(1);
    const left = bySide.get(-1);
    if (right === undefined || left === undefined) throw new Error('20 seeds should give both sides');
    for (const [i, part] of right.entries()) {
      const twin = left[i] as BossPart;
      expect(twin.x).toBeCloseTo(BOSS_FIELD.width - part.x, 6);
      expect(twin.y).toBeCloseTo(part.y, 6);
    }
  });
});

describe('the Leviathan in 4-★', () => {
  const calm: GalaxyDef = { ...galaxyById('4-6'), kinds: MUTED_KINDS, events: [] };
  const world = (seed: number): World => new World({ seed, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm, mode: 'free' } });
  const toFight = (w: World): BossView => {
    for (let i = 0; i < Math.round((APPROACH + INTRO + 0.5) / STEP_SECONDS); i++) w.step(STEP_SECONDS, NO_CONTROLS);
    if (w.boss?.state !== 'fighting') throw new Error('the Leviathan should be fighting');
    return w.boss;
  };
  /** Puts the ship on segment `index`, ready to be hurt. */
  const onSegment = (w: World, boss: BossView, index: number): void => {
    const part = boss.parts[index] as BossPart;
    Object.assign(w['shipState'], { x: part.x, y: part.y, vx: 0, vy: 0, invulnerable: false, invulnerableFor: 0 });
  };

  it('costs a life when the ship touches a segment, but not while the ship cannot be hurt, nor during the warp', () => {
    const w = world(1);
    const boss = toFight(w);
    onSegment(w, boss, 3);
    const lives = w.lives;
    expect(w.step(STEP_SECONDS, NO_CONTROLS).some((e) => e.type === 'shipHit')).toBe(true);
    expect(w.lives).toBe(lives - 1);

    const shielded = world(1);
    const sameBoss = toFight(shielded);
    onSegment(shielded, sameBoss, 3);
    Object.assign(shielded['shipState'], { invulnerable: true, invulnerableFor: 1 });
    expect(shielded.step(STEP_SECONDS, NO_CONTROLS).some((e) => e.type === 'shipHit')).toBe(false);

    const warping = world(1);
    const warpingBoss = toFight(warping);
    onSegment(warping, warpingBoss, 3);
    Object.assign(warping, { statusValue: 'warping' });
    expect(warping.step(STEP_SECONDS, NO_CONTROLS).some((e) => e.type === 'shipHit')).toBe(false);
  });

  it('takes a life off a ship that never moves or fires, and respawns it clear of the head and every segment', () => {
    const w = world(1);
    let respawns = 0;
    let hits = 0;
    for (let i = 0; i < Math.round(150 / STEP_SECONDS) && w.status === 'playing'; i++) {
      if (!w.step(STEP_SECONDS, NO_CONTROLS).some((e) => e.type === 'shipHit')) continue;
      hits++;
      if (w.lives === 0) continue;
      const boss = w.boss;
      if (boss === null) throw new Error('only the Leviathan hits the ship here');
      expect(bossClearance(boss, boss.radius, w.ship.x, w.ship.y)).toBeGreaterThanOrEqual(PLAYER.radius + ASTEROID.safeRadius);
      respawns++;
    }
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(respawns).toBeGreaterThanOrEqual(1);
  });
});
