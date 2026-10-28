import { TAU } from '../../sim/math';
import { BLACK, mix, rgba, WHITE } from '../color';
import type { Palette } from '../palette';
import { addStops, paintGlow, scaled, strokePath, tracePath, type Point } from '../sprites';

/** Its hide: deep indigo scales, lit to shadowed. */
const HIDE_LIT = '#6f86d8';
const HIDE = '#2a2f7a';
const HIDE_DEEP = '#0c0b2c';
/** How far the head's art reaches past its radius, at the snout. */
export const HEAD_ART_REACH = 1.42;
/** How far a segment's art reaches past its radius, at its fins. */
export const SEGMENT_ART_REACH = 1.12;

/** The head at radius 1, snout along +x: a broad skull narrowing to a blunt snout, the jaw hinges flared behind. */
const SKULL: readonly Point[] = [
  { x: 1.4, y: 0 },
  { x: 1.3, y: 0.3 },
  { x: 1.02, y: 0.56 },
  { x: 0.6, y: 0.82 },
  { x: 0.1, y: 1.02 },
  { x: -0.45, y: 0.96 },
  { x: -0.86, y: 0.62 },
  { x: -1, y: 0 },
  { x: -0.86, y: -0.62 },
  { x: -0.45, y: -0.96 },
  { x: 0.1, y: -1.02 },
  { x: 0.6, y: -0.82 },
  { x: 1.02, y: -0.56 },
  { x: 1.3, y: -0.3 },
];

/** The armoured brow across the head, over the eyes. */
const BROW: readonly Point[] = [
  { x: 0.78, y: 0.42 },
  { x: 0.2, y: 0.74 },
  { x: -0.5, y: 0.6 },
  { x: -0.72, y: 0 },
  { x: -0.5, y: -0.6 },
  { x: 0.2, y: -0.74 },
  { x: 0.78, y: -0.42 },
  { x: 0.5, y: 0 },
];

/** A segment at radius 1, its leader along +x: a round scale with a fin either side. */
const SEGMENT: readonly Point[] = Array.from({ length: 20 }, (_, i) => {
  const a = (i / 20) * TAU;
  // Fins at the sides, square to the body.
  const fin = 0.12 * Math.max(0, Math.cos(2 * a + Math.PI)) ** 6;
  return { x: Math.cos(a) * (0.98 + fin), y: Math.sin(a) * (0.98 + fin) };
});

/** Its glossy hide: a radial gradient over radius `r`, lit from the upper left, `lift` of the way to white at its brightest. */
function hide(ctx: CanvasRenderingContext2D, r: number, lift: number): CanvasGradient {
  return addStops(ctx.createRadialGradient(-0.3 * r, -0.4 * r, 0.05 * r, 0, 0, 1.1 * r), [mix(HIDE_LIT, WHITE, lift), HIDE, HIDE_DEEP], [0, 0.55, 1]);
}

/** The gloss over a body: a soft white sheen at its upper left. */
function sheen(ctx: CanvasRenderingContext2D, r: number): void {
  paintGlow(ctx, WHITE, -0.3 * r, -0.42 * r, 0.45 * r, 0.22);
}

/**
 * One segment of the body, its leader along +x: an indigo scale ridged across and finned at the sides, rimmed in the
 * Dimension's light. An armoured one is plated over; the open tail shows a hot seam of `heat` down its spine, split by
 * cracks once it has been hurt.
 */
