export type Dimension = 1 | 2 | 3 | 4 | 5;
export type GalaxyIndex = 1 | 2 | 3 | 4 | 5 | 6;
/** `'3-4'`: Dimension 3, galaxy 4. Galaxy 6 is the Dimension's boss. */
export type GalaxyId = `${Dimension}-${GalaxyIndex}`;

/** The colour looks a galaxy can wear; M6 adds one per remaining Dimension. */
export type PaletteId = 'drift' | 'ionReach';

/** The music themes a galaxy can play, each with a heavier boss variant (see `audio/themes.ts`); M6 adds one per remaining Dimension. */
export type MusicThemeId = 'drift' | 'ionReach';

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

/** The bosses so far: the Monolith guards Dimension 1 and the Hive Carrier Dimension 2; the M4 placeholder Sentinel stands in for the rest. */
export type BossId = 'sentinel' | 'monolith' | 'hiveCarrier';

/** The moves a boss draws on: the Sentinel's, then the Monolith's, then the Hive Carrier's. */
export type AttackId = 'shardRing' | 'lunge' | 'shardVolley' | 'quake' | 'pulse' | 'launch' | 'broadside' | 'retreat';

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
  /** The look it is drawn in, and the theme it plays: one per Dimension. */
  readonly palette: PaletteId;
  readonly theme: MusicThemeId;
}
