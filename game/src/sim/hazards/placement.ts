import type { Field } from '../field';
import type { Point } from '../math';
import { GRID_STEP, zoneClearance, zoneKeepOutBoxes, type ZoneBox } from './dangerZone';
import type { Circle } from './hazard';

// Where a point hazard (a rift mouth, a storm's well) may be placed: the spots of a grid clear of the field's edges,
// the keep-out circles and the HUD and thumb corners.

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

/** How far (x, y) lies outside the HUD and thumb corners `boxes` if it keeps `rule` clear of `circles` and them; null if it does not. */
function spotClearance(field: Field, boxes: readonly ZoneBox[], circles: readonly Circle[], { reach, corners }: SpotRule, x: number, y: number): number | null {
  if (circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + reach)) return null;
  const clearance = cornerClearance(field, boxes, x, y);
  return clearance >= corners ? clearance : null;
}

/** The points of a `GRID_STEP` grid over `field` that keep `rule` clear of the edges, `circles` and the HUD and thumb corners, row by row from the top. */
export function clearSpots(field: Field, circles: readonly Circle[], rule: SpotRule): ClearSpot[] {
  const boxes = zoneKeepOutBoxes(field);
  const { inset } = rule;
  const spots: ClearSpot[] = [];
  for (let y = inset; y <= field.height - inset; y += GRID_STEP) {
    for (let x = inset; x <= field.width - inset; x += GRID_STEP) {
      const clearance = spotClearance(field, boxes, circles, rule, x, y);
      if (clearance !== null) spots.push({ x, y, clearance });
    }
  }
  return spots;
}

/** Whether `spot`, anywhere in `field` and not only on the grid, keeps `rule` clear of the edges, `circles` and the HUD and thumb corners, as `clearSpots` judges its points. */
export function isClearSpot(field: Field, circles: readonly Circle[], rule: SpotRule, spot: Readonly<Point>): boolean {
  const { inset } = rule;
  const inside = spot.x >= inset && spot.x <= field.width - inset && spot.y >= inset && spot.y <= field.height - inset;
  return inside && spotClearance(field, zoneKeepOutBoxes(field), circles, rule, spot.x, spot.y) !== null;
}
