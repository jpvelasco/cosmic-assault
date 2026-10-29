import type { Dimension, ForceKind, GalaxyEvent, HazardType } from './types';

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
  gravityStorm: { telegraph: 3, seconds: 12, from: 2 },
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
 * and every mouth keeps `inset` from the field's edges, so a body sent out lands near the field. A body that has jumped
 * rests `rest` seconds before it can jump again, so no body hops between pairs faster than that. `drawn` is the radius a
 * mouth's swirl is drawn at, which the mouths keep clear of the HUD and the thumb corners where the field allows it.
 */
export const WARP_RIFT = { maxPairs: 2, radius: 30, drawn: 48, apart: 0.4, inset: 60, rest: 0.25 } as const;

/**
 * The black hole at the field's centre. Its pull on the ship, and on the rocks and pulled foes, is
 * `min(maxAccel, strength · intensity / max(r, minRadius))` units/s². Its horizon has radius `horizon`: it swallows rocks,
 * foes, bolts and shots that reach it for no points and no drop, and touching it (within `horizon` plus the ship's radius)
 * costs the ship a life. While it is warning or active a respawning ship comes back a safe radius outside `exitReach` and
 * clear of the foes, the danger zones and the rift mouths (`BlackHole.respawnPoint`). It speeds the rocks and foes it
 * pulls up to `rockSpeedCap`, lower than the ship's cap: at the wells' 300 the fragments it accelerates are too fast to
 * read (a tuning value, set with the Singularity balance).
 *
 * `warnRadius` is the ring its warning is drawn at, and the distance a ship must be from it to escape the pull, from rest, at
 * the start: the test holds the hole to both. `exitReach` is the least distance from the hole a ship heading straight in at
 * the top speed survives a reaction from, so a rift mouth whose exit lands inside it can doom the ship, and `exitFallback`
 * is the lesser exit distance a field too crowded for it settles for (the test measures both). Both are distances of the
 * ship's exit from the hole, not of a mouth: a mouth keeps the ship's radius and its exit gap further out.
 */
const HOLE_HORIZON = 32;
export const BLACK_HOLE = {
  horizon: HOLE_HORIZON,
  strength: 9000,
  maxAccel: 100,
  minRadius: 80,
  rockSpeedCap: 120,
  warnRadius: HOLE_HORIZON * 2.4,
  exitReach: 284,
  exitFallback: 248,
} as const;

/**
 * A gravity storm places `baseWells` plus its intensity of gravity wells, at most `maxWells`, all at once, each of
 * intensity 1 and pulling like one. They sit at least `spacing` of the field's width apart. (Tuning values.)
 */
export const GRAVITY_STORM = { baseWells: 2, maxWells: 4, spacing: 0.28 } as const;

/** The wells a gravity storm of `intensity` places where the field leaves room: `baseWells` plus the intensity, at most `maxWells`. */
export const stormWells = (intensity: GalaxyEvent['intensity']): number => Math.min(GRAVITY_STORM.baseWells + intensity, GRAVITY_STORM.maxWells);

/**
 * A gravity well's drawn radius at intensity 1, in field units; its pull reaches the whole field and has no edge. A storm
 * keeps its wells this far inside the field and, where the field leaves room, this far clear of the HUD and thumb
 * corners. A warning outline starts wider and closes onto the well, so its rim may still reach past either.
 */
export const WELL_RADIUS = 90;

/** Which way each force field acts: a gravity well pulls (+1), a repulsion field pushes just as hard (-1). */
export const FORCE_SIGN: Readonly<Record<ForceKind, 1 | -1>> = { gravityWell: 1, repulsionField: -1 };

export const isForceKind = (type: HazardType): type is ForceKind => type in FORCE_SIGN;

/** Whether a hazard pulls or pushes the ship once active: the force fields, the gravity storm's wells and the black hole. */
export const pullsShip = (type: HazardType): boolean => isForceKind(type) || type === 'gravityStorm' || type === 'blackHole';

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
