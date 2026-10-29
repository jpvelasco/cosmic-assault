import { clamp } from '../content/curves';
import { BLACK_HOLE } from '../content/hazards';
import { TAU } from '../sim/math';
import { BLACK, mix, rgba, WHITE } from './color';
import { strokePath } from './sprites';

// The hazards' painters, each baked once into a sprite by the hazard pass, and the timing its sprites are drawn by.

/**
 * The black hole: its dark lens is drawn at its true horizon, its bent-light halo and accretion ring at the warning ring's
 * radius. The ring is a flat ellipse.
 */
const HOLE_HORIZON = BLACK_HOLE.horizon;
/** The lens's halo and the accretion ring's reach, both the warning ring's radius (`BLACK_HOLE.warnRadius`). */
export const HOLE_RING_RADIUS = BLACK_HOLE.warnRadius;
export const HOLE_DISC_SQUASH = 0.32;

/** Seconds the well takes to swirl up as it starts and to fade as it ends. */
const FADE_IN_SECONDS = 0.5;
const FADE_OUT_SECONDS = 0.8;
/** Under reduced motion the arcs hold still and the swirl only breathes: this slowly, between this alpha and 1. */
const STILL_PULSE_HZ = 0.7;
const STILL_PULSE_LOW = 0.6;

/** Segments per arc: each brighter and wider toward the head, so the arc trails off like a comet. */
const ARC_SEGMENTS = 28;
const HORIZON = 0.2;

/** A zone's hatching: the gap between its stripes, in field units, and the dash and gap of its warning outline. */
const HATCH_GAP = 16;
const ZONE_DASH = 14;

/** Diagonal stripes `HATCH_GAP` apart across the `w` by `h` rectangle centred on the origin. */
function hatch(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, width: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let d = -h; d < w; d += HATCH_GAP) {
    ctx.moveTo(-w / 2 + d, h / 2);
    ctx.lineTo(-w / 2 + d + h, -h / 2);
  }
  strokePath(ctx, color, width);
  ctx.restore();
}

/** A zone's warning: a dashed outline, its corners marked solid, over faint hatching. */
export function paintZoneWarning(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  hatch(ctx, w, h, rgba(color, 0.22), 2);
  ctx.setLineDash([ZONE_DASH, ZONE_DASH * 0.6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.setLineDash([]);
  const corner = Math.min(w, h) * 0.18;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    ctx.moveTo((sx * w) / 2, (sy * h) / 2 - sy * corner);
    ctx.lineTo((sx * w) / 2, (sy * h) / 2);
    ctx.lineTo((sx * w) / 2 - sx * corner, (sy * h) / 2);
  }
  strokePath(ctx, mix(color, WHITE, 0.3), 3.5);
}

/** A lethal zone: filled and hatched in the hostile hue, outlined solid and bright. */
export function paintZoneActive(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.fillStyle = rgba(color, 0.14);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  hatch(ctx, w, h, rgba(color, 0.45), 3);
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.lineWidth = 8;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = mix(color, WHITE, 0.35);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
}

/** A comet arc round the centre at radius `r`, its head at angle 0, sweeping `sweep` of a turn behind it. */
export function paintArc(ctx: CanvasRenderingContext2D, r: number, sweep: number, width: number, color: string): void {
  const head = mix(color, WHITE, 0.55);
  ctx.lineCap = 'round';
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const t = (i + 1) / ARC_SEGMENTS;
    const from = -(1 - i / ARC_SEGMENTS) * sweep * TAU;
    const to = -(1 - t) * sweep * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, r, from, to + 0.02);
    strokePath(ctx, rgba(t > 0.85 ? head : color, t * t * 0.95), width * (0.35 + 0.65 * t));
  }
}

/** A dashed ring: a warp rift's warning, drawn at `r` in `color`. */
export function paintDashedRing(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  strokePath(ctx, rgba(color, 0.85), 2.5);
  ctx.setLineDash([]);
}

/** A ring that ripples outward from a repulsion field: a soft band with a bright rim. */
export function paintRipple(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  strokePath(ctx, rgba(color, 0.3), 7);
  strokePath(ctx, mix(color, WHITE, 0.45), 1.8);
}

