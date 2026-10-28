import { afterEach, describe, expect, it, vi } from 'vitest';
import { bossHp, BOSSES } from '../../src/content/bosses';
import { BOLT } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { AttackId, GalaxyDef } from '../../src/content/types';
import { chooseTarget, type Target } from '../../src/bot/targeting';
import { createView } from '../../src/bot/view';
import type { BossPart, BossSetup, BossView } from '../../src/sim/boss/behaviour';
import { crosses } from '../../src/sim/boss/attacks';
import { BossArena } from '../../src/sim/boss/bossArena';
import { respawnClearance } from '../../src/sim/respawn';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { stretchRoom } from '../../src/sim/boss/turretRing';
import { createWarden, LOCK_BOLTS, LOCK_TURRETS, PULSE_RADIUS, PULSE_SECONDS, SPIN_FACTOR, SPIN_SECONDS, VOLLEY_REPEAT, WARDEN_RING } from '../../src/sim/boss/warden';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { Bolts } from '../../src/sim/foes/bolts';
import { TAU, turnBetween } from '../../src/sim/math';
import { createRng, deriveSeed } from '../../src/sim/rng';
import { projectileFromShot, type Projectile } from '../../src/sim/projectile';
import { World } from '../../src/sim/world';
import { rescale } from '../../src/sim/wrap';
import { BOSS_FIELD, ofType, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';
import { ringGaps, wardenGapBearings, wardenGaps } from '../helpers/ringGaps';

const DEF = BOSSES.warden;
const MAX_HP = 76;
const INTRO = 2;
const APPROACH = 20;
const SLOT = TAU / WARDEN_RING.slots;
/** Room either side of a ship flying a straight line through a gap. */
const PATH_MARGIN = 10;
/** Each of the ring's two gaps must stay at least this wide. */
const WIDE_GAP = 50;

interface Rig {
  readonly r: BossRunner;
  readonly arena: StubArena;
  readonly bolts: Bolts;
}

function warden(seed = 1, arena: StubArena = stubArena()): Rig {
  const bolts = new Bolts(arena);
  const setup: BossSetup = { maxHp: MAX_HP, rng: createRng(seed), rockSpeed: 1, field: BOSS_FIELD, bolts };
  return { r: new BossRunner(DEF, createWarden(setup), setup), arena, bolts };
}

const ATTACKS = createWarden({ maxHp: MAX_HP, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD, bolts: new Bolts(stubArena()) }).attacks;

/** Steps the Warden and flies its bolts, as a galaxy does. */
const stepper = (rig: Rig) => (dt: number, arena: StubArena) => {
  rig.bolts.step(dt);
  rig.r.step(dt, arena);
};

function fighting(seed = 1, arena?: StubArena): Rig {
  const rig = warden(seed, arena);
  runFor(stepper(rig), rig.arena, INTRO + 0.05);
  expect(rig.r.state).toBe('fighting');
  return rig;
}

/** Takes the core down to `hp`, so the fight is in that HP's phase. */
function woundTo(r: BossRunner, hp: number): void {
  if (hp < r.hp) expect(r.hit(r.hp - hp)).toBe('hit');
}

const live = (boss: Readonly<BossView>): Readonly<BossPart>[] => boss.parts.filter((p) => p.hp > 0);
const bearingOf = (boss: Readonly<BossView>, p: Readonly<{ x: number; y: number }>): number => Math.atan2(p.y - boss.y, p.x - boss.x);
const ringRadius = (boss: Readonly<BossView>): number => Math.max(...live(boss).map((p) => Math.hypot(p.x - boss.x, p.y - boss.y)));

/** Distance from (px, py) to the segment from (ax, ay) to (bx, by). */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

/** Breaks the live turrets of `r` that `rng` picks, now and then, to stress the ring through a fight. */
function breakSome(r: BossRunner, rng: ReturnType<typeof createRng>): void {
  if (!rng.chance(0.01)) return;
  const i = rng.int(0, r.view.parts.length);
  const part = r.view.parts[i] as BossPart;
  while (part.hp > 0 && r.state === 'fighting') r.hitPart(i, 1);
}

describe('crosses', () => {
  it('is true on exactly one step for each time inside an attack\'s active window, its first step for 0, whatever the step', () => {
    for (const dt of [STEP_SECONDS, STEP_SECONDS / 2, 0.013]) {
      for (const t of [0, VOLLEY_REPEAT, 1.234]) {
        let hits = 0;
        let age = 0;
        for (let i = 0; i < Math.ceil(2 / dt); i++) {
          if (crosses({ age, dt }, t)) {
            hits++;
            if (t === 0) expect(i).toBe(0);
          }
          age += dt;
        }
        expect(hits, `t ${String(t)} at dt ${String(dt)}`).toBe(1);
      }
    }
  });
});

describe('the Warden definition', () => {
  it('is a radius-48, 42 HP core (54 at 3-★) on three phases of volleys, lock-ons, spins and ring pulses, resting less each phase', () => {
    expect(DEF).toMatchObject({ name: 'Warden', radius: 48, hp: 42 });
    expect(bossHp(DEF, 3)).toBe(54);
    expect(DEF.phases).toEqual([['turretVolley', 'lockOn'], ['turretVolley', 'spin', 'lockOn'], ['ringPulse', 'turretVolley', 'spin', 'lockOn']]);
    expect(DEF.rest).toEqual([2.0, 1.5, 1.0]);
    expect(ATTACKS.turretVolley.windup).toBe(0.6);
    expect(ATTACKS.lockOn.windup).toBe(0.7);
    expect(ATTACKS.spin.windup).toBe(0.5);
    expect(ATTACKS.ringPulse.windup).toBe(0.7);
  });

  it('guards 3-★', () => {
    expect(galaxyById('3-6').boss).toBe('warden');
  });
});

describe('the Warden\'s turret ring', () => {
  it('holds 14 turrets of radius 16 and 3 HP on 16 slots at radius 120, two opposite slots left open, reaching 136', () => {
    expect(WARDEN_RING).toMatchObject({ slots: 16, gaps: [0, 8], radius: 120, turretRadius: 16, hp: 3, regrowSeconds: 8 });
    const { r } = warden();
    expect(r.view.parts).toHaveLength(14);
    for (const part of r.view.parts) {
      expect(part).toMatchObject({ radius: 16, hp: 3, maxHp: 3 });
      expect(Math.hypot(part.x - r.view.x, part.y - r.view.y)).toBeCloseTo(120, 9);
    }
    expect(r.reach).toBe(136);
    const gaps = ringGaps(r.view).sort((a, b) => a - b);
    // Neighbours leave about 15, under the ship's 20; the two gaps leave about 60, three ships.
    expect(gaps.slice(0, 12).every((g) => g > 14 && g < 16 && g < 2 * PLAYER.radius)).toBe(true);
    expect(gaps.slice(12).every((g) => g > 59 && g < 61)).toBe(true);
  });

  it('turns to a random offset drawn from the boss stream, so the gaps differ by seed', () => {
    const offsets = new Set([1, 2, 3, 4].map((seed) => bearingOf(warden(seed).r.view, warden(seed).r.view.parts[0] as BossPart).toFixed(6)));
    expect(offsets.size).toBe(4);
    const expected = createRng(5).range(0, TAU) + SLOT;
    const { view } = warden(5).r;
    expect(turnBetween(expected, bearingOf(view, view.parts[0] as BossPart))).toBeCloseTo(0, 9);
  });

  it.each([
    { phase: 1, hp: MAX_HP, speed: 0.35 },
    { phase: 2, hp: 45, speed: 0.5 },
    { phase: 3, hp: 20, speed: 0.65 },
  ])('spins at $speed rad/s in phase $phase, between attacks that turn it', ({ hp, speed }) => {
    expect(WARDEN_RING.speeds).toEqual({ 1: 0.35, 2: 0.5, 3: 0.65 });
    const rig = fighting();
    const { r, arena } = rig;
    woundTo(r, hp);
    const turret = r.view.parts[0] as BossPart;
    let before = bearingOf(r.view, turret);
    let turned = 0;
    let steps = 0;
    runFor(stepper(rig), arena, 0.5, () => {
      const now = bearingOf(r.view, turret);
      if (r.view.active !== 'spin' && r.view.active !== 'ringPulse') {
        turned += turnBetween(before, now);
        steps++;
      }
      before = now;
    });
    expect(turned / (steps * STEP_SECONDS)).toBeCloseTo(speed, 6);
  });

  it('keeps both gaps open at least 50 wide at every step, however many turrets break or grow back, on every seed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rig = fighting(seed);
      const rng = createRng(seed * 17);
      let narrowestGap = Infinity;
      let widestShut = 0;
      runFor(stepper(rig), rig.arena, 90, () => {
        breakSome(rig.r, rng);
        if (rig.r.state !== 'fighting') return;
        narrowestGap = Math.min(narrowestGap, wardenGaps(rig.r.view)[0]);
        widestShut = Math.max(widestShut, ...ringGaps(rig.r.view).filter((g) => g < WIDE_GAP));
      });
      expect(narrowestGap, `seed ${String(seed)}`).toBeGreaterThanOrEqual(WIDE_GAP);
      // Every other opening is shut to the ship, or open by the ship and a margin either side: none it might just squeeze through.
      expect(widestShut, `seed ${String(seed)}`).toBeLessThan(2 * PLAYER.radius);
    }
  });

  it('never blocks a straight path out from the core through a gap, by a ship and a margin either side, even pulsing or spinning', () => {
    const rig = fighting(3);
    woundTo(rig.r, 20);
    let checked = 0;
    /** The least room any live turret left beside a path out through a gap, past its own radius. */
    let room = Infinity;
    runFor(stepper(rig), rig.arena, 30, () => {
      const { view } = rig.r;
      for (const gap of wardenGapBearings(view)) {
        const far = { x: view.x + Math.cos(gap) * 400, y: view.y + Math.sin(gap) * 400 };
        for (const part of live(view)) room = Math.min(room, toSegment(part.x, part.y, view.x, view.y, far.x, far.y) - part.radius);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
    expect(room).toBeGreaterThan(PLAYER.radius + PATH_MARGIN);
  });

  it('rotates its gaps the same way for the same seed', () => {
    const track = (seed: number): number[] => {
      const rig = fighting(seed);
      const bearings: number[] = [];
      runFor(stepper(rig), rig.arena, 20, () => bearings.push(wardenGapBearings(rig.r.view)[0]));
      return bearings;
    };
    expect(track(7)).toEqual(track(7));
    expect(track(7)).not.toEqual(track(8));
  });
});

describe('the Warden\'s regrowth', () => {
  it('grows one broken turret back every 8 s, on its own slot, never in a gap', () => {
    const rig = fighting();
    const { r } = rig;
    // Park the ship far off, so no slot is too near it to grow in.
    Object.assign(rig.arena.ship, { x: 60, y: 660 });
    for (const i of [0, 3, 6, 9]) while ((r.view.parts[i] as BossPart).hp > 0) r.hitPart(i, 1);
    const counts: number[] = [];
    /** The nearest any live turret came to a gap slot's bearing. */
    let nearestGap = Infinity;
    runFor(stepper(rig), rig.arena, 40, () => {
      counts.push(live(r.view).length);
      const gaps = wardenGapBearings(r.view);
      for (const part of live(r.view)) for (const gap of gaps) nearestGap = Math.min(nearestGap, Math.abs(turnBetween(gap, bearingOf(r.view, part))));
    });
    expect(nearestGap).toBeGreaterThan(SLOT / 2);
    const regrownAt = counts.flatMap((n, i) => (i > 0 && n > (counts[i - 1] ?? 0) ? [Math.round((i + 1) * STEP_SECONDS)] : []));
    expect(regrownAt).toEqual([8, 16, 24, 32]);
    expect(counts.at(-1)).toBe(14);
    for (const part of r.view.parts) expect(Math.hypot(part.x - r.view.x, part.y - r.view.y)).toBeCloseTo(120, 6);
  });

  it('grows no turret within the safe radius of the ship, and holds one back while the ship sits on its slot\'s path', () => {
    const rig = fighting();
    const { r, arena } = rig;
    // The ship waits just outside the ring, straight below the core, wherever the core drifts.
    const below = Math.PI / 2;
    const park = (): void => {
      Object.assign(arena.ship, { x: r.view.x + Math.cos(below) * (WARDEN_RING.radius + 40), y: r.view.y + Math.sin(below) * (WARDEN_RING.radius + 40) });
    };
    park();
    // Break the turret the ring will have turned to just below the core when it is due to grow back, 8 s on.
    const due = below - WARDEN_RING.speeds[1] * WARDEN_RING.regrowSeconds;
    const parts = r.view.parts;
    const late = parts.reduce((best, p, i) => (Math.abs(turnBetween(due, bearingOf(r.view, p))) < Math.abs(turnBetween(due, bearingOf(r.view, parts[best] as BossPart))) ? i : best), 0);
    while ((parts[late] as BossPart).hp > 0) r.hitPart(late, 1);
    const brokenAt = arena.elapsed();
    const was = parts.map((p) => p.hp);
    const grown: { part: number; at: number; clearance: number }[] = [];
    runFor(stepper(rig), arena, 20, () => {
      parts.forEach((p, i) => {
        if (was[i] === 0 && p.hp === p.maxHp) grown.push({ part: i, at: arena.elapsed(), clearance: Math.hypot(p.x - arena.ship.x, p.y - arena.ship.y) });
        was[i] = p.hp;
      });
      park();
    });
    expect(grown.map((g) => g.part)).toEqual([late]);
    for (const g of grown) expect(g.clearance).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
    // Due at 8 s, it waited for its slot to turn clear of the ship.
    expect((grown[0]?.at ?? 0) - brokenAt).toBeGreaterThan(WARDEN_RING.regrowSeconds + 1);
  });
});

describe('the Warden\'s core', () => {
  it('can always be hurt, yet a shot strikes the turret it meets first', () => {
    const rig = fighting();
    const arena = new BossArena(rig.arena, 3000, (base) => base, () => rig.r);
    arena.step(STEP_SECONDS);
    expect(rig.r.view.vulnerable).toBe(true);
    const turret = rig.r.view.parts[0] as BossPart;
    expect(arena.hitBoss(turret.x, turret.y, 3)).toBe(true);
    expect(turret.hp).toBe(2);
    expect(rig.r.hp).toBe(MAX_HP);
    expect(arena.hitBoss(rig.r.view.x, rig.r.view.y, 3)).toBe(true);
    expect(rig.r.hp).toBe(MAX_HP - 1);
  });

  it('kills the ship that touches a turret or the core', () => {
    const { r } = fighting();
    const turret = r.view.parts[4] as BossPart;
    expect(r.touches(turret.x, turret.y + turret.radius + PLAYER.radius - 1, PLAYER.radius)).toBe(true);
    expect(r.touches(r.view.x, r.view.y, PLAYER.radius)).toBe(true);
    const [gap] = wardenGapBearings(r.view);
    expect(r.touches(r.view.x + Math.cos(gap) * 120, r.view.y + Math.sin(gap) * 120, PLAYER.radius)).toBe(false);
  });

  it('drifts at 10 units a second, keeping the whole ring inside the field, pulses included', () => {
    const rig = fighting(2);
    woundTo(rig.r, 20);
    let moved = 0;
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    runFor(stepper(rig), rig.arena, 60, () => {
      const { view } = rig.r;
      if (view.active === null && view.windup === null) moved = Math.max(moved, Math.hypot(view.x - view.px, view.y - view.py) / STEP_SECONDS);
      for (const p of live(view)) {
        bounds.left = Math.min(bounds.left, p.x - p.radius);
        bounds.top = Math.min(bounds.top, p.y - p.radius);
        bounds.right = Math.max(bounds.right, p.x + p.radius);
        bounds.bottom = Math.max(bounds.bottom, p.y + p.radius);
      }
    });
    expect(moved).toBeCloseTo(10, 6);
    expect(bounds.left).toBeGreaterThanOrEqual(-1e-6);
    expect(bounds.top).toBeGreaterThanOrEqual(-1e-6);
    expect(bounds.right).toBeLessThanOrEqual(BOSS_FIELD.width + 1e-6);
    expect(bounds.bottom).toBeLessThanOrEqual(BOSS_FIELD.height + 1e-6);
  });
});

describe('the Warden\'s attacks', () => {
  it('shows where the ship was as each windup began, which an aimed attack fires at, and stretches it with the field', () => {
    const rig = fighting();
    Object.assign(rig.arena.ship, { x: 900, y: 560 });
    runFor(stepper(rig), rig.arena, 3, () => {
      if (rig.r.view.windup !== null) Object.assign(rig.arena.ship, { x: 100, y: 650 });
    });
    expect(rig.r.view.aim).toEqual({ x: 900, y: 560 });
    rig.r.resize(BOSS_FIELD, { width: 1600, height: 720 });
    expect(rig.r.view.aim).toEqual({ x: rescale(900, 1280, 1600), y: 560 });
  });

  it('runs each phase\'s list in order', () => {
    const order = (hp: number): AttackId[] => {
      const rig = fighting(4);
      woundTo(rig.r, hp);
      return timedOfType(runFor(stepper(rig), rig.arena, 40), 'bossWindup').map((l) => l.event.attack).slice(0, 8);
    };
    expect(order(MAX_HP)).toEqual(['turretVolley', 'lockOn', 'turretVolley', 'lockOn', 'turretVolley', 'lockOn', 'turretVolley', 'lockOn']);
    expect(order(45)).toEqual(['turretVolley', 'spin', 'lockOn', 'turretVolley', 'spin', 'lockOn', 'turretVolley', 'spin']);
    expect(order(20)).toEqual(['ringPulse', 'turretVolley', 'spin', 'lockOn', 'ringPulse', 'turretVolley', 'spin', 'lockOn']);
  });

  it('telegraphs every attack for at least 0.35 s, firing nothing and keeping the ring at its radius and speed meanwhile', () => {
    for (const spec of Object.values(ATTACKS)) expect(spec.windup).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    const rig = fighting();
    woundTo(rig.r, 20);
    const seen = new Map<AttackId, number>();
    let windupSteps = 0;
    const turret = rig.r.view.parts[0] as BossPart;
    let before = bearingOf(rig.r.view, turret);
    runFor(stepper(rig), rig.arena, 30, () => {
      const { view } = rig.r;
      const now = bearingOf(view, turret);
      const turned = turnBetween(before, now) / STEP_SECONDS;
      before = now;
      if (view.windup === null) {
        windupSteps = 0;
        return;
      }
      windupSteps++;
      seen.set(view.windup, Math.max(seen.get(view.windup) ?? 0, windupSteps * STEP_SECONDS));
      expect(ofType(rig.arena.events, 'boltFired'), `${view.windup}: no bolts`).toEqual([]);
      expect(ringRadius(view), `${view.windup}: ring at its radius`).toBeCloseTo(120, 6);
      expect(turned, `${view.windup}: ring at its phase speed`).toBeCloseTo(0.65, 6);
    });
    for (const id of ['turretVolley', 'lockOn', 'spin', 'ringPulse'] as const) expect(seen.get(id) ?? 0, id).toBeGreaterThanOrEqual(ATTACKS[id].windup - 2 * STEP_SECONDS);
  });

  it('fires one bolt outward from every live turret in a volley, twice 0.3 s apart in phase 3', () => {
    /** Each step of the fight's volleys that fired bolts: when, how many, and whether each flew straight out from the core. */
    const volleys = (hp: number): { at: number; bolts: number; outward: boolean }[] => {
      const rig = fighting(2);
      const { r } = rig;
      woundTo(r, hp);
      for (const i of [1, 5]) while ((r.view.parts[i] as BossPart).hp > 0) r.hitPart(i, 1);
      const seen: { at: number; bolts: number; outward: boolean }[] = [];
      runFor(stepper(rig), rig.arena, 12, () => {
        if (r.view.active !== 'turretVolley') return;
        const fired = ofType(rig.arena.events, 'boltFired');
        if (fired.length === 0) return;
        const outward = fired.every((e) => Math.abs(turnBetween(Math.atan2(e.y - r.view.y, e.x - r.view.x), e.angle)) < 1e-9);
        seen.push({ at: rig.arena.elapsed(), bolts: fired.length, outward });
      });
      return seen;
    };
    const one = volleys(MAX_HP);
    expect(one[0]).toMatchObject({ bolts: 12, outward: true });
    expect(one[1]?.at ?? 0).toBeGreaterThan((one[0]?.at ?? 0) + 1);
    const three = volleys(20);
    const [first, second] = three;
    expect(three.every((v) => v.bolts === 12 && v.outward)).toBe(true);
    expect(VOLLEY_REPEAT).toBe(0.3);
    expect((second?.at ?? 0) - (first?.at ?? 0)).toBeCloseTo(0.3, 6);
  });

  it('locks on with the 2 turrets nearest the ship, each firing 3 bolts at where it was as the windup began', () => {
    expect([LOCK_TURRETS, LOCK_BOLTS]).toEqual([2, 3]);
    const rig = fighting();
    Object.assign(rig.arena.ship, { x: 900, y: 560 });
    const aim = { x: 900, y: 560 };
    let fired: { x: number; y: number; angle: number }[] = [];
    let nearest: number[] = [];
    let locking = false;
    runFor(stepper(rig), rig.arena, 8, () => {
      // A lock-on has no active time: it fires on the step after its windup ends, and is over by the end of it.
      if (locking && fired.length === 0) {
        fired = ofType(rig.arena.events, 'boltFired').map((e) => ({ x: e.x, y: e.y, angle: e.angle }));
        // Where the turrets stood as they fired, before the ring's step moved them on.
        nearest = live(rig.r.view).map((p) => Math.hypot(p.px - aim.x, p.py - aim.y)).sort((a, b) => a - b).slice(0, 2);
      }
      locking = rig.r.view.active === 'lockOn';
    });
    expect(fired).toHaveLength(6);
    const sources = [...new Set(fired.map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)}`))];
    expect(sources).toHaveLength(2);
    // The turrets that fired were the two nearest the ship as they fired (it has not moved).
    const distances = sources.map((s) => s.split(',').map(Number)).map(([x = 0, y = 0]) => Math.hypot(x - aim.x, y - aim.y)).sort((a, b) => a - b);
    expect(distances[0]).toBeCloseTo(nearest[0] ?? 0, 3);
    expect(distances[1]).toBeCloseTo(nearest[1] ?? 0, 3);
    for (const source of sources) {
      const fan = fired.filter((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)}` === source);
      expect(fan.some((b) => Math.abs(turnBetween(Math.atan2(aim.y - b.y, aim.x - b.x), b.angle)) < 1e-9), 'one flies straight at the ship').toBe(true);
    }
  });

  it('spins its ring the other way at double speed for 2 s', () => {
    expect([SPIN_FACTOR, SPIN_SECONDS]).toEqual([2, 2]);
    const rig = fighting();
    woundTo(rig.r, 45);
    const turret = rig.r.view.parts[0] as BossPart;
    let before = bearingOf(rig.r.view, turret);
    const rates: number[] = [];
    let spinSteps = 0;
    let spinning = false;
    runFor(stepper(rig), rig.arena, 12, () => {
      const now = bearingOf(rig.r.view, turret);
      // The step that ends the windup shows the spin on, but the spin turns the ring from the next step.
      if (spinning) rates.push(turnBetween(before, now) / STEP_SECONDS);
      spinning = rig.r.view.active === 'spin';
      if (spinning) spinSteps++;
      before = now;
    });
    expect(rates.length).toBeGreaterThan(0);
    for (const rate of rates) expect(rate).toBeCloseTo(-1, 6);
    expect(spinSteps * STEP_SECONDS).toBeCloseTo(SPIN_SECONDS, 1);
  });

  it('pulses its ring out to 220 and back over 2.4 s, stopping short of a wall, declaring the band it sweeps', () => {
    expect([PULSE_RADIUS, PULSE_SECONDS]).toEqual([220, 2.4]);
    expect(ATTACKS.ringPulse.threat).toEqual({ kind: 'ring', radius: 170, reach: 50 + 16, around: 'core' });
    const rig = fighting();
    woundTo(rig.r, 20);
    const radii: number[] = [];
    const rooms: number[] = [];
    runFor(stepper(rig), rig.arena, 6, () => {
      if (rig.r.view.active !== 'ringPulse') return;
      radii.push(ringRadius(rig.r.view));
      rooms.push(stretchRoom(rig.r.view, BOSS_FIELD, WARDEN_RING.radius, WARDEN_RING.turretRadius));
    });
    expect(radii.length * STEP_SECONDS).toBeCloseTo(PULSE_SECONDS, 1);
    // Out to 220, or short of the wall it would cross: the core starts the fight 201.6 below the top.
    const peak = radii.indexOf(Math.max(...radii));
    expect(rooms[peak]).toBeLessThan(PULSE_RADIUS);
    expect(radii[peak]).toBeCloseTo(rooms[peak] ?? 0, 6);
    // With room to spare, mid-field, it reaches the full 220.
    const mid = fighting();
    woundTo(mid.r, 20);
    Object.assign(mid.r.view, { x: 640, y: 360 });
    let widest = 0;
    runFor(stepper(mid), mid.arena, 6, () => {
      if (mid.r.view.active === 'ringPulse') widest = Math.max(widest, ringRadius(mid.r.view));
    });
    expect(widest).toBeCloseTo(PULSE_RADIUS, 1);
    expect(radii.at(-1) ?? 0).toBeLessThan(121);
    expect(ringRadius(rig.r.view)).toBeCloseTo(120, 9);
  });
});

