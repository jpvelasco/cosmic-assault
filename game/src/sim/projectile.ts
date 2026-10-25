import { PROJECTILE } from './config';
import type { Field } from './field';
import type { Shot } from './ship';
import { wrapPosition } from './wrap';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Absorbs float residue from summing many dt steps so a full lifespan always expires. */
const LIFE_EPSILON = 1e-9;

export function projectileFromShot(shot: Shot): Projectile {
  return { x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, life: PROJECTILE.lifespan };
}

/** Moves, ages, then wraps like the live game; returns false once the projectile has expired. */
export function stepProjectile(p: Projectile, dt: number, field: Field): boolean {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.life -= dt;
  wrapPosition(p, field);
  return p.life > LIFE_EPSILON;
}
