/** Seconds a gravity well is drawn as a warning before it pulls. */
export const WELL_TELEGRAPH_SECONDS = 2;
/** Seconds a gravity well pulls for. */
export const WELL_SECONDS = 14;
/** The pull's strength `k` at intensity 1, in `a = k / max(r, WELL_MIN_RADIUS)²`; intensity multiplies it. */
export const WELL_STRENGTH = 1_000_000;
/** Distances under this pull as hard as this one does, so the pull has no singularity. */
export const WELL_MIN_RADIUS = 60;
/** Units per second squared: the most any well pulls with. */
export const WELL_MAX_ACCEL = 140;
/**
 * A pull may speed a body up to this and no further (a body already faster is only kept from gaining), so a rock flung
 * through a well leaves it no faster than the tiniest rocks fly, and stays playable.
 */
export const WELL_SPEED_CAP = 300;
