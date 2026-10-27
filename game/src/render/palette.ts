import type { PaletteId } from '../content/types';
import { rgba } from './color';

/** The canvas clear colour, shared with the renderer so the baked sky blends in at the edges. */
export const BACKGROUND = '#05060f';

export interface Palette {
  readonly id: PaletteId;
  /** Top-left to bottom-right sky gradient stops (at 0, 0.55 and 1). */
  readonly skyStops: readonly [string, string, string];
  /** Radial glows; `x`, `y` are fractions of field width and height, `r` a fraction of field height. */
  readonly nebula: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly color: string;
    readonly alpha: number;
  }[];
  /** Asteroid radial gradient, lit highlight to shadow. */
  readonly rock: readonly [string, string, string];
  readonly rockRim: string;
  readonly rockGlow: string;
  /** Ship hull gradient across the beam, shadow to highlight. */
  readonly ship: readonly [string, string, string];
  readonly cockpit: string;
  readonly shot: string;
  readonly shotCore: string;
  readonly spark: string;
  readonly ring: string;
  readonly hud: string;
  readonly accent: readonly [string, string, string];
  /** The stars and the dust in the sky. */
  readonly star: string;
}

/**
 * The owner-approved Glossy Arcade look. Values come from the mockup's `renderGlossy`
 * and `glossySky`, which draw on a 480x300 field: nebula positions are divided by that
 * width and height, and radii by 300.
 */
export const DRIFT: Palette = {
  id: 'drift',
  skyStops: ['#1d0b44', '#0c1a4a', '#05303d'],
  nebula: [
    { x: 0.18, y: 0.25, r: 220 / 300, color: '#ff4f9a', alpha: 0.3 },
    { x: 0.35, y: 0.1, r: 160 / 300, color: '#ff9a3c', alpha: 0.2 },
    { x: 0.85, y: 0.8, r: 230 / 300, color: '#18d6c4', alpha: 0.28 },
    { x: 0.6, y: 0.55, r: 160 / 300, color: '#7b5cff', alpha: 0.22 },
  ],
  rock: ['#a9bdf0', '#5468a8', '#1d2448'],
  rockRim: rgba('#ffffff', 0.28),
  rockGlow: '#5b8cff',
  ship: ['#0d6b18', '#39ff14', '#d9ffd0'],
  cockpit: '#9ff4ff',
  shot: '#ff4fd8',
  shotCore: '#ffffff',
  spark: '#ffe9a8',
  ring: '#ffd36b',
  hud: '#ffc6ee',
  accent: ['#22d3ff', '#a855f7', '#ff4fd8'],
  star: '#fff4ff',
};

/**
 * Dimension 2: a deep cyan sky (its brightest stop stays dark enough for the pink shot to read on it), teal and violet nebula, cooler rocks. The ship stays `#39ff14` and the shot keeps
 * its white core. The accents lead with magenta and violet, since drones and wells are drawn in them and a cyan foe
 * would vanish against this sky.
 */
export const ION_REACH: Palette = {
  id: 'ionReach',
  skyStops: ['#041c40', '#06638c', '#08728e'],
  nebula: [
    { x: 0.2, y: 0.3, r: 220 / 300, color: '#00e5d4', alpha: 0.3 },
    { x: 0.4, y: 0.1, r: 160 / 300, color: '#2f8bff', alpha: 0.22 },
    { x: 0.85, y: 0.8, r: 230 / 300, color: '#8a3dff', alpha: 0.26 },
    { x: 0.6, y: 0.55, r: 160 / 300, color: '#00f0ff', alpha: 0.2 },
  ],
  rock: ['#bfe9f2', '#4f7f9f', '#12253f'],
  rockRim: rgba('#ffffff', 0.3),
  rockGlow: '#7af0ff',
  ship: DRIFT.ship,
  cockpit: DRIFT.cockpit,
  shot: '#ffb0fa',
  shotCore: '#ffffff',
  spark: '#e2fcff',
  ring: '#ffe566',
  hud: '#d6f6ff',
  accent: ['#ffb0fa', '#9a5cff', '#00f0ff'],
  star: '#e8fdff',
};

/**
 * Dimension 3: a deep red sky, red, orange and amber nebula, warm stone rocks. The cyan shot and the yellow foes are the
 * cool and hot accents the red sky sets off.
 */
