/**
 * The ship's looks: skins that trim the hull and trails behind its engine. They are purely visual: nothing here
 * changes how the ship moves, turns, fires or drags. Each look unlocks at a number of stars won across the five
 * Dimensions (see meta/cosmetics.ts); the thresholds and colours are initial values the owner tunes.
 */

/** Skins, in the order the Hangar lists them, which is also the order of their thresholds. */
export const SKIN_IDS = ['classic', 'ember', 'glacier', 'aurora', 'solar', 'nova'] as const;
export type SkinId = (typeof SKIN_IDS)[number];

/** Engine trails, in the order the Hangar lists them. */
export const TRAIL_IDS = ['standard', 'comet', 'ion', 'prism'] as const;
export type TrailId = (typeof TRAIL_IDS)[number];

/** The skin and trail a player has chosen: what settings hold, and what the Hangar shows as checked once unlocks apply. */
export interface Look {
  readonly skin: SkinId;
  readonly trail: TrailId;
}

export const DEFAULT_LOOK: Look = Object.freeze({ skin: 'classic', trail: 'standard' });

export interface SkinSpec {
  readonly name: string;
  /** Stars won across Dimensions 1–5 before the skin unlocks, out of 90. */
  readonly stars: number;
  /** The hull's rim. */
  readonly rim: string;
  /** Lines along the wings, or null for none. */
  readonly panel: string | null;
  /** The cockpit, or null to keep the palette's. */
  readonly cockpit: string | null;
}

export const SKINS: Readonly<Record<SkinId, SkinSpec>> = {
  classic: { name: 'Classic', stars: 0, rim: '#ffffff', panel: null, cockpit: null },
  ember: { name: 'Ember', stars: 9, rim: '#ffd27a', panel: '#ff7a3d', cockpit: '#ffe9c2' },
  glacier: { name: 'Glacier', stars: 24, rim: '#e4f7ff', panel: '#5cc8ff', cockpit: '#c9f1ff' },
  aurora: { name: 'Aurora', stars: 45, rim: '#f3e0ff', panel: '#b06bff', cockpit: '#7dffd8' },
  solar: { name: 'Solar', stars: 66, rim: '#fff3b0', panel: '#ffb000', cockpit: '#fff8de' },
  nova: { name: 'Nova', stars: 90, rim: '#ffffff', panel: '#ff4fd8', cockpit: '#9ef7ff' },
};

export interface TrailSpec {
  readonly name: string;
  /** Stars won across Dimensions 1–5 before the trail unlocks, out of 90. */
  readonly stars: number;
  /** The colours a trail particle is drawn in: picked at random, or stepped through in order when `cycle` is set. */
  readonly colors: readonly string[];
  /** Scales how long each trail particle lives. */
  readonly lifeScale: number;
  /** The share of trail particles drawn in `core` instead of `colors`. */
  readonly coreShare: number;
  readonly core: string;
  /** Sideways speed of each particle, in field units per second, picked at random either way; zero for none. */
  readonly jitter: number;
  /** Steps the colours in order along the trail rather than picking them. */
  readonly cycle: boolean;
}

/** The engine's flame colours, which the standard trail keeps. */
const FLAME = ['#ffb347', '#ff6a3c'] as const;

export const TRAILS: Readonly<Record<TrailId, TrailSpec>> = {
  standard: { name: 'Standard', stars: 0, colors: FLAME, lifeScale: 1, coreShare: 0, core: '#ffffff', jitter: 0, cycle: false },
  comet: { name: 'Comet', stars: 15, colors: FLAME, lifeScale: 1.5, coreShare: 0.4, core: '#ffffff', jitter: 0, cycle: false },
  ion: { name: 'Ion', stars: 36, colors: ['#4fe0ff', '#b07cff'], lifeScale: 1, coreShare: 0, core: '#ffffff', jitter: 40, cycle: false },
  prism: {
    name: 'Prism',
    stars: 60,
    colors: ['#ff4f9a', '#ffb347', '#ffe15a', '#5dff8a', '#4fd8ff', '#b07cff'],
    lifeScale: 1,
    coreShare: 0,
    core: '#ffffff',
    jitter: 0,
    cycle: true,
  },
};
