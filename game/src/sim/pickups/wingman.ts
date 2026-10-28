import { PLAYER, WINGMAN } from '../config';
import type { Ship, Shot } from '../ship';

/**
 * Where the Wingman flies from a ship at `at`: `WINGMAN.offset` off its left wing, written into `out`. Its shot starts here
 * and so does its drawn sprite, so the offset has one owner.
 */
export function wingmanPoint(at: Readonly<Pick<Ship, 'x' | 'y' | 'angle'>>, out: { x: number; y: number }): void {
  out.x = at.x + Math.sin(at.angle) * WINGMAN.offset;
  out.y = at.y - Math.cos(at.angle) * WINGMAN.offset;
}

/** Where the Wingman's shot starts; one point, reused. */
const from = { x: 0, y: 0 };

/**
 * The Wingman's shot for the volley `ship` has just fired: from the drone, `WINGMAN.offset` off the ship's left wing,
 * straight along the ship's heading at a ship shot's speed, inheriting the ship's velocity as the ship's own shots do.
 * The drone has no hitbox: nothing in the sim but this shot knows where it is.
 */
export function wingmanShot(ship: Readonly<Ship>): Shot {
  const { angle } = ship;
  wingmanPoint(ship, from);
  return {
    x: from.x,
    y: from.y,
    vx: ship.vx * PLAYER.inheritVelocity + Math.cos(angle) * PLAYER.projectileSpeed,
    vy: ship.vy * PLAYER.inheritVelocity + Math.sin(angle) * PLAYER.projectileSpeed,
  };
}
