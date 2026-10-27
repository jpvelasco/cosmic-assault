import { HANGAR_HALF_ARC } from '../../sim/boss/hiveCarrier';
import { TAU } from '../../sim/math';
import { mix, rgba } from '../color';
import type { Palette } from '../palette';
import { addStops, paintGlow, scaled, strokePath, tracePath, type Point } from '../sprites';

const WHITE = '#ffffff';
const BLACK = '#000000';
/** Gunmetal plating, lit to shadowed. */
const PLATE_LIT = '#a9bbd6';
const PLATE = '#3b4a68';
const PLATE_DEEP = '#121a2c';
/** How far the hull's art reaches past its radius, at the wingtips. */
export const HIVE_ART_REACH = 1.03;
/** The hangar bay's inner and outer edge, as shares of the radius. */
const BAY_INNER = 0.62;
const BAY_OUTER = 0.95;
/** The door leaves' rim sits a touch proud of the bay. */
const DOOR_OUTER = 0.98;
/** Bands across a door leaf's rim, every other one striped. */
const HAZARD_STRIPES = 6;

/** A point at `radius` on bearing `angle`, at radius 1. */
const polar = (angle: number, radius: number): Point => ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });

/**
 * The hull at radius 1, its hangar facing +x and its long axis across it: a rounded prow around the hangar, swept
 * wings out to the tips and a blunt stern with two engine pods, reaching most of the way round its hit circle.
 */
const HULL: readonly Point[] = [
  ...Array.from({ length: 7 }, (_, i) => polar(-0.62 + (i / 6) * 1.24, 0.96)),
  { x: 0.6, y: 0.72 },
  { x: 0.36, y: 0.92 },
  { x: 0.12, y: 1.02 },
  { x: -0.12, y: 0.96 },
  { x: -0.34, y: 0.78 },
  { x: -0.56, y: 0.56 },
  { x: -0.74, y: 0.3 },
  { x: -0.8, y: 0.12 },
  { x: -0.8, y: -0.12 },
  { x: -0.74, y: -0.3 },
  { x: -0.56, y: -0.56 },
  { x: -0.34, y: -0.78 },
  { x: -0.12, y: -0.96 },
  { x: 0.12, y: -1.02 },
  { x: 0.36, y: -0.92 },
  { x: 0.6, y: -0.72 },
];

/** The raised spine along the hull's length. */
const DECK: readonly Point[] = [
  { x: 0.28, y: 0.4 },
  { x: 0.02, y: 0.74 },
  { x: -0.3, y: 0.52 },
  { x: -0.4, y: 0 },
  { x: -0.3, y: -0.52 },
  { x: 0.02, y: -0.74 },
  { x: 0.28, y: -0.4 },
];

/** Where the engines and the wing lights sit, at radius 1. */
export const ENGINES: readonly Point[] = [{ x: -0.72, y: 0.2 }, { x: -0.72, y: -0.2 }];
const WING_LIGHTS: readonly Point[] = [{ x: 0.12, y: 0.94 }, { x: 0.12, y: -0.94 }, { x: -0.16, y: 0.86 }, { x: -0.16, y: -0.86 }];

/** Traces an annular sector from `from` to `to` radians, between radii `inner` and `outer`. */
function sector(ctx: CanvasRenderingContext2D, from: number, to: number, inner: number, outer: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, outer, from, to);
  ctx.arc(0, 0, inner, to, from, true);
  ctx.closePath();
}

