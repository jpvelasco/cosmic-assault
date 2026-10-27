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

/** A rectangle at one corner of the field, `width` by `height` field units, and no wider than `widthShare` of the field if given. */
export interface CornerKeepOut {
  readonly corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  readonly width: number;
  readonly height: number;
  readonly widthShare?: number;
}

/**
 * A danger zone event shows one zone per intensity, at most `maxZones`, each side from `side[0]` to `side[1]` units
 * long. No zone covers a `keepOuts` corner: the HUD's pills at the top (the score, the lives and every pickup pill on
 * the left; the galaxy, its timer and a phone's pause button on the right) and the bottom corners where a phone's
 * joystick and FIRE sit, in either hand. They are sized for the largest of these, a phone in landscape at 21:9 with
 * every pill showing, notched phones' safe-area insets included, and hold on every device, so a seed places its zones
 * alike everywhere. The top two narrow with a narrow field, whose HUD is narrower in field units too.
 */
export const DANGER_ZONE: { readonly maxZones: 2; readonly side: readonly [number, number]; readonly keepOuts: readonly CornerKeepOut[] } = {
  maxZones: 2,
  side: [120, 220],
  keepOuts: [
    { corner: 'topLeft', width: 820, height: 180, widthShare: 0.62 },
    { corner: 'topRight', width: 440, height: 160, widthShare: 0.29 },
    { corner: 'bottomLeft', width: 340, height: 395 },
    { corner: 'bottomRight', width: 340, height: 395 },
  ],
};

/**
 * A warp rift event shows one pair of mouths per intensity, at most `maxPairs`. A body whose edge reaches a mouth leaves
 * by the paired one. The two mouths of a pair lie at least `apart` of the field's width apart (a share of its width),
 * and every mouth keeps `inset` from the field's edges, so a body sent out lands near the field. `drawn` is the radius a
 * mouth's swirl is drawn at, which the mouths keep clear of the HUD and the thumb corners.
 */
export const WARP_RIFT = { maxPairs: 2, radius: 30, drawn: 48, apart: 0.4, inset: 60 } as const;

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
