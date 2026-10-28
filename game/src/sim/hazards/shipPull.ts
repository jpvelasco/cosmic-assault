import { FORCE_SIGN, isForceKind, MAX_SHIP_PULL } from '../../content/hazards';
import { forceShare } from './forceField';
import type { HazardState } from './hazard';

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
    if (state.stage !== 'active' || !isForceKind(state.type)) continue;
    const dx = state.x - x;
    const dy = state.y - y;
    const share = forceShare(FORCE_SIGN[state.type], Math.hypot(dx, dy), state.intensity, dt);
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
