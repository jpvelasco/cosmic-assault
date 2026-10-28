import { PROJECTILE } from './config';
import type { Field } from './field';
import type { Shot } from './ship';
import { wrapPosition } from './wrap';

export interface Projectile {
  /** Assigned by `World` from one counter shared with asteroids; 0 outside a World. */
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Position before the latest `World.step`, for interpolated drawing. `px`/`py` are the raw position
   * before the latest step; not wrap-adjusted — a renderer must not interpolate across a wrap.
   */
  px: number;
  py: number;
  life: number;
  /** How many more rocks and foes it passes through; 0 for a shot that the next one stops. */
  pierce: number;
  /** Whether it turns toward the nearest target ahead (Homing Missiles). */
  readonly homing: boolean;
  /**
   * The ids of the rocks and foes it has struck and passed through, so it never strikes one twice. Every shot starts on
   * `NONE_STRUCK`; a piercing shot that passes through one gets a new list with its id added.
   */
  struck: readonly number[];
}

/** The one frozen empty list of ids struck: every new shot's, and what a strike skips when it is given none. */
export const NONE_STRUCK: readonly number[] = Object.freeze([]);

/** Absorbs float residue from summing many dt steps so a full lifespan always expires. */
const LIFE_EPSILON = 1e-9;

/** A projectile flying from `shot`; by default it neither pierces nor homes, as every shot does without a Piercing Beam or Homing Missiles. */
export function projectileFromShot(shot: Shot, id = 0, pierce = 0, homing = false): Projectile {
  return { id, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, px: shot.x, py: shot.y, life: PROJECTILE.lifespan, pierce, homing, struck: NONE_STRUCK };
}

/** Moves, ages, then wraps like the live game; returns false once the projectile has expired. */
export function stepProjectile(p: Projectile, dt: number, field: Field): boolean {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.life -= dt;
  wrapPosition(p, field);
  return p.life > LIFE_EPSILON;
}