describe('the Warden as the expert bot sees it', () => {
  /** A view of the fight with the ship at `ship`, still, and nothing else on the field. */
  function viewAt(r: BossRunner, ship: { x: number; y: number }) {
    return createView({ field: BOSS_FIELD, status: 'playing', elapsed: 30, ship: { ...stubArena().ship, ...ship, vx: 0, vy: 0 }, asteroids: [], foes: [], bolts: [], pickups: [], boss: r.view, hazards: [] });
  }

  /** The target the bot picks from 300 out along `bearing` from the core, with no choice before it. */
  function pick(r: BossRunner, bearing: number): Target {
    const target: Target = { x: 0, y: 0, vx: 0, vy: 0, wraps: true, weakPoint: false };
    expect(chooseTarget(viewAt(r, { x: r.view.x + Math.cos(bearing) * 300, y: r.view.y + Math.sin(bearing) * 300 }), target)).toBe(true);
    return target;
  }

  it('fires at the core when the line to it passes a gap, and at the nearest turret otherwise', () => {
    const { r } = fighting();
    const [gap] = wardenGapBearings(r.view);
    expect(pick(r, gap)).toMatchObject({ x: r.view.x, y: r.view.y, weakPoint: true });
    const blocked = pick(r, gap + 4 * SLOT);
    const ship = { x: r.view.x + Math.cos(gap + 4 * SLOT) * 300, y: r.view.y + Math.sin(gap + 4 * SLOT) * 300 };
    const nearest = live(r.view).reduce((a, b) => (Math.hypot(a.x - ship.x, a.y - ship.y) <= Math.hypot(b.x - ship.x, b.y - ship.y) ? a : b));
    expect(blocked).toMatchObject({ x: nearest.x, y: nearest.y, weakPoint: false });
  });

  it('judges the line over the shot\'s flight: a turret the ring turns into the line blocks it, though it is clear now', () => {
    const { r } = fighting();
    const [gap] = wardenGapBearings(r.view);
    // The ring turns toward higher bearings, so a line on the low side of the gap is about to be crossed by the turret
    // behind it, and one on the high side stays clear for the flight.
    expect(pick(r, gap + 0.1).weakPoint).toBe(true);
    expect(pick(r, gap - 0.12).weakPoint).toBe(false);
    for (const part of r.view.parts) Object.assign(part, { px: part.x, py: part.y });
    expect(pick(r, gap - 0.12).weakPoint, 'a still ring leaves that line clear').toBe(true);
  });

  it('holds the core through a line it would not switch to: a turret must stand 4 units farther off to win the core back', () => {
    const { r } = fighting();
    for (const part of r.view.parts) Object.assign(part, { px: part.x, py: part.y });
    const [gap] = wardenGapBearings(r.view);
    // A line whose nearer turret stands 2 units clear of a shot: kept, but not switched to.
    const edge = SLOT - Math.asin((WARDEN_RING.turretRadius + 3 + 2) / WARDEN_RING.radius);
    const ship = { x: r.view.x + Math.cos(gap + edge) * 300, y: r.view.y + Math.sin(gap + edge) * 300 };
    const target: Target = { x: 0, y: 0, vx: 0, vy: 0, wraps: true, weakPoint: false };
    chooseTarget(viewAt(r, ship), target);
    expect(target.weakPoint).toBe(false);
    target.weakPoint = true;
    chooseTarget(viewAt(r, ship), target);
    expect(target).toMatchObject({ x: r.view.x, y: r.view.y, weakPoint: true });
  });
});

