import { describe, expect, it } from 'vitest';
import { burstFor, createEffects } from '../../src/render/effects';
import { DEFAULT_PARTICLE_CAPACITY, ParticlePool, type Particle } from '../../src/render/particles';
import { DRIFT } from '../../src/render/palette';
import { PICKUP_COLORS } from '../../src/render/pickupArt';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { World } from '../../src/sim/world';

const THRUST = { ...NO_CONTROLS, thrust: true };
const DESTROYED = (size: 0 | 1 | 2 | 3, points = 20): SimEvent => ({ type: 'asteroidDestroyed', id: 1, x: 300, y: 200, size, points });
const SHIP_HIT: SimEvent = { type: 'shipHit', x: 640, y: 360, livesLeft: 2 };

function makeWorld(): World {
  return new World({ seed: 5, field: { width: 1280, height: 720 } });
}

function kinds(pool: ParticlePool): Record<string, number> {
  const out: Record<string, number> = {};
  pool.forEach((p) => {
    out[p.kind] = (out[p.kind] ?? 0) + 1;
  });
  return out;
}

/** Counts every particle, including ones that were waiting out a delay, by stepping past it. */
function allParticles(pool: ParticlePool): Particle[] {
  const out: Particle[] = [];
  pool.step(0.2);
  pool.forEach((p) => {
    out.push({ ...p });
  });
  return out;
}

function positions(seed: number, withThrust: boolean): number[][] {
  const pool = new ParticlePool(400);
  const fx = createEffects(pool, seed);
  const w = makeWorld();
  fx.handle([DESTROYED(0), SHIP_HIT, { type: 'shot', x: 10, y: 20 }], w);
  if (withThrust) {
    w.step(STEP_SECONDS, THRUST);
    for (let i = 0; i < 20; i++) fx.step(STEP_SECONDS, w);
  }
  const out: number[][] = [];
  pool.forEach((p) => {
    out.push([p.x, p.y, p.vx, p.vy, p.life]);
  });
  return out;
}

describe('burstFor: foes', () => {
  const hurt: SimEvent = { type: 'foeHit', id: 1, x: 10, y: 20, hp: 1 };
  const slain = (kind: 'splitter' | 'drone', points = 100): SimEvent => ({ type: 'foeDestroyed', id: 1, kind, x: 10, y: 20, points });

  it('gives a foe hit the sparks of a boss hit, and a destroyed foe the burst of a rock of its weight', () => {
    expect(burstFor(hurt, DRIFT)).toEqual(burstFor({ type: 'bossHit', x: 0, y: 0, hp: 3 }, DRIFT));
    expect(burstFor(slain('splitter'), DRIFT)).toEqual(burstFor(DESTROYED(1), DRIFT));
    expect(burstFor(slain('drone'), DRIFT)).toEqual(burstFor(DESTROYED(2), DRIFT));
  });

  it('gives a foe the warp cleared or the ship rammed the light puff of a cleared rock', () => {
    expect(burstFor(slain('splitter', 0), DRIFT)).toEqual(burstFor(DESTROYED(0, 0), DRIFT));
  });

  it('keeps arriving foes and the well events silent', () => {
    for (const event of [{ type: 'foeSpawned', id: 1, kind: 'drone', x: 0, y: 0 }, { type: 'wellWarning', x: 0, y: 0, at: 30 }, { type: 'wellStart', id: 1 }, { type: 'wellEnd', id: 1 }] as const) {
      expect(burstFor(event, DRIFT)).toBeNull();
    }
  });

  it('emits particles where a foe was destroyed, from the effects\' own stream', () => {
    const pool = new ParticlePool(400);
    createEffects(pool, 3).handle([slain('splitter')], makeWorld());
    const emitted = allParticles(pool);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.some((p) => Math.abs(p.x - 10) < 40 && Math.abs(p.y - 20) < 40)).toBe(true);
  });
});

