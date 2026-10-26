export type Dimension = 1 | 2 | 3 | 4 | 5;
export type GalaxyIndex = 1 | 2 | 3 | 4 | 5 | 6;
/** `'3-4'`: Dimension 3, galaxy 4. Galaxy 6 is the Dimension's boss. */
export type GalaxyId = `${Dimension}-${GalaxyIndex}`;

/** The rocks a galaxy spawns. M5 adds foe kinds. */
export type RockKind = 'large' | 'medium' | 'small';

/** M5 widens this to one boss per Dimension. */
export type BossId = 'sentinel';

/** How likely a kind is to be picked: `base` from tier `from`, rising by `step` per tier, never above `max`. */
export interface KindRamp {
  readonly from: number;
  readonly base: number;
  readonly step: number;
  readonly max: number;
}

export interface GalaxyEvent {
  /** Seconds into the galaxy. */
  readonly at: number;
  readonly type: 'meteorShower';
  readonly intensity: 1 | 2 | 3;
}

export interface GalaxyDef {
  readonly id: GalaxyId;
  readonly dimension: Dimension;
  readonly index: GalaxyIndex;
  readonly kind: 'survival' | 'boss';
  /** Seconds; for a boss galaxy, the length of the approach. */
  readonly duration: number;
  readonly kinds: Readonly<Record<RockKind, KindRamp>>;
  readonly events: readonly GalaxyEvent[];
  /** Empty in M4. */
  readonly pickups: readonly string[];
  readonly boss: BossId | null;
  readonly palette: 'drift';
}
