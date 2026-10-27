import type { Dimension, PickupId } from './types';

/** A pickup that acts the moment it is collected: the weapon core raises the tier, the field bomb and the nova blast. */
export type InstantPickupId = Extract<PickupId, 'weaponCore' | 'fieldBomb' | 'nova'>;
/** The instant pickups that blast everything around the ship. */
export type BlastKind = Exclude<InstantPickupId, 'weaponCore'>;
/** A pickup that lasts a while. */
export type TimedPickupId = Exclude<PickupId, InstantPickupId>;

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
  piercingBeam: { name: 'Piercing Beam', callout: 'New: Piercing Beam — shots pass through rocks and foes', from: 3, weight: 2 },
  homingMissiles: { name: 'Homing Missiles', callout: 'New: Homing Missiles — every third shot seeks', from: 3, weight: 2 },
  fieldBomb: { name: 'Field Bomb', callout: 'New: Field Bomb — clears the space around you', from: 4, weight: 1.5 },
  wingman: { name: 'Wingman', callout: 'New: Wingman — a drone that fires beside you', from: 4, weight: 2 },
  nova: { name: 'Nova', callout: 'New: Nova — a blast that clears the field', from: 5, weight: 0.75 },
  timeWarp: { name: 'Time Warp', callout: 'New: Time Warp — slows everything but you', from: 5, weight: 1.5 },
};

/** Every pickup, in the order saves list them. */
export const PICKUP_IDS: readonly PickupId[] = ['weaponCore', 'doubleShot', 'shield', 'rapidFire', 'spreadLaser', 'piercingBeam', 'homingMissiles', 'fieldBomb', 'wingman', 'nova', 'timeWarp'];

export const INSTANT_PICKUPS: readonly InstantPickupId[] = ['weaponCore', 'fieldBomb', 'nova'];

export const isTimed = (kind: PickupId): kind is TimedPickupId => !INSTANT_PICKUPS.includes(kind as InstantPickupId);

export const isBlast = (kind: PickupId): kind is BlastKind => kind === 'fieldBomb' || kind === 'nova';

/** `ids` once each, in the table's order. */
export const canonicalPickups = (ids: readonly PickupId[]): readonly PickupId[] => PICKUP_IDS.filter((id) => ids.includes(id));

export function isPickupId(value: unknown): value is PickupId {
  return PICKUP_IDS.includes(value as PickupId);
}

const poolOf = (dimension: Dimension): readonly PickupId[] => PICKUP_IDS.filter((id) => PICKUPS[id].from <= dimension);

/** One pool per Dimension, shared by its galaxies. Cumulative: a pickup never appears before its Dimension. */
const POOLS: Readonly<Record<Dimension, readonly PickupId[]>> = { 1: poolOf(1), 2: poolOf(2), 3: poolOf(3), 4: poolOf(4), 5: poolOf(5) };

export const poolFor = (dimension: Dimension): readonly PickupId[] => POOLS[dimension];

/** The pickups a Dimension brings in, which its first galaxy features. */
export const newIn = (dimension: Dimension): readonly PickupId[] => PICKUP_IDS.filter((id) => PICKUPS[id].from === dimension);

/** Seconds a timed pickup's effect lasts; the Shield also ends when it absorbs a hit. */
export const EFFECT_SECONDS: Readonly<Record<TimedPickupId, number>> = {
  doubleShot: 12,
  rapidFire: 12,
  spreadLaser: 12,
  shield: 15,
  piercingBeam: 10,
  homingMissiles: 12,
  wingman: 12,
  timeWarp: 8,
};

export const TIMED_PICKUPS: readonly TimedPickupId[] = ['doubleShot', 'rapidFire', 'spreadLaser', 'shield', 'piercingBeam', 'homingMissiles', 'wingman', 'timeWarp'];

/** A fresh record of every timed effect at 0 seconds left: none running. */
export const noEffects = (): Record<TimedPickupId, number> => Object.fromEntries(TIMED_PICKUPS.map((kind) => [kind, 0])) as Record<TimedPickupId, number>;