describe('burstFor', () => {
  it('matches the burst table for asteroid sizes', () => {
    const pick = (size: 0 | 1 | 2 | 3) => {
      const b = burstFor(DESTROYED(size), DRIFT);
      return b && [b.shards, b.sparks, b.rings, b.smoke, b.shake, b.flash];
    };
    expect(pick(0)).toEqual([12, 18, 1, 6, 5, 0.3]);
    expect(pick(1)).toEqual([9, 14, 1, 4, 3.5, 0.2]);
    expect(pick(2)).toEqual([7, 10, 1, 2, 2, 0]);
    expect(pick(3)).toEqual([5, 8, 1, 0, 1.2, 0]);
  });

  it('never shrinks a burst as the asteroid gets bigger', () => {
    const bursts = ([3, 2, 1, 0] as const).map((s) => burstFor(DESTROYED(s), DRIFT));
    for (const key of ['shards', 'sparks', 'smoke', 'shake', 'flash'] as const) {
      const values = bursts.map((b) => b?.[key] ?? -1);
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
  });

  it('gives a rock the warp clears (0 points) a light puff with no shake or flash, whatever its size', () => {
    const smallest = burstFor(DESTROYED(3), DRIFT);
    for (const size of [0, 1, 2, 3] as const) {
      const warped = burstFor(DESTROYED(size, 0), DRIFT);
      expect(warped).toMatchObject({ rings: 0, smoke: 0, shake: 0, flash: 0 });
      expect((warped?.shards ?? 99) + (warped?.sparks ?? 99)).toBeLessThan((smallest?.shards ?? 0) + (smallest?.sparks ?? 0));
    }
  });

  it('gives a ship hit the biggest burst, tinted red', () => {
    const hit = burstFor(SHIP_HIT, DRIFT);
    expect(hit).toMatchObject({ shards: 16, sparks: 24, rings: 2, smoke: 8, shake: 7, flash: 0.45, flashColor: '#ff5a5a' });
  });

  it('gives a shot a single spark and no shake or flash', () => {
    expect(burstFor({ type: 'shot', x: 0, y: 0 }, DRIFT)).toMatchObject({ shards: 0, sparks: 1, rings: 0, smoke: 0, shake: 0, flash: 0 });
  });

  it('gives a boss hit a small spark burst and no shake or flash', () => {
    expect(burstFor({ type: 'bossHit', x: 0, y: 0, hp: 5 }, DRIFT)).toMatchObject({ shards: 0, sparks: 6, rings: 0, smoke: 0, shake: 0, flash: 0 });
  });

  it('sprays a boss hit\'s sparks from where it struck', () => {
    const pool = new ParticlePool(400);
    createEffects(pool, 1).handle([{ type: 'bossHit', x: 300, y: 200, hp: 5 }], makeWorld());
    const sparks: { x: number; y: number }[] = [];
    pool.forEach((p) => {
      sparks.push({ x: p.x, y: p.y });
    });
    expect(sparks).toHaveLength(6);
    for (const s of sparks) expect(Math.hypot(s.x - 300, s.y - 200)).toBeLessThan(5);
  });

  it('has no burst for game over', () => {
    expect(burstFor({ type: 'gameOver', score: 10 }, DRIFT)).toBeNull();
  });

  it('pops a ring and sparks where a pickup drops, and as one is collected; a lapsed pickup or effect is quiet', () => {
    const drop = burstFor({ type: 'pickupDropped', id: 1, kind: 'shield', x: 0, y: 0 }, DRIFT);
    const take = burstFor({ type: 'pickupCollected', id: 1, kind: 'shield' }, DRIFT);
    for (const burst of [drop, take]) {
      expect(burst?.rings).toBeGreaterThan(0);
      expect(burst?.sparks).toBeGreaterThan(0);
      expect(burst?.shake).toBe(0);
    }
    expect(burstFor({ type: 'pickupExpired', id: 1 }, DRIFT)).toBeNull();
    expect(burstFor({ type: 'effectEnded', kind: 'shield' }, DRIFT)).toBeNull();
  });

  it('shatters the Shield into shards with a little shake when it breaks', () => {
    const burst = burstFor({ type: 'shieldBroken' }, DRIFT);
    expect(burst?.shards).toBeGreaterThan(0);
    expect(burst?.shake).toBeGreaterThan(0);
  });

  it('tints a pickup burst in its kind\'s colour, at the drop and at the ship that collects it', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 2);
    const w = makeWorld();
    fx.handle([{ type: 'pickupDropped', id: 1, kind: 'rapidFire', x: 100, y: 120 }], w);
    const dropped = allParticles(pool);
    expect(new Set(dropped.map((p) => p.color))).toEqual(new Set([PICKUP_COLORS.rapidFire]));
    expect(dropped.find((p) => p.kind === 'ring')).toMatchObject({ x: 100, y: 120 });
    pool.clear();
    fx.handle([{ type: 'pickupCollected', id: 1, kind: 'doubleShot' }, { type: 'shieldBroken' }], w);
    const at = allParticles(pool).filter((p) => p.kind === 'ring');
    expect(at.map((p) => p.color).sort()).toEqual([PICKUP_COLORS.doubleShot, PICKUP_COLORS.shield].sort());
    for (const ring of at) expect(ring).toMatchObject({ x: w.ship.x, y: w.ship.y });
  });

  it('writes into a spec it is given, so one spec serves every event', () => {
    const into = { shards: -1, sparks: -1, rings: -1, smoke: -1, shake: -1, flash: -1, flashColor: '' };
    expect(burstFor(SHIP_HIT, DRIFT, into)).toBe(into);
    expect(burstFor({ type: 'shot', x: 0, y: 0 }, DRIFT, into)).toBe(into);
    expect(into).toEqual({ shards: 0, sparks: 1, rings: 0, smoke: 0, shake: 0, flash: 0, flashColor: DRIFT.shot });
  });
});

