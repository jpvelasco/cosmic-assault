import { FOES } from '../../content/foes';
import { BLACK_HOLE, FORCE_SIGN, isForceKind, WELL_MAX_ACCEL, WELL_MIN_RADIUS, WELL_STRENGTH } from '../../content/hazards';
import { nudge } from '../math';
import type { HazardFoes, HazardState, Pullable } from './hazard';

// The pull of every hazard that pulls: its strength at a distance, and the loop that applies it to the rocks and foes.
// The ship's pull is `shipPullAt`'s, summed over the hazards and capped, from the same shares.

/**
 * Units per second squared a force field of `intensity` pulls (or pushes) a body `distance` away with:
 * `k / max(r, 60)²`, never over 140. The floor on the distance keeps it finite at the centre; the cap keeps it a pull
 * a thrusting ship (200) can beat.
 */
export function wellAcceleration(distance: number, intensity: number): number {
  const reach = Math.max(distance, WELL_MIN_RADIUS);
  return Math.min(WELL_MAX_ACCEL, (WELL_STRENGTH * intensity) / (reach * reach));
}

/**
 * The share of a body's offset (dx, dy) to a force field of `sign` and `intensity`, `distance` away, that is its
 * velocity change over `dt` (over 1 s, its acceleration); 0 at the centre itself.
 */
export function forceShare(sign: 1 | -1, distance: number, intensity: number, dt: number): number {
  return distance === 0 ? 0 : (sign * wellAcceleration(distance, intensity) * dt) / distance;
}

/** The pull a black hole of `intensity` has on a body `distance` away: `min(maxAccel, strength · intensity / max(r, minRadius))`. */
export function holeAcceleration(distance: number, intensity: number): number {
  return Math.min(BLACK_HOLE.maxAccel, (BLACK_HOLE.strength * intensity) / Math.max(distance, BLACK_HOLE.minRadius));
}

/**
 * The share of a body's offset to a hole of `intensity`, `distance` away, that is its velocity change over `dt` (over
 * 1 s, its acceleration); 0 at the centre itself. Multiply it by the offset (toward the hole) to get the change.
 */
export function holeShare(distance: number, intensity: number, dt: number): number {
  return distance === 0 ? 0 : (holeAcceleration(distance, intensity) * dt) / distance;
}

/** The share of an active hazard's offset to a body, `distance` away, that is its velocity change over `dt`; 0 for a hazard that does not pull. */
export function pullShare(state: Readonly<HazardState>, distance: number, dt: number): number {
  if (state.type === 'blackHole') return holeShare(distance, state.intensity, dt);
  return isForceKind(state.type) ? forceShare(FORCE_SIGN[state.type], distance, state.intensity, dt) : 0;
}

/** What a hazard's pull nudges: the rocks, and the foes whose kind it pulls (`FOES[kind].pulled`). */
export interface PulledBodies {
  readonly rocks: readonly Pullable[];
  readonly foes: Pick<HazardFoes, 'list'>;
}

/** Nudges the rocks and the pulled foes by `dt` seconds of `state`'s pull, none past `cap` (a body already faster is only kept from gaining). */
export function pullBodies(state: Readonly<HazardState>, { rocks, foes }: PulledBodies, dt: number, cap: number): void {
  for (const rock of rocks) pullBody(state, rock, dt, cap);
  for (const foe of foes.list) if (FOES[foe.kind].pulled) pullBody(state, foe, dt, cap);
}

function pullBody(state: Readonly<HazardState>, body: Pullable, dt: number, cap: number): void {
  const dx = state.x - body.x;
  const dy = state.y - body.y;
  const share = pullShare(state, Math.hypot(dx, dy), dt);
  if (share !== 0) nudge(body, dx * share, dy * share, cap);
}
