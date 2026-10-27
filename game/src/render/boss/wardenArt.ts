import { TAU } from '../../sim/math';
import { mix, rgba } from '../color';
import type { Palette } from '../palette';
import { addStops, paintGlow, strokePath } from '../sprites';

const WHITE = '#ffffff';
const BLACK = '#000000';
/** Burnished steel, lit to shadowed. */
const STEEL_LIT = '#d8dcea';
const STEEL = '#4a5070';
const STEEL_DEEP = '#10121e';
/** How far the core's sprite reaches past its radius: its collar's rim. */
export const WARDEN_ART_REACH = 1.02;
/** The core's eye, as shares of its radius: the iris and the pupil. */
const IRIS = 0.5;
const PUPIL = 0.2;
/** Armour plates round the core's collar. */
const COLLAR_PLATES = 8;
/** A turret's barrel along +x, as shares of its radius: how far it reaches past the dome, and its half-width. */
export const BARREL_REACH = 1.35;
const BARREL_HALF = 0.28;
/** The track the turrets ride: its half-width either side of the ring, in field units, and the gaps' markers. */
const TRACK_HALF = 3;
const GAP_MARK = 7;

/** The Warden's steel, tinted toward the Dimension's rock so it sits in its sky. */
function steel(p: Palette): readonly [string, string, string] {
  const [lit, mid, shade] = p.rock;
  return [mix(STEEL_LIT, lit, 0.25), mix(STEEL, mid, 0.25), mix(STEEL_DEEP, shade, 0.3)];
}

/** A glossy dome of steel at the origin, lit from the upper left, with a white specular highlight and a thin rim. */
function paintDome(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  const [lit, mid, shade] = steel(p);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.4 * r, -0.45 * r, 0.05 * r, 0, 0, 1.05 * r), [lit, mid, shade], [0, 0.5, 1]);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.4), Math.max(1, r * 0.04));
  ctx.beginPath();
  ctx.ellipse(-0.38 * r, -0.45 * r, 0.3 * r, 0.16 * r, -0.6, 0, TAU);
  ctx.fillStyle = rgba(WHITE, 0.55);
  ctx.fill();
}

/**
 * The Warden's core, radius `r`: a steel sphere in a collar of armour plates, staring out of one glowing eye in the
 * hostile hue, which reads as the thing to shoot.
 */
export function paintWardenCore(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  const eye = p.accent[0];
  const [, mid, shade] = steel(p);
  ctx.lineJoin = 'round';
  for (let i = 0; i < COLLAR_PLATES; i++) {
    const a = (i / COLLAR_PLATES) * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, r * WARDEN_ART_REACH, a + 0.06, a + TAU / COLLAR_PLATES - 0.06);
    ctx.arc(0, 0, r * 0.8, a + TAU / COLLAR_PLATES - 0.1, a + 0.1, true);
    ctx.closePath();
    ctx.fillStyle = addStops(ctx.createLinearGradient(-r, -r, r, r), [mix(mid, WHITE, 0.25), shade], [0, 1]);
    ctx.fill();
    strokePath(ctx, rgba(BLACK, 0.5), 1);
  }
  paintDome(ctx, r * 0.82, p);
  ctx.beginPath();
  ctx.arc(0, 0, r * IRIS, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(0, 0, 0, 0, 0, r * IRIS), [mix(eye, WHITE, 0.6), eye, mix(eye, BLACK, 0.55)], [0, 0.55, 1]);
  ctx.fill();
  strokePath(ctx, rgba(BLACK, 0.7), Math.max(1.5, r * 0.05));
  ctx.beginPath();
  ctx.arc(0, 0, r * PUPIL, 0, TAU);
  ctx.fillStyle = mix(eye, BLACK, 0.8);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-0.12 * r, -0.14 * r, r * 0.08, 0, TAU);
  ctx.fillStyle = rgba(WHITE, 0.85);
  ctx.fill();
}

/** The eye's light, for drawing additively over the core: a soft bloom of the hostile hue. */
export function paintWardenEye(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  paintGlow(ctx, p.accent[0], 0, 0, r * 0.9, 0.9);
}

/**
 * A turret of radius `r`, its barrel along +x: a glossy steel dome with a muzzle lit in the hostile hue. `damage` from 0
 * (whole) to 2 (one blow from breaking) splits it with glowing cracks, so a ship sees how near it is to going.
 */
