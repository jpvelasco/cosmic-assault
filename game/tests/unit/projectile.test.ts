import { describe, expect, it } from 'vitest';
import { PROJECTILE, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { projectileFromShot, stepProjectile, type Projectile } from '../../src/sim/projectile';

const FIELD: Field = { width: 1280, height: 720 };

function stepFor(p: Projectile, steps: number): boolean {
  let alive = true;
  for (let i = 0; i < steps; i++) {
    alive = stepProjectile(p, STEP_SECONDS, FIELD);
  }
  return alive;
}

describe('projectileFromShot', () => {
  it('copies the shot and starts with the full lifespan', () => {
    const p = projectileFromShot({ x: 1, y: 2, vx: 3, vy: 4 });
    expect(p).toEqual({ id: 0, x: 1, y: 2, vx: 3, vy: 4, px: 1, py: 2, life: PROJECTILE.lifespan });
    expect(p.life).toBe(1.2);
  });
});

describe('stepProjectile', () => {
  it('moves by velocity times dt', () => {
    const p = projectileFromShot({ x: 100, y: 200, vx: 450, vy: -90 });
    expect(stepProjectile(p, 0.1, FIELD)).toBe(true);
    expect(p.x).toBeCloseTo(145, 9);
    expect(p.y).toBeCloseTo(191, 9);
  });

  it('wraps past the margin on both axes', () => {
    const right = projectileFromShot({ x: FIELD.width + WRAP_MARGIN - 1, y: 10, vx: 600, vy: 0 });
    stepProjectile(right, 0.01, FIELD);
    expect(right.x).toBe(-WRAP_MARGIN);

    const up = projectileFromShot({ x: 10, y: -WRAP_MARGIN + 1, vx: 0, vy: -600 });
    stepProjectile(up, 0.01, FIELD);
    expect(up.y).toBe(FIELD.height + WRAP_MARGIN);
  });

  it('does not wrap inside the margin', () => {
    const p = projectileFromShot({ x: -WRAP_MARGIN + 10, y: 10, vx: -100, vy: 0 });
    stepProjectile(p, 0.01, FIELD);
    expect(p.x).toBeCloseTo(-WRAP_MARGIN + 9, 9);
  });

  it('is still alive after 142 and 143 real steps (1.183 s, 1.192 s)', () => {
    const p = projectileFromShot({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(stepFor(p, 142)).toBe(true);
    expect(stepFor(p, 1)).toBe(true);
  });

  it('is gone after 144 real steps (1.2 s) despite float residue', () => {
    const p = projectileFromShot({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(stepFor(p, 143)).toBe(true);
    expect(stepFor(p, 1)).toBe(false);
  });

  it('stays gone after 1.2 s', () => {
    const p = projectileFromShot({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(stepFor(p, 150)).toBe(false);
  });

  it('expires at exactly the lifespan in one step', () => {
    const p = projectileFromShot({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(stepProjectile(p, PROJECTILE.lifespan, FIELD)).toBe(false);
  });
});
