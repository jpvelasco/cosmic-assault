import type { Field } from '../sim/field';
import { createRng, deriveSeed, type Rng } from '../sim/rng';
import { isLegacySky, type BackdropSpec } from './backdropSpec';
import { drawPiece } from './backdropPieces';
import { rgba } from './color';
import { get2dContext } from './context';
import type { Palette } from './palette';

const DUST_COUNT = 320;
const DUST_MAX_ALPHA = 0.3;
const SKY_STOP_POSITIONS = [0, 0.55, 1] as const;
/** A spec moves each nebula glow's centre by up to this fraction of the field, kept between the two bounds. */
const GLOW_SHIFT = 0.12;
const GLOW_CENTRE_MIN = 0.05;
const GLOW_CENTRE_MAX = 0.95;
const GLOW_RADIUS_SCALE: readonly [number, number] = [0.85, 1.2];
const GLOW_ALPHA_SCALE: readonly [number, number] = [0.85, 1.15];
/** The sky gradient turns by at most this many radians either way from the field's diagonal. */
const SKY_TURN = Math.PI / 12;
/** The mockup's vignette: clear inside 0.35 × height, darkening to this alpha at 0.62 × width. */
const VIGNETTE_ALPHA = 0.4;
const VIGNETTE_INNER = 0.35;
const VIGNETTE_OUTER = 0.62;
/** The vignette is a smooth gradient, so it bakes at this fraction of the sky's resolution per axis and is drawn stretched. */
const VIGNETTE_RESOLUTION = 0.25;

/** A transparent offscreen canvas covering `field` at `pixelsPerUnit` backing pixels per unit, ready to paint in field units. */
function fieldCanvas(field: Field, pixelsPerUnit: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(field.width * pixelsPerUnit));
  canvas.height = Math.max(1, Math.round(field.height * pixelsPerUnit));
  const ctx = get2dContext(canvas);
  ctx.setTransform(pixelsPerUnit, 0, 0, pixelsPerUnit, 0, 0);
  return { canvas, ctx };
}

type Glow = Palette['nebula'][number];

/** What a spec varies about the sky: the gradient's turn (null for the legacy diagonal) and the glows, last one last. */
interface SkyGeometry {
  readonly turn: number | null;
  readonly nebula: readonly Glow[];
}

function clampCentre(value: number): number {
  return Math.min(GLOW_CENTRE_MAX, Math.max(GLOW_CENTRE_MIN, value));
}

/** The palette's glows, each moved, resized and scaled in strength by `rng`, with one drawn last. */
function varyGlows(nebula: readonly Glow[], rng: Rng): Glow[] {
  const glows = nebula.map((glow) => ({
    ...glow,
    x: clampCentre(glow.x + rng.range(-GLOW_SHIFT, GLOW_SHIFT)),
    y: clampCentre(glow.y + rng.range(-GLOW_SHIFT, GLOW_SHIFT)),
    r: glow.r * rng.range(GLOW_RADIUS_SCALE[0], GLOW_RADIUS_SCALE[1]),
    alpha: glow.alpha * rng.range(GLOW_ALPHA_SCALE[0], GLOW_ALPHA_SCALE[1]),
  }));
  const last = rng.pick(glows);
  return [...glows.filter((glow) => glow !== last), last];
}

/** The sky's geometry for `spec`. The legacy sky paints the palette's own glows; any other spec varies them from its seed. */
function geometryFor(palette: Palette, spec: BackdropSpec): SkyGeometry {
  if (isLegacySky(spec)) return { turn: null, nebula: palette.nebula };
  const rng = createRng(deriveSeed(spec.seed, 'sky'));
  const turn = rng.range(-SKY_TURN, SKY_TURN);
  return { turn, nebula: varyGlows(palette.nebula, rng) };
}

/** A gradient line through the field's centre, turned `turn` radians from its diagonal and long enough to reach every corner. */
function turnedGradient(ctx: CanvasRenderingContext2D, field: Field, turn: number): CanvasGradient {
  const angle = Math.atan2(field.height, field.width) + turn;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const half = (field.width * Math.abs(ux) + field.height * Math.abs(uy)) / 2;
  const cx = field.width / 2;
  const cy = field.height / 2;
  return ctx.createLinearGradient(cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half);
}

/**
 * Paints the palette's diagonal gradient, nebula glows and faint dust onto a fresh offscreen canvas covering `field`, with
 * `pixelsPerUnit` backing pixels per logical unit so it blits 1:1. A spec varies only the geometry (the glows' places,
 * sizes and strengths, the gradient's turn) and places the dust; the colours and sky stops are always the palette's.
 * Bake once per resize and palette: it is far too costly to redraw each frame.
 */
export function bakeSky(field: Field, pixelsPerUnit: number, palette: Palette, spec: BackdropSpec): HTMLCanvasElement {
  const { canvas, ctx } = fieldCanvas(field, pixelsPerUnit);
  const { turn, nebula } = geometryFor(palette, spec);

  const sky = turn === null ? ctx.createLinearGradient(0, 0, field.width, field.height) : turnedGradient(ctx, field, turn);
  palette.skyStops.forEach((color, i) => {
    sky.addColorStop(SKY_STOP_POSITIONS[i] as number, color);
  });
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, field.width, field.height);

  for (const { x, y, r, color, alpha } of nebula) {
    const cx = x * field.width;
    const cy = y * field.height;
    const radius = r * field.height;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, rgba(color, alpha));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  if (!isLegacySky(spec)) drawPiece(ctx, spec, palette, field, createRng(deriveSeed(spec.seed, 'piece')));

  const rng = createRng(spec.seed);
  ctx.fillStyle = palette.star;
  for (let i = 0; i < DUST_COUNT; i++) {
    ctx.globalAlpha = rng.range(0, DUST_MAX_ALPHA);
    ctx.fillRect(rng.range(0, field.width), rng.range(0, field.height), 1, 1);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * The darkened corners drawn over the scene, baked like the sky so a frame costs one blit. It bakes at
 * a quarter of `pixelsPerUnit` per axis, so draw it stretched over the field.
 */
export function bakeVignette(field: Field, pixelsPerUnit: number, colour = '#000000', alpha = VIGNETTE_ALPHA): HTMLCanvasElement {
  const { canvas, ctx } = fieldCanvas(field, pixelsPerUnit * VIGNETTE_RESOLUTION);
  const cx = field.width / 2;
  const cy = field.height / 2;
  const shade = ctx.createRadialGradient(cx, cy, field.height * VIGNETTE_INNER, cx, cy, field.width * VIGNETTE_OUTER);
  shade.addColorStop(0, rgba(colour, 0));
  shade.addColorStop(1, rgba(colour, alpha));
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, field.width, field.height);
  return canvas;
}

/** Time Warp's cool vignette: the same shading as the sky's, in a cool blue that reads as slowed time. */
export const TIME_WARP_TINT = '#6f9cff';
const TIME_WARP_ALPHA = 0.6;

/** A baked Time Warp vignette for `field`, drawn over the field while the warp runs and never as a filter. */
export function bakeTimeWarp(field: Field, pixelsPerUnit: number): HTMLCanvasElement {
  return bakeVignette(field, pixelsPerUnit, TIME_WARP_TINT, TIME_WARP_ALPHA);
}
