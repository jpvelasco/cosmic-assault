import { GRAVITY_STORM, stormWells, WELL_RADIUS } from '../../content/hazards';
import { clearSpots, type ClearSpot } from './placement';
import type { WellLayout, WellSpot } from './forceField';
import type { HazardSetup } from './hazard';

/**
 * The clearances from the HUD and thumb corners a storm's well is placed at, most preferred first: its drawn radius, so its
 * art stays out from under them, then half of it. A well with room on neither takes the clearest spot left.
 */
const CORNER_RUNGS: readonly number[] = [WELL_RADIUS, WELL_RADIUS / 2];

/**
 * A gravity storm's wells: `baseWells` plus the event's intensity, at most `maxWells`, each a gravity well of intensity 1,
 * from the storm's own stream. Each sits on the shared grid its drawn radius inside the field, clear of every keep-out circle
 * (the centre, the spot a respawn takes, the ship) and of the corner boxes, and at least `spacing` of the field's width
 * from the others; it is picked at random among the free spots on the first corner rung that has one, else it takes the
 * clearest free spot. A storm places fewer wells where the keep-outs leave no room.
 */
export function stormLayout({ rng, keepOuts }: Pick<HazardSetup, 'rng' | 'keepOuts'>): WellLayout {
  return (event, field) => {
    const candidates = clearSpots(field, keepOuts(field), { inset: WELL_RADIUS, reach: 0, corners: 0 });
    const apart = GRAVITY_STORM.spacing * field.width;
    const wells: WellSpot[] = [];
    const count = stormWells(event.intensity);
    while (wells.length < count) {
      const free = candidates.filter((c) => wells.every((w) => Math.hypot(c.x - w.x, c.y - w.y) >= apart));
      const rung = CORNER_RUNGS.map((least) => free.filter((c) => c.clearance >= least)).find((spots) => spots.length > 0);
      const spot = rung === undefined ? clearest(free) : rng.pick(rung);
      if (spot === undefined) break;
      wells.push({ type: 'gravityWell', x: spot.x, y: spot.y, intensity: 1, storm: true });
    }
    return wells;
  };
}

/** The spot of `candidates` clearest of the corners, the first found among equals; undefined if there is none. */
function clearest(candidates: readonly ClearSpot[]): ClearSpot | undefined {
  let best: ClearSpot | undefined;
  for (const c of candidates) if (best === undefined || c.clearance > best.clearance) best = c;
  return best;
}
