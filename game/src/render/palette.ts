import { rgba } from './color';

export interface Palette {
  readonly id: string;
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
};
