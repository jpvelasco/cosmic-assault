import type { WeaponTier } from '../../content/types';
import { VOLLEY } from '../config';
import { tierBarrels, type Barrel, type Weapon } from '../ship';

/** Which timed effects are running. */
export interface TimedFlags {
  readonly doubleShot: boolean;
  readonly rapidFire: boolean;
  readonly spreadLaser: boolean;
}

/** Whether `a` is `b` or its mirror image across the nose axis (same width of angle and offset). */
const mirrors = (a: Barrel, b: Barrel): boolean => Math.abs(a.angle) === Math.abs(b.angle) && Math.abs(a.lateral) === Math.abs(b.lateral);

/**
 * Drops the outermost barrels (widest angle, then widest offset) until at most `VOLLEY.maxShots` remain. A barrel
 * and its mirror images go together, so the volley never leans to one side; the rest keep their order.
 */
function capVolley(barrels: readonly Barrel[]): readonly Barrel[] {
  const outermostFirst = [...barrels].sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle) || Math.abs(b.lateral) - Math.abs(a.lateral));
  let kept = barrels;
  for (const widest of outermostFirst) {
    if (kept.length <= VOLLEY.maxShots) break;
    kept = kept.filter((b) => !mirrors(b, widest));
  }
  return kept;
}

/**
 * What the ship fires with at weapon tier `tier` under `flags`. Composed in order: the tier's spread, doubled into
 * parallel pairs for Double Shot, then Spread Laser's extra pair; the volley is capped at `VOLLEY.maxShots`.
 * Rapid Fire shortens the fire interval.
 */
export function weaponFor(tier: WeaponTier, flags: TimedFlags): Weapon {
  let barrels = tierBarrels(tier);
  if (flags.doubleShot) {
    const offset = VOLLEY.parallelOffset;
    barrels = barrels.flatMap(({ angle }) => [
      { angle, lateral: -offset },
      { angle, lateral: offset },
    ]);
  }
  if (flags.spreadLaser) {
    const angle = VOLLEY.spreadLaserAngle;
    barrels = [...barrels, { angle: -angle, lateral: 0 }, { angle, lateral: 0 }];
  }
  return { barrels: capVolley(barrels), fireIntervalScale: flags.rapidFire ? VOLLEY.rapidFireScale : 1 };
}
