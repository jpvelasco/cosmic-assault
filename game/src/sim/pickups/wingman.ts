import { PLAYER, WINGMAN } from '../config';
import type { Ship, Shot } from '../ship';

/**
 * The Wingman's shot for the volley `ship` has just fired: from the drone, `WINGMAN.offset` off the ship's left wing,
 * straight along the ship's heading at a ship shot's speed, inheriting the ship's velocity as the ship's own shots do.
 * The drone has no hitbox: nothing in the sim but this shot knows where it is.
 */
export function wingmanShot(ship: Readonly<Ship>): Shot {
  const { angle } = ship;
  return {
    x: ship.x + Math.sin(angle) * WINGMAN.offset,
    y: ship.y - Math.cos(angle) * WINGMAN.offset,
    vx: ship.vx * PLAYER.inheritVelocity + Math.cos(angle) * PLAYER.projectileSpeed,
    vy: ship.vy * PLAYER.inheritVelocity + Math.sin(angle) * PLAYER.projectileSpeed,
  };
}
