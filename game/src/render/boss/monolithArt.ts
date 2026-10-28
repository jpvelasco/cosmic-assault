import { TAU } from '../../sim/math';
import { BLACK, mix, rgba, WHITE } from '../color';
import type { Palette } from '../palette';
import { addStops, craterLayout, paintCraters, paintGlow, scaled, strokePath, tracePath, type Point } from '../sprites';

const SLATE_LIT = '#7a6a9e';
const SLATE = '#2b2140';
/** The Monolith's crater layout, fixed, as if it were one rock. */
const CRATER_ID = 6;
/** The outline's vertices, and how far the core's sprite reaches past its radius. */
const OUTLINE_VERTICES = 16;
export const MONOLITH_ART_REACH = 1.04;

/** The core's lumpy outline at radius 1: a few slow bumps, never past `MONOLITH_ART_REACH`. */
const OUTLINE: readonly Point[] = Array.from({ length: OUTLINE_VERTICES }, (_, i) => {
  const a = (i / OUTLINE_VERTICES) * TAU;
  const r = 0.93 + 0.06 * Math.sin(3 * a + 0.6) + 0.04 * Math.sin(5 * a + 2.1);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
});

/** The cracks the core glows through, at radius 1, branching out from just above its centre. */
const FISSURES: readonly (readonly Point[])[] = [
  [{ x: -0.05, y: -0.08 }, { x: 0.18, y: -0.3 }, { x: 0.3, y: -0.55 }, { x: 0.5, y: -0.66 }],
  [{ x: 0.18, y: -0.3 }, { x: 0.46, y: -0.2 }, { x: 0.72, y: -0.26 }],
  [{ x: -0.05, y: -0.08 }, { x: -0.32, y: -0.12 }, { x: -0.5, y: 0.08 }, { x: -0.8, y: 0.12 }],
  [{ x: -0.05, y: -0.08 }, { x: 0.08, y: 0.22 }, { x: -0.06, y: 0.5 }, { x: 0.08, y: 0.78 }],
  [{ x: 0.08, y: 0.22 }, { x: 0.38, y: 0.34 }, { x: 0.56, y: 0.6 }],
];
const FISSURE_HUB = FISSURES[0]?.[0] ?? { x: 0, y: 0 };

/** A shard at radius 1, nose along +x: a jagged wedge of the same rock. */
const SHARD: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0.38, y: 0.6 },
  { x: -0.5, y: 0.52 },
  { x: -0.95, y: -0.04 },
  { x: -0.42, y: -0.62 },
  { x: 0.42, y: -0.55 },
];

/** The Monolith's stone: the Dimension's rock pushed darker and toward slate violet, so it reads heavier than the field's. */
function stone(p: Palette): readonly [string, string, string] {
  const [, mid, shade] = p.rock;
  return [mix(mid, SLATE_LIT, 0.45), mix(shade, SLATE, 0.45), mix(shade, BLACK, 0.7)];
}

function traceLine(ctx: CanvasRenderingContext2D, points: readonly Point[], r: number): void {
  ctx.beginPath();
  for (const p of points) ctx.lineTo(p.x * r, p.y * r);
}

/** The Monolith's rock, heavier and darker than the field's: lit from the upper left, cratered, its cracks dark grooves. */
export function paintMonolithCore(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  ctx.lineJoin = 'round';
  tracePath(ctx, scaled(OUTLINE, r));
  const [lit, mid, shade] = stone(p);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.4 * r, -0.45 * r, 0.08 * r, 0, 0, 1.1 * r), [lit, mid, shade], [0, 0.5, 1]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  paintGlow(ctx, WHITE, -0.4 * r, -0.45 * r, 0.4 * r, 0.08);
  paintCraters(ctx, craterLayout(CRATER_ID, r), p);
  ctx.lineCap = 'round';
  for (const crack of FISSURES) {
    traceLine(ctx, crack, r);
    strokePath(ctx, rgba(BLACK, 0.85), 0.06 * r);
  }
  ctx.restore();
  tracePath(ctx, scaled(OUTLINE, r));
  strokePath(ctx, p.rockRim, 2);
}

/** The light in the core's cracks, for drawing additively over it: a soft wide band of `color` with a hot thin line. */
export function paintFissures(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  paintGlow(ctx, color, FISSURE_HUB.x * r, FISSURE_HUB.y * r, 0.32 * r, 0.8);
  for (const [width, stroke] of [
    [0.1 * r, rgba(color, 0.3)],
    [0.045 * r, rgba(color, 0.85)],
    [0.016 * r, rgba(mix(color, WHITE, 0.6), 1)],
  ] as const) {
    for (const crack of FISSURES) {
      traceLine(ctx, crack, r);
      strokePath(ctx, stroke, width);
    }
  }
}

/** A shard of the Monolith's rock with a lit edge in `glint`; a cracked one shows a glowing split across it. */
export function paintShard(ctx: CanvasRenderingContext2D, r: number, p: Palette, glint: string, cracked: boolean): void {
  ctx.lineJoin = 'round';
  tracePath(ctx, scaled(SHARD, r));
  const [lit, mid, shade] = stone(p);
  ctx.fillStyle = addStops(ctx.createLinearGradient(-r, -r, r, r), [mix(lit, WHITE, 0.15), mid, shade], [0, 0.45, 1]);
  ctx.fill();
  strokePath(ctx, p.rockRim, 1.2);
  // The facet ridge along its length, catching the light.
  ctx.beginPath();
  ctx.moveTo(0.95 * r, 0);
  ctx.lineTo(-0.4 * r, -0.08 * r);
  strokePath(ctx, rgba(mix(glint, WHITE, 0.5), 0.55), 1);
  if (!cracked) return;
  ctx.beginPath();
  ctx.moveTo(0.1 * r, -0.58 * r);
  ctx.lineTo(-0.05 * r, -0.1 * r);
  ctx.lineTo(0.15 * r, 0.2 * r);
  ctx.lineTo(0, 0.56 * r);
  strokePath(ctx, rgba(BLACK, 0.9), 0.16 * r);
  strokePath(ctx, rgba(glint, 0.9), 0.06 * r);
}