/** The carrier's hull, its hangar facing +x: gunmetal plating with Ion Reach trims, the bay a dark recess in its prow. */
export function paintHiveHull(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  const trim = p.accent[2];
  ctx.lineJoin = 'round';
  tracePath(ctx, scaled(HULL, r));
  ctx.fillStyle = addStops(ctx.createRadialGradient(0.25 * r, -0.35 * r, 0.05 * r, 0, 0, 1.05 * r), [PLATE_LIT, PLATE, PLATE_DEEP], [0, 0.5, 1]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Panel seams across the beam, and the spine deck over them.
  for (const y of [-0.82, -0.6, 0.6, 0.82]) {
    ctx.beginPath();
    ctx.moveTo(-0.6 * r, y * r);
    ctx.lineTo(0.9 * r, y * r);
    strokePath(ctx, rgba(BLACK, 0.35), 0.02 * r);
  }
  tracePath(ctx, scaled(DECK, r));
  ctx.fillStyle = addStops(ctx.createLinearGradient(-0.5 * r, 0, 0.5 * r, 0), [mix(PLATE, PLATE_DEEP, 0.4), mix(PLATE_LIT, PLATE, 0.4)], [0, 1]);
  ctx.fill();
  strokePath(ctx, rgba(trim, 0.55), 0.02 * r);
  // The bay: a dark recess in the prow, rimmed in trim.
  sector(ctx, -HANGAR_HALF_ARC, HANGAR_HALF_ARC, BAY_INNER * r, BAY_OUTER * r);
  ctx.fillStyle = mix(PLATE_DEEP, BLACK, 0.6);
  ctx.fill();
  strokePath(ctx, rgba(trim, 0.7), 0.025 * r);
  for (const e of ENGINES) {
    ctx.beginPath();
    ctx.arc(e.x * r, e.y * r, 0.09 * r, 0, TAU);
    ctx.fillStyle = mix(PLATE_DEEP, BLACK, 0.4);
    ctx.fill();
    strokePath(ctx, rgba(trim, 0.8), 0.025 * r);
  }
  paintGlow(ctx, WHITE, 0.25 * r, -0.35 * r, 0.5 * r, 0.12);
  ctx.restore();
  for (const light of WING_LIGHTS) paintGlow(ctx, p.accent[0], light.x * r, light.y * r, 0.07 * r, 1);
  tracePath(ctx, scaled(HULL, r));
  strokePath(ctx, rgba(mix(trim, WHITE, 0.4), 0.6), 2);
}

/** One leaf of the hangar doors, from the bay's middle (bearing 0) to `side` times its half-arc: pale armour with hazard stripes. */
export function paintHiveDoor(ctx: CanvasRenderingContext2D, r: number, p: Palette, side: 1 | -1): void {
  const [from, to] = side === 1 ? [0, HANGAR_HALF_ARC] : [-HANGAR_HALF_ARC, 0];
  const [inner, outer] = [(BAY_INNER - 0.03) * r, DOOR_OUTER * r];
  sector(ctx, from, to, inner, outer);
  ctx.fillStyle = addStops(ctx.createLinearGradient(inner, 0, outer, 0), [mix(PLATE, PLATE_LIT, 0.35), mix(PLATE_LIT, WHITE, 0.15)], [0, 1]);
  ctx.fill();
  strokePath(ctx, rgba(PLATE_DEEP, 0.9), 0.02 * r);
  ctx.save();
  ctx.clip();
  // Hazard stripes across the leaf, in the Dimension's light.
  const stripe = rgba(p.accent[0], 0.75);
  for (let i = 1; i < HAZARD_STRIPES; i += 2) {
    const a0 = from + ((to - from) * i) / HAZARD_STRIPES;
    const a1 = from + ((to - from) * (i + 1)) / HAZARD_STRIPES;
    sector(ctx, a0, a1, (DOOR_OUTER - 0.1) * r, outer);
    ctx.fillStyle = stripe;
    ctx.fill();
  }
  ctx.restore();
  // The leading edge, where the two leaves meet.
  ctx.beginPath();
  ctx.moveTo(inner, 0);
  ctx.lineTo(outer, 0);
  strokePath(ctx, rgba(mix(p.accent[0], WHITE, 0.4), 0.95), 0.03 * r);
}

/** The light of the open bay, for drawing additively over it: a hot recess glowing out of the prow. */
export function paintHiveBay(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  const hot = p.accent[2];
  sector(ctx, -HANGAR_HALF_ARC, HANGAR_HALF_ARC, BAY_INNER * r, BAY_OUTER * r);
  ctx.fillStyle = addStops(ctx.createRadialGradient(0.78 * r, 0, 0, 0.78 * r, 0, 0.45 * r), [mix(hot, WHITE, 0.7), rgba(hot, 0.85), rgba(hot, 0.25)], [0, 0.45, 1]);
  ctx.fill();
  paintGlow(ctx, hot, 0.8 * r, 0, 0.35 * r, 0.9);
}
