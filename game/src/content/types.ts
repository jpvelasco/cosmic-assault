export type Dimension = 1 | 2 | 3 | 4 | 5;
export type GalaxyIndex = 1 | 2 | 3 | 4 | 5 | 6;
/** `'3-4'`: Dimension 3, galaxy 4. Galaxy 6 is the Dimension's boss. */
export type GalaxyId = `${Dimension}-${GalaxyIndex}`;

/** The colour looks a galaxy can wear: one per Dimension. */
export type PaletteId = 'drift' | 'ionReach' | 'crimsonNebula' | 'voidRift' | 'singularity';

/** The music themes a galaxy can play, one per Dimension, each with a heavier boss variant (see `audio/themes.ts`). */
export type MusicThemeId = PaletteId;

/** The pickups a kill can drop. */
export type PickupId =
  | 'weaponCore'
  | 'doubleShot'
  | 'shield'
  | 'rapidFire'
  | 'spreadLaser'
  | 'piercingBeam'
  | 'homingMissiles'
  | 'fieldBomb'
  | 'wingman'
  | 'nova'
  | 'timeWarp';

/** The ship's weapon tier: 0 fires one shot, 3 five. It indexes `WEAPON_SPREAD`. */
export type WeaponTier = 0 | 1 | 2 | 3;

/** The rocks a galaxy spawns. */
export type RockKind = 'large' | 'medium' | 'small';

/**
 * The foes a galaxy spawns: a rock that breaks into fast fragments, a seeking swarm, a gunship that circles and fires, a
 * mine, a phaser that blinks about and an armoured rock that deflects shots from its plates.
 */
export type FoeKind = 'splitter' | 'drone' | 'gunship' | 'mine' | 'phaser' | 'armoured';

/** Everything the director can spawn from its threat budget. */
export type ThreatKind = RockKind | FoeKind;

/** The bosses: the Monolith guards Dimension 1, the Hive Carrier Dimension 2, the Warden Dimension 3, the Leviathan Dimension 4 and the Eclipse Dimension 5. */
export type BossId = 'monolith' | 'hiveCarrier' | 'warden' | 'leviathan' | 'eclipse';

/** The moves a boss draws on: the Monolith's, the Hive Carrier's, the Warden's and the Leviathan's, then the Eclipse, which remixes them. */
export type AttackId = 'shardVolley' | 'quake' | 'pulse' | 'launch' | 'broadside' | 'retreat' | 'turretVolley' | 'lockOn' | 'spin' | 'ringPulse' | 'dive' | 'spit' | 'coil';

/**
 * How likely a kind is to be picked at tier `t`: `base` while `t` is at or below `from`, then `base + (t - from) * step`
 * past it, never above `max`. `from` is not a grace period: a kind that must not appear before some tier needs a `base`
 * of 0. The one place `from` keeps a kind out is a galaxy's opening, which offers only the kinds whose `from` is 0.
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
  readonly type: 'meteorShower' | 'gravityWell' | 'dangerZone' | 'repulsionField' | 'warpRift' | 'blackHole';
  readonly intensity: 1 | 2 | 3;
}

/** The scheduled events that are hazards, each run by its own module in `sim/hazards/`; showers are the director's. */
export type HazardType = Exclude<GalaxyEvent['type'], 'meteorShower'>;

/** The hazards that only push and pull: a gravity well draws bodies in, a repulsion field drives them out. */
export type ForceKind = Extract<HazardType, 'gravityWell' | 'repulsionField'>;

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
  /** The pickups its drops favour, twice as likely as their weight: in a Dimension's first galaxy, the ones it brings in. */
  readonly featured: readonly PickupId[];
  readonly boss: BossId | null;
  /** The look it is drawn in, and the theme it plays: one per Dimension. */
  readonly palette: PaletteId;
  readonly theme: MusicThemeId;
}