export function paintTurret(ctx: CanvasRenderingContext2D, r: number, p: Palette, damage: number): void {
  const hostile = p.accent[0];
  const [lit, mid, shade] = steel(p);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.roundRect(0, -BARREL_HALF * r, BARREL_REACH * r, BARREL_HALF * 2 * r, BARREL_HALF * r);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, -BARREL_HALF * r, 0, BARREL_HALF * r), [lit, mid, shade], [0, 0.45, 1]);
  ctx.fill();
  strokePath(ctx, rgba(BLACK, 0.6), 1);
  paintDome(ctx, r * 0.9, p);
  ctx.beginPath();
  ctx.arc(BARREL_REACH * r - BARREL_HALF * r, 0, BARREL_HALF * 0.7 * r, 0, TAU);
  ctx.fillStyle = mix(hostile, WHITE, 0.3);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.1 * r, 0, 0.3 * r, 0, TAU);
  ctx.fillStyle = rgba(hostile, 0.85);
  ctx.fill();
  strokePath(ctx, rgba(BLACK, 0.6), 1);
  if (damage <= 0) return;
  ctx.lineCap = 'round';
  const cracks: readonly (readonly [number, number])[][] = [
    [[-0.7, -0.5], [-0.25, -0.1], [-0.35, 0.3], [0.05, 0.75]],
    [[0.55, -0.65], [0.2, -0.25], [0.45, 0.2]],
  ];
  for (const crack of cracks.slice(0, damage)) {
    ctx.beginPath();
    for (const [x, y] of crack) ctx.lineTo(x * r, y * r);
    strokePath(ctx, rgba(BLACK, 0.9), 0.18 * r);
    strokePath(ctx, rgba(hostile, 0.95), 0.07 * r);
  }
}

/**
 * The track the turrets ride, radius `radius` and `slots` slots, slot 0 along +x: a thin steel band round the core, open
 * across each slot in `gaps`, with a bright marker either side of each opening so a ship sees where it can fly through.
 */
export function paintTrack(ctx: CanvasRenderingContext2D, radius: number, slots: number, gaps: readonly number[], p: Palette): void {
  const slot = TAU / slots;
  const [, mid] = steel(p);
  ctx.lineCap = 'round';
  for (let i = 0; i < slots; i++) {
    if (gaps.includes(i)) continue;
    // Each slot that holds a turret carries the band from halfway to the slot before it to halfway to the next.
    const from = (i - 0.5) * slot;
    const to = (i + 0.5) * slot;
    for (const [color, width] of [
      [rgba(BLACK, 0.55), TRACK_HALF * 2 + 2],
      [rgba(mid, 0.9), TRACK_HALF * 2],
      [rgba(WHITE, 0.25), 1],
    ] as const) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, from, to);
      strokePath(ctx, color, width);
    }
  }
  for (const gap of gaps) {
    for (const side of [-0.5, 0.5]) {
      const a = (gap + side) * slot;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (radius - GAP_MARK), Math.sin(a) * (radius - GAP_MARK));
      ctx.lineTo(Math.cos(a) * (radius + GAP_MARK), Math.sin(a) * (radius + GAP_MARK));
      strokePath(ctx, rgba(p.ring, 0.95), 3);
    }
  }
}

/** A glowing band at `radius` all the way round, for drawing additively: a ring warning of where the turrets will sweep. */
export function paintGhostRing(ctx: CanvasRenderingContext2D, radius: number, color: string): void {
  for (const [alpha, width] of [
    [0.3, 26],
    [0.65, 9],
    [1, 3],
  ] as const) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    strokePath(ctx, rgba(color, alpha), width);
  }
}

/** A target reticle of radius `r` in `color`: a ring broken by four ticks pointing in, for the ship a lock-on aims at. */
export function paintReticle(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + TAU / 8;
    ctx.beginPath();
    ctx.arc(0, 0, r, a - 0.5, a + 0.5);
    strokePath(ctx, rgba(BLACK, 0.6), 5);
    strokePath(ctx, color, 2.5);
    const t = a - TAU / 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(t) * r * 1.25, Math.sin(t) * r * 1.25);
    ctx.lineTo(Math.cos(t) * r * 0.7, Math.sin(t) * r * 0.7);
    strokePath(ctx, color, 2.5);
  }
}
