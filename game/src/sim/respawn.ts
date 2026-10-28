import type { Point } from './boss/behaviour';
import { ASTEROID, PLAYER } from './config';
import type { Field } from './field';
import { zoneClearance, type ZoneBox } from './hazards/dangerZone';

// Where a lost ship comes back when something holds the field's centre: a boss, or a black hole and what gathers round
// it. The search keeps a respawn clear of every body it is given, in the band a respawn may take.

/** How far inside the field's edges a ship respawns clear of a boss or a hole. */
export const RESPAWN_INSET = 60;
/**
 * The lowest a ship respawns, as a share of the field height: above the band the HUD's boss bar sits in along the bottom
 * (render/hud.ts), on every screen.
 */
export const RESPAWN_LOWEST_SHARE = 0.8;
/** How far outside everything it keeps clear of a respawn lands: a ship's radius and its safe radius. */
export const RESPAWN_MARGIN = PLAYER.radius + ASTEROID.safeRadius;

/** A round body a respawn keeps clear of by its own radius, while it has HP left if it has HP at all. */
export type RespawnPart = Readonly<{ x: number; y: number; radius: number; hp?: number }>;

/**
 * What a respawn keeps clear of, as its reach is measured: a core (a boss's, or a black hole), the round parts about it
 * (a boss's parts, the foes round a hole, rift mouths) and any danger zones. Only the live parts count.
 */
export type RespawnBodies = Readonly<Point> & {
  readonly parts?: readonly RespawnPart[];
  /** Kept clear of as they strike, across the wrap. */
  readonly zones?: readonly ZoneBox[];
};

/**
 * How far (x, y) lies outside the bodies: outside the circle of `reach` about the core, and outside every live part by
 * that part's own radius, whichever is nearer. Negative inside either. A part that trails far beyond the core's reach,
 * a serpent's tail say, counts as much as the core. Zones need the field and are `clearSpot`'s to measure.
 */
export function respawnClearance(bodies: RespawnBodies, reach: number, x: number, y: number): number {
  let clearance = Math.hypot(x - bodies.x, y - bodies.y) - reach;
  for (const part of bodies.parts ?? []) {
    if (part.hp === undefined || part.hp > 0) clearance = Math.min(clearance, Math.hypot(x - part.x, y - part.y) - part.radius);
  }
  return clearance;
}

/** The grid a respawn searches when none of its preferred spots is clear: columns and rows across the respawn band. */
const RESPAWN_GRID_COLUMNS = 9;
const RESPAWN_GRID_ROWS = 6;

/** The respawn band: inside the field's edges by `RESPAWN_INSET`, and no lower than `RESPAWN_LOWEST_SHARE` of the height. */
export function respawnBand(field: Field): Readonly<{ left: number; right: number; top: number; bottom: number }> {
  return { left: RESPAWN_INSET, right: field.width - RESPAWN_INSET, top: RESPAWN_INSET, bottom: field.height * RESPAWN_LOWEST_SHARE };
}

/**
 * Where a ship can respawn at least `margin` outside the bodies (`respawnClearance`, and every zone): the first clear spot
 * of `prefer`, by default low in the middle, at `RESPAWN_LOWEST_SHARE` of the height, or, if the core lies too near it,
 * the corner farthest from the core, as low or as near the top, or, if a part lies on that too, the first other corner
 * that is clear. If none of those is, the first clear point of a grid across the respawn band, row by row from the
 * bottom, as low as the usual spots prefer; else, with nowhere clear, the clearest spot of all, the first found among
 * equals, so a respawn is always the same for the same bodies.
 */
export function clearSpot(bodies: RespawnBodies, reach: number, field: Field, margin = 0, prefer: readonly Point[] = usualSpots(bodies, field)): Point {
  const { left, right, top, bottom } = respawnBand(field);
  let best: Point = { x: field.width / 2, y: bottom };
  let bestClearance = -Infinity;
  /** Whether `spot` is clear by `margin`, noting it if it is the clearest yet. */
  const clear = (spot: Point): boolean => {
    let clearance = respawnClearance(bodies, reach, spot.x, spot.y);
    for (const zone of bodies.zones ?? []) clearance = Math.min(clearance, zoneClearance(field, zone, spot.x, spot.y));
    if (clearance > bestClearance) [best, bestClearance] = [spot, clearance];
    return clearance >= margin;
  };
  for (const spot of prefer) if (clear(spot)) return spot;
  for (let row = RESPAWN_GRID_ROWS - 1; row >= 0; row--) {
    for (let column = 0; column < RESPAWN_GRID_COLUMNS; column++) {
      const spot = { x: left + ((right - left) * column) / (RESPAWN_GRID_COLUMNS - 1), y: top + ((bottom - top) * row) / (RESPAWN_GRID_ROWS - 1) };
      if (clear(spot)) return spot;
    }
  }
  return best;
}

/** The usual respawn spots round a core: low in the middle, then the corners, the one farthest from it first. */
function usualSpots(core: Readonly<Point>, field: Field): Point[] {
  const { left, right, top, bottom } = respawnBand(field);
  const farX = Math.abs(core.x - left) > Math.abs(core.x - right) ? left : right;
  const farY = Math.abs(core.y - top) > Math.abs(core.y - bottom) ? top : bottom;
  return [{ x: field.width / 2, y: bottom }, { x: farX, y: farY }, { x: left + right - farX, y: farY }, { x: farX, y: top + bottom - farY }, { x: left + right - farX, y: top + bottom - farY }];
}
