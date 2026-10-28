import { EFFECT_SECONDS, isTimed, noEffects, TIMED_PICKUPS, type TimedPickupId } from '../../content/pickups';
import type { PickupId, WeaponTier } from '../../content/types';
import { MAX_WEAPON_TIER, TIME_WARP_SCALE } from '../config';
import type { SimEvent } from '../events';
import { TIME_EPSILON } from '../math';
import type { Weapon } from '../ship';
import type { ShotRules } from '../shots';
import { shotRulesFor, weaponFor } from './volley';

/** The share of real time the foes, the rocks and the boss run at, from the seconds left of each timed effect: half while Time Warp runs. */
export const enemyTimeScale = (left: Readonly<Record<TimedPickupId, number>>): number => (left.timeWarp > 0 ? TIME_WARP_SCALE : 1);

/** What the ship fires with and what its shots carry, rebuilt together. */
interface Armament {
  readonly weapon: Weapon;
  readonly rules: ShotRules;
}

/**
 * What the ship carries: its weapon tier, and the timed effects with the seconds each has left. Collecting a kind
 * already running refreshes its clock; it never stacks. The blasts act at once, and are the run's to set off.
 */
export class Loadout {
  private tierValue: WeaponTier;
  private readonly left = noEffects();
  private cached: Armament | null = null;

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

  /** The weapon the ship fires with, rebuilt only when the tier or an effect changes. */
  get weapon(): Weapon {
    return this.armament().weapon;
  }

  /** What the player's shots carry: pierces, the homing cadence and the Wingman; the same object until an effect changes. */
  get shotRules(): ShotRules {
    return this.armament().rules;
  }

  /** The share of real time the foes, the rocks and the boss run at: `enemyTimeScale`. */
  get timeScale(): number {
    return enemyTimeScale(this.left);
  }

  collect(kind: PickupId): void {
    if (isTimed(kind)) {
      this.left[kind] = EFFECT_SECONDS[kind];
    } else if (kind === 'weaponCore') {
      this.tierValue = Math.min(MAX_WEAPON_TIER, this.tierValue + 1) as WeaponTier;
    } else {
      // A blast changes nothing the ship carries.
      return;
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

  private armament(): Armament {
    if (this.cached !== null) return this.cached;
    const on = (kind: TimedPickupId): boolean => this.left[kind] > 0;
    const flags = { doubleShot: on('doubleShot'), rapidFire: on('rapidFire'), spreadLaser: on('spreadLaser'), piercingBeam: on('piercingBeam'), homingMissiles: on('homingMissiles'), wingman: on('wingman') };
    return (this.cached = { weapon: weaponFor(this.tierValue, flags), rules: shotRulesFor(flags) });
  }

  private end(kind: TimedPickupId, events: SimEvent[]): void {
    this.left[kind] = 0;
    this.cached = null;
    events.push({ type: 'effectEnded', kind });
  }
}
