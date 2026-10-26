import { EFFECT_SECONDS, TIMED_PICKUPS, type TimedPickupId } from '../../content/pickups';
import type { PickupId, WeaponTier } from '../../content/types';
import { MAX_WEAPON_TIER } from '../config';
import type { SimEvent } from '../events';
import { TIME_EPSILON } from '../math';
import type { Weapon } from '../ship';
import { weaponFor } from './volley';

const isTimed = (kind: PickupId): kind is TimedPickupId => kind !== 'weaponCore';

/**
 * What the ship carries: its weapon tier, and the timed effects (Double Shot, Rapid Fire, Spread Laser, Shield) with
 * the seconds each has left. Collecting a kind already running refreshes its clock; it never stacks.
 */
export class Loadout {
  private tierValue: WeaponTier;
  private readonly left: Record<TimedPickupId, number> = { doubleShot: 0, rapidFire: 0, spreadLaser: 0, shield: 0 };
  private cached: Weapon | null = null;

  constructor(startTier: WeaponTier = 0) {
    this.tierValue = startTier;
  }

  get tier(): WeaponTier {
    return this.tierValue;
  }

  /** Seconds left per timed effect, 0 for one that is off; a live view. */
  get effects(): Readonly<Record<TimedPickupId, number>> {
    return this.left;
  }

  get shielded(): boolean {
    return this.left.shield > 0;
  }

  /** The weapon the ship fires with, rebuilt only when the tier or a volley effect changes. */
  get weapon(): Weapon {
    return (this.cached ??= weaponFor(this.tierValue, {
      doubleShot: this.left.doubleShot > 0,
      rapidFire: this.left.rapidFire > 0,
      spreadLaser: this.left.spreadLaser > 0,
    }));
  }

  collect(kind: PickupId): void {
    if (isTimed(kind)) {
      this.left[kind] = EFFECT_SECONDS[kind];
    } else {
      this.tierValue = Math.min(MAX_WEAPON_TIER, this.tierValue + 1) as WeaponTier;
    }
    this.cached = null;
  }

  /** Runs every effect's clock down; each that reaches 0 is reported in `events`. */
  step(dt: number, events: SimEvent[]): void {
    for (const kind of TIMED_PICKUPS) {
      if (this.left[kind] <= 0) continue;
      this.left[kind] -= dt;
      if (this.left[kind] <= TIME_EPSILON) this.end(kind, events);
    }
  }

  /** The Shield took a hit. */
  breakShield(): void {
    this.left.shield = 0;
  }

  /** The ship was lost: every timed effect and the Shield end, and the tier falls by one if `dropTier`. */
  die(events: SimEvent[], dropTier: boolean): void {
    for (const kind of TIMED_PICKUPS) if (this.left[kind] > 0) this.end(kind, events);
    if (dropTier) this.tierValue = Math.max(0, this.tierValue - 1) as WeaponTier;
    this.cached = null;
  }

  private end(kind: TimedPickupId, events: SimEvent[]): void {
    this.left[kind] = 0;
    this.cached = null;
    events.push({ type: 'effectEnded', kind });
  }
}
