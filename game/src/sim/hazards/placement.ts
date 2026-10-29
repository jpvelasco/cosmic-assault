import type { Field } from '../field';
import type { Point } from '../math';
import { zoneClearance, zoneKeepOutBoxes, type ZoneBox } from './dangerZone';
import type { Circle } from './hazard';

// Where a point hazard (a rift mouth, a storm's well) may be placed: the spots of a grid clear of the field's edges,
// the keep-out circles and the HUD and thumb corners.

/** The step of the grid placed point hazards search, in field units: fine enough to find a spot on any field the game plays at. */
const SPOT_STEP = 10;

/** How far (x, y) lies outside the nearest of the HUD and thumb corner `boxes`; negative inside one. */
export function cornerClearance(field: Field, boxes: readonly ZoneBox[], x: number, y: number): number {
  let clearance = Infinity;
  for (const box of boxes) clearance = Math.min(clearance, zoneClearance(field, box, x, y));
  return clearance;
}

/** What a spot for a placed point hazard keeps clear of: the field's edges by `inset`, each keep-out circle by its radius and `reach`, the corners by `corners`. */
export interface SpotRule {
  readonly inset: number;
  readonly reach: number;
  readonly corners: number;
}

/** A spot `clearSpots` found, and its clearance from the nearest HUD or thumb corner box. */
export type ClearSpot = Point & { readonly clearance: number };

/** The points of a `SPOT_STEP` grid over `field` that keep `rule` clear of the edges, `circles` and the HUD and thumb corners, row by row from the top. */
export function clearSpots(field: Field, circles: readonly Circle[], { inset, reach, corners }: SpotRule): ClearSpot[] {
  const boxes = zoneKeepOutBoxes(field);
  const spots: ClearSpot[] = [];
  for (let y = inset; y <= field.height - inset; y += SPOT_STEP) {
    for (let x = inset; x <= field.width - inset; x += SPOT_STEP) {
      if (circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + reach)) continue;
      const clearance = cornerClearance(field, boxes, x, y);
      if (clearance >= corners) spots.push({ x, y, clearance });
    }
  }
  return spots;
}
