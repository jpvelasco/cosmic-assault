import type { WeaponTier } from '../../content/types';
import { VOLLEY, WEAPON_SPREAD } from '../config';
import type { Barrel, Weapon } from '../ship';

/** Which timed effects are running. */
export interface TimedFlags {
  readonly doubleShot: boolean;
  readonly rapidFire: boolean;
  readonly spreadLaser: boolean;
}

/**
 * What the ship fires with at weapon tier `tier` under `flags`. Composed in order: the tier's spread; Double Shot,
 * which turns the centre shot into a parallel pair (a tier with no centre angle pairs its innermost angles instead, so
 * the volley stays symmetric); then Spread Laser's extra pair. Each effect only adds shots, and the largest volley
 * (tier 3 with both) is `VOLLEY.maxShots`. Rapid Fire shortens the fire interval.
 */
export function weaponFor(tier: WeaponTier, flags: TimedFlags): Weapon {
  const spread = WEAPON_SPREAD[tier] ?? [];
  const innermost = Math.min(...spread.map(Math.abs));
  const offset = VOLLEY.parallelOffset;
  const barrels: Barrel[] = spread.flatMap((angle) =>
    flags.doubleShot && Math.abs(angle) === innermost
      ? [
          { angle, lateral: -offset },
          { angle, lateral: offset },
        ]
      : [{ angle, lateral: 0 }],
  );
  if (flags.spreadLaser) barrels.push({ angle: -VOLLEY.spreadLaserAngle, lateral: 0 }, { angle: VOLLEY.spreadLaserAngle, lateral: 0 });
  return { barrels, fireIntervalScale: flags.rapidFire ? VOLLEY.rapidFireScale : 1 };
}