export function paintSegment(ctx: CanvasRenderingContext2D, r: number, p: Palette, heat: string, look: 'armoured' | 'open' | 'cracked'): void {
  const trim = p.accent[2];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePath(ctx, scaled(SEGMENT, r));
  ctx.fillStyle = hide(ctx, r, look === 'armoured' ? 0.05 : 0.2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Ridges across the scale, like the plates of a carapace.
  for (const x of [-0.45, 0.05, 0.55]) {
    ctx.beginPath();
    ctx.arc(x * r - 0.9 * r, 0, 0.95 * r, -0.9, 0.9);
    strokePath(ctx, rgba(BLACK, 0.4), 0.07 * r);
  }
  if (look === 'armoured') {
    // A plate over the spine.
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.62 * r, 0.42 * r, 0, 0, TAU);
    ctx.fillStyle = addStops(ctx.createLinearGradient(0, -0.42 * r, 0, 0.42 * r), [mix(HIDE_LIT, WHITE, 0.25), mix(HIDE, HIDE_DEEP, 0.3)], [0, 1]);
    ctx.fill();
    strokePath(ctx, rgba(trim, 0.55), 0.05 * r);
  } else {
    // The open seam down its spine, glowing.
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.66 * r, 0.24 * r, 0, 0, TAU);
    ctx.fillStyle = addStops(ctx.createLinearGradient(0, -0.24 * r, 0, 0.24 * r), [rgba(heat, 0.6), mix(heat, WHITE, 0.6), rgba(heat, 0.6)], [0, 0.5, 1]);
    ctx.fill();
    paintGlow(ctx, heat, 0, 0, 0.7 * r, 0.7);
    if (look === 'cracked') {
      ctx.beginPath();
      ctx.moveTo(-0.5 * r, -0.62 * r);
      ctx.lineTo(-0.12 * r, -0.12 * r);
      ctx.lineTo(0.18 * r, 0.1 * r);
      ctx.lineTo(0.44 * r, 0.66 * r);
      strokePath(ctx, rgba(BLACK, 0.85), 0.12 * r);
      strokePath(ctx, rgba(mix(heat, WHITE, 0.4), 0.9), 0.04 * r);
    }
  }
  sheen(ctx, r);
  ctx.restore();
  tracePath(ctx, scaled(SEGMENT, r));
  // The open tail is rimmed in its heat, so it reads as the one to shoot at a glance.
  if (look === 'armoured') strokePath(ctx, rgba(mix(trim, WHITE, 0.3), 0.75), 0.06 * r);
  else strokePath(ctx, rgba(mix(heat, WHITE, 0.35), 0.95), 0.11 * r);
}

/**
 * The head, snout along +x: an indigo skull under an armoured brow, with eyes of `eye`. Shielded, its jaws are shut; bare,
 * they gape on a glowing maw of `heat`.
 */
export function paintHead(ctx: CanvasRenderingContext2D, r: number, p: Palette, eye: string, heat: string, bare: boolean): void {
  const trim = p.accent[2];
  ctx.lineJoin = 'round';
  tracePath(ctx, scaled(SKULL, r));
  ctx.fillStyle = hide(ctx, r, 0.25);
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (bare) {
    // The maw: a hot wedge opening at the snout.
    ctx.beginPath();
    ctx.moveTo(1.45 * r, 0.34 * r);
    ctx.lineTo(0.15 * r, 0);
    ctx.lineTo(1.45 * r, -0.34 * r);
    ctx.closePath();
    ctx.fillStyle = addStops(ctx.createLinearGradient(0.15 * r, 0, 1.4 * r, 0), [mix(heat, WHITE, 0.7), heat, rgba(heat, 0.5)], [0, 0.5, 1]);
    ctx.fill();
    paintGlow(ctx, heat, 0.6 * r, 0, 0.7 * r, 0.8);
  } else {
    // The seam of the shut jaws.
    ctx.beginPath();
    ctx.moveTo(1.4 * r, 0);
    ctx.lineTo(0.4 * r, 0);
    strokePath(ctx, rgba(BLACK, 0.7), 0.06 * r);
  }
  tracePath(ctx, scaled(BROW, r));
  ctx.fillStyle = addStops(ctx.createLinearGradient(-0.7 * r, 0, 0.8 * r, 0), [mix(HIDE, HIDE_DEEP, 0.5), mix(HIDE_LIT, WHITE, 0.2)], [0, 1]);
  ctx.fill();
  strokePath(ctx, rgba(trim, 0.6), 0.05 * r);
  for (const side of [1, -1]) {
    const [x, y] = [0.62 * r, side * 0.46 * r];
    ctx.beginPath();
    ctx.ellipse(x, y, 0.2 * r, 0.11 * r, side * 0.5, 0, TAU);
    ctx.fillStyle = addStops(ctx.createRadialGradient(x, y, 0, x, y, 0.2 * r), [mix(eye, WHITE, 0.7), eye, mix(eye, BLACK, 0.5)], [0, 0.5, 1]);
    ctx.fill();
  }
  sheen(ctx, r);
  ctx.restore();
  tracePath(ctx, scaled(SKULL, r));
  strokePath(ctx, rgba(mix(trim, WHITE, 0.4), 0.8), 0.06 * r);
}
