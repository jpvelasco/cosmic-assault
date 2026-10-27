import type { WeaponTier } from '../../content/types';
import { VOLLEY, WEAPON_SPREAD } from '../config';
import type { Barrel, Weapon } from '../ship';
import type { ShotRules } from '../shots';

/** Which of the timed effects that change fire are running. */
export interface TimedFlags {
  readonly doubleShot: boolean;
  readonly rapidFire: boolean;
  readonly spreadLaser: boolean;
  readonly piercingBeam: boolean;
  readonly homingMissiles: boolean;
  readonly wingman: boolean;
}

/**
 * What the ship fires with at weapon tier `tier` under `flags`. Composed in order: the tier's spread; Double Shot,
 * which turns the centre shot into a parallel pair (a tier with no centre angle pairs its innermost angles instead, so
 * the volley stays symmetric); then Spread Laser's extra pair. Each effect only adds shots, and the largest volley
 * (tier 3 with both) is `VOLLEY.maxShots`. Rapid Fire shortens the fire interval. The kinds that change the shots
 * rather than the ship's guns are `shotRulesFor`'s.
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

/** What the player's shots carry under `flags`: Piercing Beam's pierces, Homing Missiles' cadence, and whether the Wingman fires. */
export function shotRulesFor(flags: TimedFlags): ShotRules {
  return {
    pierce: flags.piercingBeam ? VOLLEY.pierceTargets : 0,
    homingEvery: flags.homingMissiles ? VOLLEY.homingEvery : 0,
    wingman: flags.wingman,
  };
}
