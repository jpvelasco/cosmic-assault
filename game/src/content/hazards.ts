import type { Dimension, ForceKind, HazardType } from './types';

export interface HazardRule {
  /** Seconds it is shown as a warning, harmless, before it turns hostile. */
  readonly telegraph: number;
  /** Seconds it is hostile for, after its warning. */
  readonly seconds: number;
  /** The first Dimension that may schedule it. */
  readonly from: Dimension;
}

/** Each hazard's telegraph, length and first Dimension; `eventSeconds` reads the lengths. */
export const HAZARD_RULES: Readonly<Record<HazardType, HazardRule>> = {
  gravityWell: { telegraph: 2, seconds: 14, from: 2 },
  repulsionField: { telegraph: 2, seconds: 14, from: 4 },
  dangerZone: { telegraph: 2, seconds: 10, from: 3 },
  warpRift: { telegraph: 2, seconds: 16, from: 4 },
  blackHole: { telegraph: 3, seconds: 75, from: 5 },
};

/** A danger zone event shows one zone per intensity, at most `maxZones`, each side from `side[0]` to `side[1]` units long. */
export const DANGER_ZONE = { maxZones: 2, side: [120, 220] } as const;

/** Which way each force field acts: a gravity well pulls (+1), a repulsion field pushes just as hard (-1). */
export const FORCE_SIGN: Readonly<Record<ForceKind, 1 | -1>> = { gravityWell: 1, repulsionField: -1 };

export const isForceKind = (type: HazardType): type is ForceKind => type in FORCE_SIGN;

/**
 * Units per second squared: the most every hazard's pull on the ship adds up to, so however many act at once a
 * thrusting ship (200) still beats them. It stays at most 0.75 of the thrust.
 */
export const MAX_SHIP_PULL = 150;
/** A force field's strength `k` at intensity 1, in `a = k / max(r, WELL_MIN_RADIUS)²`; intensity multiplies it. */
export const WELL_STRENGTH = 800_000;
/** Distances under this pull as hard as this one does, so the pull has no singularity. */
export const WELL_MIN_RADIUS = 60;
/** Units per second squared: the most any force field pulls or pushes a body with. */
export const WELL_MAX_ACCEL = 140;
/**
 * A pull may speed a body up to this and no further (a body already faster is only kept from gaining), so a rock flung
 * through a well leaves it no faster than the tiniest rocks fly, and stays playable.
 */
export const WELL_SPEED_CAP = 300;
