import { describe, expect, it } from 'vitest';
import { ParticlePool, type Particle } from '../../src/render/particles';

function snapshot(pool: ParticlePool): Particle[] {
  const out: Particle[] = [];
  pool.forEach((p) => {
    out.push({ ...p });
  });
  return out;
}

function emitAt(pool: ParticlePool, x: number, life = 1, opts?: Parameters<ParticlePool['emit']>[8]): void {
  pool.emit('spark', x, 0, 0, 0, life, 2, '#ffffff', opts);
}

describe('ParticlePool', () => {
  it('rejects a capacity below 1 or a fractional one, saying what to pass', () => {
    expect(() => new ParticlePool(0)).toThrow(/capacity of at least 1/);
    expect(() => new ParticlePool(2.5)).toThrow(RangeError);
    const pool = new ParticlePool(4);
    expect(() => {
      pool.setCapacity(0);
    }).toThrow(RangeError);
  });

  it('overwrites the oldest particle at capacity and never exceeds it', () => {
    const pool = new ParticlePool(3);
    for (let x = 1; x <= 5; x++) emitAt(pool, x);
    expect(pool.count).toBe(3);
    expect(snapshot(pool).map((p) => p.x)).toEqual([3, 4, 5]);
  });

  it('compacts expired particles out, keeping order', () => {
    const pool = new ParticlePool(8);
    emitAt(pool, 1, 0.1);
    emitAt(pool, 2, 1);
    emitAt(pool, 3, 0.1);
    emitAt(pool, 4, 1);
    pool.step(0.2);
    expect(pool.count).toBe(2);
    expect(snapshot(pool).map((p) => p.x)).toEqual([2, 4]);
  });

  it('holds a delayed particle invisible and un-aged until the delay elapses', () => {
    const pool = new ParticlePool(4);
    pool.emit('ring', 0, 0, 10, 0, 1, 5, '#fff', { delay: 0.5 });
    expect(snapshot(pool)).toEqual([]);
    pool.step(0.25);
    expect(snapshot(pool)).toEqual([]);
    pool.step(0.25);
    const [p] = snapshot(pool);
    expect(p?.life).toBe(1);
    expect(p?.x).toBe(0);
    pool.step(0.5);
    expect(snapshot(pool)[0]?.life).toBeCloseTo(0.5, 9);
    expect(snapshot(pool)[0]?.x).toBeGreaterThan(0);
  });

  it('decays velocity as drag^dt', () => {
    const pool = new ParticlePool(2);
    pool.emit('shard', 0, 0, 100, -40, 5, 2, '#fff', { drag: 0.25 });
    pool.step(0.5);
    const [p] = snapshot(pool);
    expect(p?.vx).toBeCloseTo(100 * 0.25 ** 0.5, 9);
    expect(p?.vy).toBeCloseTo(-40 * 0.25 ** 0.5, 9);
  });

  it('advances position, rotation and age', () => {
    const pool = new ParticlePool(2);
    pool.emit('shard', 1, 2, 10, 20, 2, 3, '#fff', { spin: 4, rot: 1 });
    pool.step(0.5);
    const [p] = snapshot(pool);
    expect(p).toMatchObject({ x: 6, y: 12, rot: 3, life: 1.5, max: 2, drag: 1 });
  });

  it('reuses its Particle objects once full', () => {
    const pool = new ParticlePool(3);
    for (let x = 0; x < 3; x++) emitAt(pool, x);
    const seen = new Set<Readonly<Particle>>();
    pool.forEach((p) => {
      seen.add(p);
    });
    for (let x = 3; x < 20; x++) emitAt(pool, x);
    pool.step(0.1);
    const after = new Set<Readonly<Particle>>();
    pool.forEach((p) => {
      after.add(p);
    });
    expect(after.size).toBe(3);
    for (const p of after) expect(seen.has(p)).toBe(true);
  });

  it('keeps the newest particles when the capacity shrinks', () => {
    const pool = new ParticlePool(5);
    for (let x = 1; x <= 5; x++) emitAt(pool, x);
    pool.setCapacity(2);
    expect(pool.capacity).toBe(2);
    expect(snapshot(pool).map((p) => p.x)).toEqual([4, 5]);
    emitAt(pool, 6);
    expect(snapshot(pool).map((p) => p.x)).toEqual([5, 6]);
  });

  it('grows without losing particles', () => {
    const pool = new ParticlePool(2);
    emitAt(pool, 1);
    emitAt(pool, 2);
    emitAt(pool, 3);
    pool.setCapacity(4);
    emitAt(pool, 4);
    emitAt(pool, 5);
    expect(snapshot(pool).map((p) => p.x)).toEqual([2, 3, 4, 5]);
  });

  it('stays ordered after a wrapped ring is compacted and refilled', () => {
    const pool = new ParticlePool(4);
    for (let x = 1; x <= 6; x++) emitAt(pool, x, x % 2 === 0 ? 0.1 : 1);
    pool.step(0.2);
    expect(snapshot(pool).map((p) => p.x)).toEqual([3, 5]);
    emitAt(pool, 7);
    emitAt(pool, 8);
    emitAt(pool, 9);
    expect(snapshot(pool).map((p) => p.x)).toEqual([5, 7, 8, 9]);
  });
});
