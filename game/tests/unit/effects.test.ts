import { describe, expect, it } from 'vitest';
import { burstFor, createEffects } from '../../src/render/effects';
import { ParticlePool, type Particle } from '../../src/render/particles';
import { DRIFT } from '../../src/render/palette';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { World } from '../../src/sim/world';

const THRUST = { ...NO_CONTROLS, thrust: true };
const DESTROYED = (size: 0 | 1 | 2 | 3): SimEvent => ({ type: 'asteroidDestroyed', id: 1, x: 300, y: 200, size, points: 20 });
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

  it('gives a ship hit the biggest burst, tinted red', () => {
    const hit = burstFor(SHIP_HIT, DRIFT);
    expect(hit).toMatchObject({ shards: 16, sparks: 24, rings: 2, smoke: 8, shake: 7, flash: 0.45, flashColor: '#ff5a5a' });
  });

  it('gives a shot a single spark and no shake or flash', () => {
    expect(burstFor({ type: 'shot', x: 0, y: 0 }, DRIFT)).toMatchObject({ shards: 0, sparks: 1, rings: 0, smoke: 0, shake: 0, flash: 0 });
  });

  it('has no burst for game over', () => {
    expect(burstFor({ type: 'gameOver', score: 10 }, DRIFT)).toBeNull();
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

  it('zeroes shake and flash in reduced motion but still emits particles', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    fx.reducedMotion = true;
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    expect(pool.count).toBeGreaterThan(40);
    expect([fx.shakeX, fx.shakeY, fx.flash]).toEqual([0, 0, 0]);
  });

  it('clears running shake and flash when reduced motion is switched on', () => {
    const pool = new ParticlePool(200);
    const fx = createEffects(pool, 1);
    const w = makeWorld();
    fx.handle([SHIP_HIT], w);
    fx.step(0.016, w);
    fx.reducedMotion = true;
    expect(fx.reducedMotion).toBe(true);
    expect([fx.shakeX, fx.shakeY, fx.flash]).toEqual([0, 0, 0]);
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
