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
 * The tier's spread angles that leave room for the timed shots. Over `VOLLEY.maxShots` the tier's outermost angles go
 * first, a mirrored pair at a time so the volley never leans, but the innermost angle (the centre shot, or the inner
 * pair) always stays: the Double Shot pair and the Spread Laser pair are never the ones given up.
 */
function fittingSpread(tier: WeaponTier, flags: TimedFlags): readonly number[] {
  const spread = WEAPON_SPREAD[tier] ?? [];
  const widths = [...new Set(spread.map(Math.abs))].sort((a, b) => a - b);
  const perAngle = flags.doubleShot ? 2 : 1;
  const extra = flags.spreadLaser ? 2 : 0;
  const within = (width: number): readonly number[] => spread.filter((angle) => Math.abs(angle) <= width);
  const fits = (width: number): boolean => within(width).length * perAngle + extra <= VOLLEY.maxShots;
  const widest = widths.findLast(fits) ?? widths[0] ?? 0;
  return within(widest);
}

/**
 * What the ship fires with at weapon tier `tier` under `flags`. Composed in order: the tier's spread, doubled into
 * parallel pairs for Double Shot, then Spread Laser's extra pair (not doubled); the volley never exceeds
 * `VOLLEY.maxShots`. Rapid Fire shortens the fire interval.
 */
export function weaponFor(tier: WeaponTier, flags: TimedFlags): Weapon {
  const offset = VOLLEY.parallelOffset;
  const spread = fittingSpread(tier, flags);
  const barrels: Barrel[] = flags.doubleShot
    ? spread.flatMap((angle) => [
        { angle, lateral: -offset },
        { angle, lateral: offset },
      ])
    : spread.map((angle) => ({ angle, lateral: 0 }));
  if (flags.spreadLaser) barrels.push({ angle: -VOLLEY.spreadLaserAngle, lateral: 0 }, { angle: VOLLEY.spreadLaserAngle, lateral: 0 });
  return { barrels, fireIntervalScale: flags.rapidFire ? VOLLEY.rapidFireScale : 1 };
}