describe('createEffects', () => {
  it('emits the table counts for an asteroid kill, with palette colours', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    fx.handle([DESTROYED(0)], makeWorld());
    expect(pool.count).toBe(12 + 18 + 1 + 6);
    const all = allParticles(pool);
    const colours = new Set(all.filter((p) => p.kind === 'spark').map((p) => p.color));
    expect(colours).toEqual(new Set([DRIFT.spark]));
    expect(all.filter((p) => p.kind === 'ring').every((p) => p.color === DRIFT.ring)).toBe(true);
  });

  it('staggers the rings of a ship hit and tints it red', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    fx.handle([SHIP_HIT], makeWorld());
    expect(pool.count).toBe(16 + 24 + 2 + 8);
    expect(kinds(pool).ring).toBe(1);
    const all = allParticles(pool);
    expect(all.filter((p) => p.kind === 'ring')).toHaveLength(2);
    expect(all.filter((p) => p.kind === 'spark').every((p) => p.color === '#ff5a5a')).toBe(true);
    expect(fx.flashColor).toBe('#ff5a5a');
  });

  it('kicks shake and flash, which decay to rest', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    expect(Math.hypot(fx.shakeX, fx.shakeY)).toBeGreaterThan(0.5);
    expect(fx.flash).toBeGreaterThan(0.3);
    expect(fx.flash).toBeLessThanOrEqual(0.45);
    for (let t = 0; t < 1.5; t += 1 / 60) fx.step(1 / 60, w);
    expect(Object.is(fx.shakeX, 0)).toBe(true);
    expect(Object.is(fx.shakeY, 0)).toBe(true);
    expect(fx.flash).toBe(0);
  });

  it('reports a shake of exactly 0, never -0, before any burst', () => {
    const fx = createEffects(new ParticlePool(10), 1);
    const w = makeWorld();
    for (let i = 0; i < 40; i++) {
      fx.step(1 / 60, w);
      expect([Object.is(fx.shakeX, 0), Object.is(fx.shakeY, 0)]).toEqual([true, true]);
    }
  });

  it('does not stack simultaneous shake beyond the largest burst', () => {
    const pool = new ParticlePool(2000);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    fx.handle(Array.from({ length: 10 }, () => SHIP_HIT), w);
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      fx.step(0.005, w);
      peak = Math.max(peak, Math.abs(fx.shakeX), Math.abs(fx.shakeY));
    }
    expect(peak).toBeLessThanOrEqual(7);
    expect(peak).toBeGreaterThan(5);
  });

  it('zeroes the flash in reduced motion but still emits particles', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    fx.reducedMotion = true;
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    expect(pool.count).toBeGreaterThan(40);
    expect(fx.flash).toBe(0);
  });

  it('clears a running flash when reduced motion is switched on, leaving the shake to its own gate', () => {
    const fx = createEffects(new ParticlePool(200), 1);
    const w = makeWorld();
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    fx.reducedMotion = true;
    expect(fx.reducedMotion).toBe(true);
    expect(fx.flash).toBe(0);
    expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBeGreaterThan(0);
  });

  it('shakes under reduced motion while the shake gate is on: an explicit choice', () => {
    const fx = createEffects(new ParticlePool(200), 1);
    fx.reducedMotion = true;
    fx.shakeEnabled = true;
    fx.handle([SHIP_HIT], makeWorld());
    fx.step(0.016, makeWorld());
    expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBeGreaterThan(0);
    expect(fx.flash).toBe(0);
  });

  it('drops only the shake when the shake gate is off: flash and particles stay', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    expect(fx.shakeEnabled).toBe(true);
    fx.shakeEnabled = false;
    fx.handle([SHIP_HIT], w);
    expect(fx.shakeEnabled).toBe(false);
    expect([fx.shakeX, fx.shakeY]).toEqual([0, 0]);
    expect(fx.flash).toBeGreaterThan(0);
    expect(pool.count).toBeGreaterThan(40);
  });

  it('clears a running shake at once when the shake gate is switched off, and shakes again when it is back on', () => {
    const fx = createEffects(new ParticlePool(200), 1);
    const w = makeWorld();
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBeGreaterThan(0);
    fx.shakeEnabled = false;
    expect([fx.shakeX, fx.shakeY]).toEqual([0, 0]);
    expect(fx.flash).toBeGreaterThan(0);
    fx.shakeEnabled = true;
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBeGreaterThan(0);
  });

  it('emits no burst for game over', () => {
    const pool = new ParticlePool(50);
    const fx = createEffects(pool, 1);
    fx.handle([{ type: 'gameOver', score: 3 }], makeWorld());
    expect(pool.count).toBe(0);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    expect(positions(11, true)).toEqual(positions(11, true));
    expect(positions(11, true)).not.toEqual(positions(12, true));
  });

  it('trails flame behind a thrusting ship at a rate proportional to dt', () => {
    const pool = new ParticlePool(2000);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    fx.step(0.2, w);
    expect(pool.count).toBe(0);
    w.step(STEP_SECONDS, THRUST);
    expect(w.ship.thrusting).toBe(true);
    for (let i = 0; i < 12; i++) fx.step(1 / 60, w);
    expect(pool.count).toBeGreaterThanOrEqual(11);
    expect(pool.count).toBeLessThanOrEqual(12);
    const behind = (p: Readonly<Particle>) => (p.x - w.ship.x) * Math.cos(w.ship.angle) + (p.y - w.ship.y) * Math.sin(w.ship.angle);
    pool.forEach((p) => {
      expect(['glow', 'spark']).toContain(p.kind);
      expect(behind(p)).toBeLessThan(0);
    });
    for (let i = 0; i < 24; i++) fx.step(1 / 120, w);
    expect(pool.count).toBeGreaterThanOrEqual(22);
    expect(pool.count).toBeLessThanOrEqual(24);
  });

  it('trails nothing while frozen by hit-stop, and resumes without a catch-up burst', () => {
    const pool = new ParticlePool(2000);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    w.step(STEP_SECONDS, THRUST);
    for (let i = 0; i < 12; i++) fx.step(1 / 60, w, true);
    expect(pool.count).toBe(0);
    fx.step(1 / 60, w);
    expect(pool.count).toBeLessThanOrEqual(1);
  });

  it('runs the full trail rate from the default pool size up', () => {
    const run = (capacity: number) => {
      const pool = new ParticlePool(capacity);
      const fx = createEffects(pool, 1);
      const w = makeWorld();
      w.step(STEP_SECONDS, THRUST);
      for (let i = 0; i < 30; i++) fx.step(1 / 60, w);
      return pool.count;
    };
    expect(run(DEFAULT_PARTICLE_CAPACITY)).toBe(run(4000));
  });

  it('emits fewer trail particles from a smaller pool', () => {
    const run = (capacity: number) => {
      const pool = new ParticlePool(capacity);
      const fx = createEffects(pool, 1);
      const w = makeWorld();
      w.step(STEP_SECONDS, THRUST);
      for (let i = 0; i < 30; i++) fx.step(1 / 60, w);
      return pool.count;
    };
    expect(run(60)).toBeLessThan(run(1000));
  });

  it('never mutates the world', () => {
    const pool = new ParticlePool(500);
    const fx = createEffects(pool, 3);
    const w = makeWorld();
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) events.push(...w.step(STEP_SECONDS, { ...THRUST, fire: true }));
    events.push(DESTROYED(0), SHIP_HIT, { type: 'gameOver', score: 9 });
    const view = () =>
      JSON.stringify({ ship: w.ship, asteroids: w.asteroids, projectiles: w.projectiles, score: w.score, lives: w.lives, status: w.status, elapsed: w.elapsed, field: w.field });
    const before = view();
    fx.handle(events, w);
    for (let i = 0; i < 30; i++) fx.step(1 / 60, w);
    expect(view()).toBe(before);
  });
});
