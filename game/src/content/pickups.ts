import type { Dimension, PickupId } from './types';

/** A pickup that lasts a while: Double Shot, Rapid Fire, Spread Laser, or the Shield. */
export type TimedPickupId = Exclude<PickupId, 'weaponCore'>;

export interface PickupDef {
  readonly name: string;
  /** The toast on a kind's first drop, until the player has collected it once. */
  readonly callout: string;
  /** The first Dimension whose galaxies can drop it. */
  readonly from: Dimension;
  /** How likely it is to be chosen, relative to the others in the pool. */
  readonly weight: number;
}

export const PICKUPS: Readonly<Record<PickupId, PickupDef>> = {
  weaponCore: { name: 'Weapon Core', callout: 'New: Weapon Core — a stronger volley', from: 1, weight: 3 },
  doubleShot: { name: 'Double Shot', callout: 'New: Double Shot — two shots at once', from: 1, weight: 3 },
  shield: { name: 'Shield', callout: 'New: Shield — absorbs one hit', from: 1, weight: 3 },
  rapidFire: { name: 'Rapid Fire', callout: 'New: Rapid Fire — shoot faster', from: 2, weight: 2 },
  spreadLaser: { name: 'Spread Laser', callout: 'New: Spread Laser — a fan of three shots', from: 2, weight: 2 },
};

/** Every pickup, in the order saves list them. */
export const PICKUP_IDS: readonly PickupId[] = ['weaponCore', 'doubleShot', 'shield', 'rapidFire', 'spreadLaser'];

/** `ids` once each, in the table's order. */
export const canonicalPickups = (ids: readonly PickupId[]): readonly PickupId[] => PICKUP_IDS.filter((id) => ids.includes(id));

export function isPickupId(value: unknown): value is PickupId {
  return PICKUP_IDS.includes(value as PickupId);
}

const poolOf = (dimension: Dimension): readonly PickupId[] => PICKUP_IDS.filter((id) => PICKUPS[id].from <= dimension);

/** One pool per Dimension, shared by its galaxies. Cumulative: a pickup never appears before its Dimension. */
const POOLS: Readonly<Record<Dimension, readonly PickupId[]>> = { 1: poolOf(1), 2: poolOf(2), 3: poolOf(3), 4: poolOf(4), 5: poolOf(5) };

export const poolFor = (dimension: Dimension): readonly PickupId[] => POOLS[dimension];

/** Seconds a timed pickup's effect lasts; the Shield also ends when it absorbs a hit. */
export const EFFECT_SECONDS: Readonly<Record<TimedPickupId, number>> = { doubleShot: 12, rapidFire: 12, spreadLaser: 12, shield: 15 };

export const TIMED_PICKUPS: readonly TimedPickupId[] = ['doubleShot', 'rapidFire', 'spreadLaser', 'shield'];
