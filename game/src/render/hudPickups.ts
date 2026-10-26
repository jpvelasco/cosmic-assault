import { clamp } from '../content/curves';
import { EFFECT_SECONDS, type TimedPickupId } from '../content/pickups';
import { TAU } from '../sim/math';
import { rgba } from './color';
import { WHITE, type HudRect } from './hudShapes';
import { drawGlyph, expiryAlpha, PICKUP_COLORS } from './pickupArt';
import { strokePath } from './sprites';

/** A pickup pill is a round badge this many CSS px across at scale 1, centred on the lives row. */
export const PICKUP_PILL_SIZE = 24;
const ARC_WIDTH = 2.5;
const GLYPH_SHARE = 0.27;
const TRACK = rgba(WHITE, 0.16);
const RIM = rgba(WHITE, 0.22);
/** Each kind's glass tint, made once. */
const TINTS = Object.fromEntries(Object.entries(PICKUP_COLORS).map(([kind, color]) => [kind, rgba(color, 0.24)])) as Readonly<Record<TimedPickupId, string>>;

/** The share of `kind`'s effect still to run, from 1 as it is collected down to 0, which the arc sweeps. */
export function pillFraction(kind: TimedPickupId, left: number): number {
  return clamp(left / EFFECT_SECONDS[kind], 0, 1);
}

/** Puts pill `r` at `x`, centred on the row `row` sits on. */
export function placePickupPill(r: HudRect, x: number, row: HudRect, scale: number): void {
  const size = PICKUP_PILL_SIZE * scale;
  Object.assign(r, { x, y: row.y + (row.height - size) / 2, width: size, height: size });
}

/**
 * A timed pickup's badge: tinted glass, a track with the remaining time swept clockwise from the top in the kind's
 * colour, and its glyph. It blinks through the last 2 s (held dim when `still`). Allocates nothing.
 */
export function drawPickupPill(ctx: CanvasRenderingContext2D, r: HudRect, kind: TimedPickupId, left: number, still: boolean, scale: number): void {
  const half = r.width / 2;
  const cx = r.x + half;
  const cy = r.y + half;
  const arc = half - (ARC_WIDTH * scale) / 2 - 0.5 * scale;
  ctx.globalAlpha = expiryAlpha(left, still);
  ctx.beginPath();
  ctx.arc(cx, cy, half, 0, TAU);
  ctx.fillStyle = TINTS[kind];
  ctx.fill();
  strokePath(ctx, RIM, 1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, arc, 0, TAU);
  strokePath(ctx, TRACK, ARC_WIDTH * scale);
  const share = pillFraction(kind, left);
  if (share > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, arc, -Math.PI / 2, -Math.PI / 2 + share * TAU);
    strokePath(ctx, PICKUP_COLORS[kind], ARC_WIDTH * scale);
  }
  drawGlyph(ctx, kind, cx, cy, half * GLYPH_SHARE * 2, WHITE);
  ctx.globalAlpha = 1;
}