/** The dark lens at the well's heart, with a thin bright photon ring at its rim. */
export function paintHorizon(ctx: CanvasRenderingContext2D, r: number, rim: string): void {
  const inner = HORIZON * r;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, inner * 1.9);
  gradient.addColorStop(0, rgba(BLACK, 0.95));
  gradient.addColorStop(0.5, rgba(BLACK, 0.85));
  gradient.addColorStop(1, rgba(BLACK, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-inner * 2, -inner * 2, inner * 4, inner * 4);
  ctx.beginPath();
  ctx.arc(0, 0, inner * 1.05, 0, TAU);
  strokePath(ctx, rgba(mix(rim, WHITE, 0.6), 0.9), 1.6);
}

/** The black hole's lens: a bent-light halo just beyond the horizon, the dark disc within it and a bright photon ring at its rim. */
export function paintLens(ctx: CanvasRenderingContext2D, rim: string): void {
  const halo = ctx.createRadialGradient(0, 0, HOLE_HORIZON, 0, 0, HOLE_RING_RADIUS);
  halo.addColorStop(0, rgba(rim, 0.5));
  halo.addColorStop(1, rgba(rim, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-HOLE_RING_RADIUS, -HOLE_RING_RADIUS, HOLE_RING_RADIUS * 2, HOLE_RING_RADIUS * 2);
  const dark = ctx.createRadialGradient(0, 0, 0, 0, 0, HOLE_HORIZON * 1.1);
  dark.addColorStop(0, rgba(BLACK, 1));
  dark.addColorStop(0.85, rgba(BLACK, 0.97));
  dark.addColorStop(1, rgba(BLACK, 0));
  ctx.fillStyle = dark;
  ctx.fillRect(-HOLE_HORIZON * 1.1, -HOLE_HORIZON * 1.1, HOLE_HORIZON * 2.2, HOLE_HORIZON * 2.2);
  ctx.beginPath();
  ctx.arc(0, 0, HOLE_HORIZON * 1.02, 0, TAU);
  strokePath(ctx, rgba(mix(rim, WHITE, 0.6), 0.95), 2);
}

/** The accretion ring: a flat, glowing ellipse, with a hot head on one side that carries the turn. */
export function paintDisc(ctx: CanvasRenderingContext2D, color: string): void {
  const rx = HOLE_RING_RADIUS;
  const ry = HOLE_RING_RADIUS * HOLE_DISC_SQUASH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  strokePath(ctx, rgba(color, 0.18), 10);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  strokePath(ctx, rgba(color, 0.7), 3.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, -0.6, 0.6);
  strokePath(ctx, rgba(mix(color, WHITE, 0.7), 0.95), 2.2);
}

/** The black hole's warning: a dashed ring where its accretion will be, and a solid one at its horizon. */
export function paintHoleWarning(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  ctx.arc(0, 0, HOLE_RING_RADIUS, 0, TAU);
  strokePath(ctx, rgba(color, 0.9), 2.5);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, HOLE_HORIZON, 0, TAU);
  strokePath(ctx, rgba(mix(color, WHITE, 0.4), 0.9), 1.6);
}

/** The warning: a thin ring with a fainter halo either side of it. */
export function paintOutline(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  for (const [width, alpha] of [
    [9, 0.12],
    [4, 0.3],
    [1.6, 0.95],
  ] as const) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    strokePath(ctx, rgba(color, alpha), width);
  }
}

/**
 * How strongly an active hazard of `seconds` in all, with `remaining` to go, is drawn: building up over `fadeIn` as it
 * starts, fading over `fadeOut` as it ends.
 */
export function presenceOf(remaining: number, seconds: number, fadeIn = FADE_IN_SECONDS, fadeOut = FADE_OUT_SECONDS): number {
  return Math.min(clamp((seconds - remaining) / fadeIn, 0, 1), clamp(remaining / fadeOut, 0, 1));
}

/** A wave from 0 to 1 and back, `hz` times a second, `time` seconds in. */
export const wave = (time: number, hz: number): number => 0.5 + 0.5 * Math.sin(time * TAU * hz);

/** An open swirl's opacity: 1 while it turns; under reduced motion, which freezes it, a slow breath shows it still acts. */
export const breathOf = (time: number, still: boolean): number => (still ? STILL_PULSE_LOW + (1 - STILL_PULSE_LOW) * wave(time, STILL_PULSE_HZ) : 1);
