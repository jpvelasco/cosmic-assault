import { TAU } from '../../sim/math';
import { BLACK, mix, rgba, WHITE } from '../color';
import type { Palette } from '../palette';
import { addStops, strokePath } from '../sprites';

/** The disc is near black, lit only at its rim, so it reads as a body against the bright corona round it. */
const DISC_DEEP = '#07050d';
/** How far the core's sprite reaches past its radius: its limb's rim. */
export const ECLIPSE_ART_REACH = 1.04;
/** The limb's width, as a share of the core's radius. */
const LIMB_WIDTH = 0.07;
/** A shard's crack, as a share of its radius, and how far the cracked shard's glow is dimmed. */
const CRACK_WIDTH = 0.16;
const CRACKED_DIM = 0.55;
/** A warning's stroke, as a share of the shape's radius, and where a spoke starts and ends, in shard radii. */
const WARN_STROKE = 0.2;
const SPOKE_NEAR = 1.1;
const SPOKE_REACH = 2.6;

/** The disc's colour, tinted toward the Dimension's shade so the eclipse sits in its sky. */
function disc(p: Palette): string {
  return mix(DISC_DEEP, p.rock[2], 0.25);
}

/** The eclipse's dark body at the origin, and its bright limb: a thin ring the corona lights from behind. */
export function paintEclipseCore(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(0, 0, 0.2 * r, 0, 0, r), [disc(p), disc(p), BLACK], [0, 0.7, 1]);
  ctx.fill();
  strokePath(ctx, rgba(mix(p.ring, WHITE, 0.4), 0.95), Math.max(1, r * LIMB_WIDTH));
  ctx.beginPath();
  ctx.arc(0, 0, r * (1 - LIMB_WIDTH), Math.PI * 1.1, Math.PI * 1.5);
  strokePath(ctx, rgba(WHITE, 0.55), Math.max(1, r * LIMB_WIDTH * 0.35));
}

/**
 * A corona shard at the origin: a bright crystal of the palette's light, white at its heart and dim at its edge. A
 * cracked one is dimmed and split by a dark fissure, so its damage reads at a glance.
 */
export function paintCoronaShard(ctx: CanvasRenderingContext2D, r: number, p: Palette, cracked: boolean): void {
  const [hot, mid, edge] = [WHITE, p.spark, p.accent[1]];
  ctx.globalAlpha = cracked ? CRACKED_DIM : 1;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.3 * r, -0.3 * r, 0.05 * r, 0, 0, r), [hot, mid, edge], [0, 0.45, 1]);
  ctx.fill();
  if (cracked) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, -r * 0.2);
    ctx.lineTo(r * 0.1, r * 0.1);
    ctx.lineTo(r * 0.85, -r * 0.35);
    strokePath(ctx, rgba(BLACK, 0.9), Math.max(1, r * CRACK_WIDTH));
  }
  ctx.globalAlpha = 1;
}

/** A warning ring at the origin, `r` across, stroked solid in `color`: the shape a shard volley's warning takes about each shard. */
export function paintWarnRing(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  strokePath(ctx, color, Math.max(2, r * WARN_STROKE));
}

/** A warning spoke along +x from the origin, from just past a shard's rim out to `SPOKE_REACH` of its radius, stroked solid in `color`. */
export function paintSpoke(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r * SPOKE_NEAR, 0);
  ctx.lineTo(r * SPOKE_REACH, 0);
  strokePath(ctx, color, Math.max(2, r * WARN_STROKE));
  ctx.lineCap = 'butt';
}