export const CRIMSON_NEBULA: Palette = {
  id: 'crimsonNebula',
  skyStops: ['#2b0610', '#4a0d1c', '#1c0a14'],
  nebula: [
    { x: 0.2, y: 0.3, r: 220 / 300, color: '#ff2f3f', alpha: 0.34 },
    { x: 0.4, y: 0.1, r: 160 / 300, color: '#ff8a2a', alpha: 0.24 },
    { x: 0.85, y: 0.8, r: 230 / 300, color: '#ffb347', alpha: 0.2 },
    { x: 0.6, y: 0.55, r: 160 / 300, color: '#c4165a', alpha: 0.26 },
  ],
  rock: ['#f6d2bc', '#a85d52', '#3a1420'],
  rockRim: rgba('#ffffff', 0.3),
  rockGlow: '#ff7a45',
  ship: DRIFT.ship,
  cockpit: DRIFT.cockpit,
  shot: '#5cf2ff',
  shotCore: '#ffffff',
  spark: '#ffe2c2',
  ring: '#ffb347',
  hud: '#ffd2c2',
  accent: ['#ffe14f', '#ff7a45', '#5cf2ff'],
  star: '#fff0e4',
};

/** Dimension 4: a deep violet sky, violet, magenta and blue nebula, amethyst rocks. A gold shot and rose foes. */
export const VOID_RIFT: Palette = {
  id: 'voidRift',
  skyStops: ['#12052e', '#25094d', '#0a0420'],
  nebula: [
    { x: 0.2, y: 0.3, r: 220 / 300, color: '#8a3dff', alpha: 0.34 },
    { x: 0.4, y: 0.1, r: 160 / 300, color: '#e03dc8', alpha: 0.22 },
    { x: 0.85, y: 0.8, r: 230 / 300, color: '#3a6bff', alpha: 0.28 },
    { x: 0.6, y: 0.55, r: 160 / 300, color: '#b04dff', alpha: 0.22 },
  ],
  rock: ['#d8c6fa', '#7456bd', '#2a1650'],
  rockRim: rgba('#ffffff', 0.3),
  rockGlow: '#b07cff',
  ship: DRIFT.ship,
  cockpit: DRIFT.cockpit,
  shot: '#ffd36b',
  shotCore: '#ffffff',
  spark: '#f0e0ff',
  ring: '#ffd36b',
  hud: '#e2d2ff',
  accent: ['#ff4f7a', '#b07cff', '#4fe0ff'],
  star: '#f4ecff',
};

/**
 * Dimension 5: a near-black sky with gold and ember nebula, bright bone-gold rocks so they stay legible on the black. A
 * cyan shot and crimson-pink foes.
 */
export const SINGULARITY: Palette = {
  id: 'singularity',
  skyStops: ['#0a0804', '#1a1408', '#050403'],
  nebula: [
    { x: 0.18, y: 0.3, r: 150 / 300, color: '#ffb300', alpha: 0.26 },
    { x: 0.42, y: 0.08, r: 110 / 300, color: '#ff6a1a', alpha: 0.16 },
    { x: 0.86, y: 0.78, r: 160 / 300, color: '#ffc21a', alpha: 0.2 },
    { x: 0.62, y: 0.55, r: 100 / 300, color: '#ff4a2a', alpha: 0.12 },
  ],
  rock: ['#f6e8c0', '#9c8656', '#3a2e16'],
  rockRim: rgba('#ffffff', 0.34),
  rockGlow: '#ffc94a',
  ship: DRIFT.ship,
  cockpit: DRIFT.cockpit,
  shot: '#4fd8ff',
  shotCore: '#ffffff',
  spark: '#fff0c0',
  ring: '#ffc94a',
  hud: '#ffe9b0',
  accent: ['#ff3d6e', '#ffc94a', '#4fd8ff'],
  star: '#fff6dc',
};

const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  drift: DRIFT,
  ionReach: ION_REACH,
  crimsonNebula: CRIMSON_NEBULA,
  voidRift: VOID_RIFT,
  singularity: SINGULARITY,
};

/** Every palette a galaxy can name. */
export const PALETTE_IDS = Object.keys(PALETTES) as readonly PaletteId[];

/** The palette named `id`. */
export function paletteFor(id: PaletteId): Palette {
  const found = PALETTES[id] as Palette | undefined;
  if (found === undefined) throw new RangeError(`No palette "${id}": the palettes are ${PALETTE_IDS.join(', ')}`);
  return found;
}
