import { FORCE_SIGN, isForceKind, MAX_SHIP_PULL } from '../../content/hazards';
import { forceShare } from './forceField';
import type { HazardState } from './hazard';
import { holeShare } from './blackHole';

/** A velocity change (or, over a dt of 1, an acceleration) on the ship. */
export interface ShipPull {
  x: number;
  y: number;
}

/**
 * Fills `out` with the velocity change over `dt` every active hazard in `states` pulls a ship at (x, y) by, summed,
 * its size capped at `MAX_SHIP_PULL · dt` so stacked hazards never trap a thrusting ship; for a dt of 1, the
 * acceleration. The single owner of the ship's pull: the hazard field nudges the ship by it, and the expert bot
 * predicts with it. A hazard type that pulls the ship adds its case here.
 */
export function shipPullAt(states: readonly Readonly<HazardState>[], x: number, y: number, dt: number, out: ShipPull): ShipPull {
  out.x = 0;
  out.y = 0;
  for (const state of states) {
    if (state.stage !== 'active') continue;
    const dx = state.x - x;
    const dy = state.y - y;
    const share = pullShare(state, Math.hypot(dx, dy), dt);
    if (share === 0) continue;
    out.x += dx * share;
    out.y += dy * share;
  }
  const size = Math.hypot(out.x, out.y);
  const cap = MAX_SHIP_PULL * dt;
  if (size > cap) {
    out.x *= cap / size;
    out.y *= cap / size;
  }
  return out;
}

/** The share of an active hazard's offset to the ship, `distance` away, that is its velocity change over `dt`; 0 for a hazard that does not pull. */
function pullShare(state: Readonly<HazardState>, distance: number, dt: number): number {
  if (state.type === 'blackHole') return holeShare(distance, state.intensity, dt);
  return isForceKind(state.type) ? forceShare(FORCE_SIGN[state.type], distance, state.intensity, dt) : 0;
}
