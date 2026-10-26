export type Dimension = 1 | 2 | 3 | 4 | 5;
export type GalaxyIndex = 1 | 2 | 3 | 4 | 5 | 6;
/** `'3-4'`: Dimension 3, galaxy 4. Galaxy 6 is the Dimension's boss. */
export type GalaxyId = `${Dimension}-${GalaxyIndex}`;

/** The pickups a kill can drop. M6 extends this. */
export type PickupId = 'weaponCore' | 'doubleShot' | 'shield' | 'rapidFire' | 'spreadLaser';

/** The ship's weapon tier: 0 fires one shot, 3 five. It indexes `WEAPON_SPREAD`. */
export type WeaponTier = 0 | 1 | 2 | 3;

/** The rocks a galaxy spawns. */
export type RockKind = 'large' | 'medium' | 'small';

/** The foes a galaxy spawns: a rock that breaks into fast fragments, and a seeking swarm. */
export type FoeKind = 'splitter' | 'drone';

/** Everything the director can spawn from its threat budget. */
export type ThreatKind = RockKind | FoeKind;

/** M5 widens this to one boss per Dimension. */
export type BossId = 'sentinel';

/** The moves a boss draws on; M5 adds the rest of the roster's. */
export type AttackId = 'shardRing' | 'lunge';

/**
 * How likely a kind is to be picked: `base` up to tier `from`, then rising by `step` per tier past it, never above
 * `max`. `from` is not a grace period: a kind that must not appear before some tier needs a `base` of 0.
 */
export interface KindRamp {
  readonly from: number;
  readonly base: number;
  readonly step: number;
  readonly max: number;
}

export interface GalaxyEvent {
  /** Seconds into the galaxy. */
  readonly at: number;
  readonly type: 'meteorShower' | 'gravityWell';
  readonly intensity: 1 | 2 | 3;
}

export interface GalaxyDef {
  readonly id: GalaxyId;
  readonly dimension: Dimension;
  readonly index: GalaxyIndex;
  readonly kind: 'survival' | 'boss';
  /** Seconds; for a boss galaxy, the length of the approach. */
  readonly duration: number;
  readonly kinds: Readonly<Record<ThreatKind, KindRamp>>;
  readonly events: readonly GalaxyEvent[];
  /** The pickups its kills can drop: every pickup from its Dimension or an earlier one. */
  readonly pickups: readonly PickupId[];
  readonly boss: BossId | null;
  readonly palette: 'drift';
}