describe('the Warden in 3-★', () => {
  const calm = (): GalaxyDef => ({ ...galaxyById('3-6'), kinds: MUTED_KINDS, events: [] });
  const world = (seed: number) => new World({ seed, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm(), mode: 'free' } });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws only from the boss stream: its ring offset is that stream\'s first draw, and nothing reads Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    for (const seed of [1, 2]) {
      const w = world(seed);
      while (w.boss === null) w.step(STEP_SECONDS, NO_CONTROLS);
      const boss = w.boss;
      const expected = createRng(deriveSeed(seed, 'boss')).range(0, TAU) + SLOT + WARDEN_RING.speeds[1] * STEP_SECONDS;
      expect(turnBetween(expected, bearingOf(boss, boss.parts[0] as BossPart)), `seed ${String(seed)}`).toBeCloseTo(0, 9);
      for (let i = 0; i < Math.round(30 / STEP_SECONDS); i++) w.step(STEP_SECONDS, NO_CONTROLS);
    }
    expect(random).not.toHaveBeenCalled();
  });

  it('replays exactly for a seed, and differs for another', () => {
    const play = (seed: number): number[] => {
      const w = world(seed);
      const trace: number[] = [];
      for (let i = 0; i < Math.round((APPROACH + INTRO + 30) / STEP_SECONDS); i++) {
        w.step(STEP_SECONDS, NO_CONTROLS);
        for (const b of w.bolts) trace.push(b.x, b.y);
        if (w.boss !== null) for (const p of w.boss.parts) trace.push(p.x, p.y);
      }
      return trace;
    };
    expect(play(4)).toEqual(play(4));
    expect(play(4)).not.toEqual(play(5));
  });

  it('takes a life off a ship that never moves or fires, by its bolts and ring, not on arrival', () => {
    for (const seed of [1, 2, 3]) {
      const w = world(seed);
      const hitsAt: string[] = [];
      for (let i = 0; i < Math.round((APPROACH + INTRO + 120) / STEP_SECONDS) && w.status === 'playing'; i++) {
        for (const e of w.step(STEP_SECONDS, NO_CONTROLS)) if (e.type === 'shipHit') hitsAt.push(w.boss?.state ?? 'none');
      }
      expect(w.boss?.id).toBe('warden');
      expect(w.deaths, `seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
      expect(new Set(hitsAt)).toEqual(new Set(['fighting']));
    }
  });

  it('respawns the ship clear of the ring, by the ship and the safe radius', () => {
    let respawns = 0;
    for (const seed of [1, 2, 3]) {
      const w = world(seed);
      for (let i = 0; i < Math.round((APPROACH + INTRO + 120) / STEP_SECONDS) && w.status === 'playing'; i++) {
        if (!w.step(STEP_SECONDS, NO_CONTROLS).some((e) => e.type === 'shipHit') || w.lives === 0) continue;
        const boss = w.boss;
        if (boss === null) throw new Error('only the Warden hits the ship here');
        expect(respawnClearance(boss, 136, w.ship.x, w.ship.y)).toBeGreaterThanOrEqual(PLAYER.radius + ASTEROID.safeRadius);
        respawns++;
      }
    }
    expect(respawns).toBeGreaterThan(0);
  });

  it('ends the galaxy on the step of the killing blow', () => {
    const w = world(1);
    while (w.boss?.state !== 'fighting') w.step(STEP_SECONDS, NO_CONTROLS);
    const boss = w.boss;
    // A shot for each of its HP, all on the core, through a world's own shots.
    for (let i = 0; i < boss.hp; i++) (w.projectiles as Projectile[]).push(projectileFromShot({ x: boss.x, y: boss.y, vx: 0, vy: 0 }, 9000 + i));
    const events = w.step(STEP_SECONDS, NO_CONTROLS);
    expect(events.filter((e) => e.type === 'bossDown' || e.type === 'galaxyCleared').map((e) => e.type)).toEqual(['bossDown', 'galaxyCleared']);
  });

  it('fires its bolts at the bolts\' own speed, from the pool, and never more than it holds', () => {
    const w = world(2);
    let most = 0;
    for (let i = 0; i < Math.round((APPROACH + INTRO + 60) / STEP_SECONDS) && w.status === 'playing'; i++) {
      w.step(STEP_SECONDS, NO_CONTROLS);
      most = Math.max(most, w.bolts.length);
      for (const b of w.bolts) expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BOLT.speed, 6);
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(BOLT.capacity);
  });
});
