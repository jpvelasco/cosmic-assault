import type { PickupId } from '../content/types';
import { PICKUP } from '../sim/config';

/**
 * One colour per pickup, the same in every Dimension, so a kind reads the same on the field, in its HUD pill and in
 * its burst wherever it drops.
 */
export const PICKUP_COLORS: Readonly<Record<PickupId, string>> = {
  weaponCore: '#ffc83d',
  doubleShot: '#ff5fa2',
  shield: '#3fd9ff',
  rapidFire: '#ff8a2b',
  spreadLaser: '#b26bff',
  piercingBeam: '#e8f4ff',
  homingMissiles: '#ff4d4d',
  fieldBomb: '#ffd9a0',
  wingman: '#5fffd2',
  nova: '#fff27a',
  timeWarp: '#8fa8ff',
};

/** The Shield ring's radius round the ship's centre, before the visual scale; its break bursts from it. */
export const SHIELD_RING_RADIUS = 22;

/** Times a second a pickup, its pill or the Shield ring flips while it is about to run out. */
const EXPIRY_BLINK_HZ = 4;
/** The alpha of the dim half of the blink, and the steady dim alpha a still (reduced-motion) one holds instead. */
const BLINK_DIM = 0.25;
const STILL_DIM = 0.55;

/**
 * How opaque something with `left` seconds to go is drawn: whole until its last `PICKUP.blinkSeconds`, then blinking
 * between whole and dim, or held dim when `still` (reduced motion). It reads `left`, not a clock, so it needs no state.
 */
export function expiryAlpha(left: number, still: boolean): number {
  if (left > PICKUP.blinkSeconds) return 1;
  if (still) return STILL_DIM;
  return Math.floor(left * EXPIRY_BLINK_HZ * 2) % 2 === 0 ? 1 : BLINK_DIM;
}

type Glyph = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => void;

/** Closes a path through (x + px·r, y + py·r) for each pair of `points`. */
function polygon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points: readonly number[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) ctx.lineTo(x + (points[i] as number) * r, y + (points[i + 1] as number) * r);
  ctx.closePath();
  ctx.fill();
}

/** One shot of the pair: a pointed head over a straight body, centred `dx` across. */
const shotAt = (dx: number): readonly number[] => [dx, -1, dx + 0.24, -0.5, dx + 0.24, 0.92, dx - 0.24, 0.92, dx - 0.24, -0.5];
const LEFT_SHOT = shotAt(-0.42);
const RIGHT_SHOT = shotAt(0.42);
const STAR = [0, -1, 0.28, -0.28, 1, 0, 0.28, 0.28, 0, 1, -0.28, 0.28, -1, 0, -0.28, -0.28];
const BOLT = [0.3, -1, -0.6, 0.12, -0.06, 0.12, -0.3, 1, 0.6, -0.16, 0.06, -0.16];
const CREST = [0, -1, 0.82, -0.62, 0.72, 0.18, 0, 1, -0.72, 0.18, -0.82, -0.62];
/** A lance, point up, and the ring it passes through. */
const LANCE = [0, -1, 0.18, -0.6, 0.11, 1, -0.11, 1, -0.18, -0.6];
const RING_Y = 0.2;
/** A dart, point to the right, at the end of the curve a seeking shot flies. */
const DART = [0.98, -0.28, 0.18, -0.78, 0.36, -0.28, 0.18, 0.22];
const BURST = [0, -1, 0.22, -0.53, 0.71, -0.71, 0.53, -0.22, 1, 0, 0.53, 0.22, 0.71, 0.71, 0.22, 0.53, 0, 1, -0.22, 0.53, -0.71, 0.71, -0.53, 0.22, -1, 0, -0.53, -0.22, -0.71, -0.71, -0.22, -0.53];
/** A four-pointed spark at a fuse's end. */
const SPARK = [0, -1, 0.26, -0.26, 1, 0, 0.26, 0.26, 0, 1, -0.26, 0.26, -1, 0, -0.26, -0.26];
const HOURGLASS = [-0.7, -1, 0.7, -1, 0.12, 0, 0.7, 1, -0.7, 1, -0.12, 0];
const LEAD = [-0.2, -1, 0.3, 0.6, -0.7, 0.6];
const WING = [0.55, -0.4, 0.9, 0.9, 0.2, 0.9];

/** The pickup glyphs: plain canvas paths, so they never depend on a font or an emoji. Each spans ±r around (x, y). */
const GLYPHS: Readonly<Record<PickupId, Glyph>> = {
  // A four-pointed star: the core that powers the volley up.
  weaponCore: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, STAR);
  },
  // Two shots side by side, flying up: pointed, so they never read as a pause sign.
  doubleShot: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, LEFT_SHOT);
    polygon(ctx, x, y, r, RIGHT_SHOT);
  },
  // A lightning bolt: faster fire.
  rapidFire: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, BOLT);
  },
  // Three rays fanning out from one point.
  spreadLaser: (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.moveTo(x, y + 0.8 * r);
    ctx.lineTo(x - 0.78 * r, y - 0.7 * r);
    ctx.moveTo(x, y + 0.8 * r);
    ctx.lineTo(x, y - 0.95 * r);
    ctx.moveTo(x, y + 0.8 * r);
    ctx.lineTo(x + 0.78 * r, y - 0.7 * r);
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.3 * r;
    ctx.stroke();
  },
  // A crest.
  shield: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, CREST);
  },
  // A lance through a ring: a shot that passes through what it strikes.
  piercingBeam: (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y + RING_Y * r, 0.52 * r, 0, Math.PI * 2);
    ctx.lineWidth = 0.2 * r;
    ctx.stroke();
    polygon(ctx, x, y, r, LANCE);
  },
  // A dart at the end of a curving trail: a shot that swings round onto its mark.
  homingMissiles: (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.moveTo(x - 0.8 * r, y + 0.9 * r);
    ctx.quadraticCurveTo(x - 0.75 * r, y - 0.28 * r, x + 0.25 * r, y - 0.28 * r);
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.24 * r;
    ctx.stroke();
    polygon(ctx, x, y, r, DART);
  },
  // A bomb with a lit fuse: a solid round body, and a spark at the end of a fuse.
  fieldBomb: (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.arc(x - 0.2 * r, y + 0.22 * r, 0.6 * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 0.1 * r, y - 0.05 * r);
    ctx.quadraticCurveTo(x + 0.45 * r, y - 0.55 * r, x + 0.72 * r, y - 0.66 * r);
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.18 * r;
    ctx.stroke();
    polygon(ctx, x + 0.8 * r, y - 0.78 * r, 0.42 * r, SPARK);
  },
  // A ship with a smaller one off its wing.
  wingman: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, LEAD);
    polygon(ctx, x, y, r, WING);
  },
  // An eight-pointed burst: the biggest blast.
  nova: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, BURST);
  },
  // An hourglass: time slows.
  timeWarp: (ctx, x, y, r) => {
    polygon(ctx, x, y, r, HOURGLASS);
  },
};

/** Draws `kind`'s glyph in `color`, spanning ±r around (x, y). */
export function drawGlyph(ctx: CanvasRenderingContext2D, kind: PickupId, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  GLYPHS[kind](ctx, x, y, r);
}
