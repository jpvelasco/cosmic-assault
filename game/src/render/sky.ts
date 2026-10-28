import type { Field } from '../sim/field';
import { createRng } from '../sim/rng';
import { rgba } from './color';
import { get2dContext } from './context';
import type { Palette } from './palette';

const DUST_COUNT = 320;
const DUST_MAX_ALPHA = 0.3;
const SKY_STOP_POSITIONS = [0, 0.55, 1] as const;
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

/**
 * Paints the palette's diagonal gradient, nebula glows and faint dust (placed by `seed`) onto a fresh
 * offscreen canvas covering `field`, with `pixelsPerUnit` backing pixels per logical unit so it blits 1:1.
 * Bake once per resize and palette: it is far too costly to redraw each frame.
 */
export function bakeSky(field: Field, pixelsPerUnit: number, palette: Palette, seed: number): HTMLCanvasElement {
  const { canvas, ctx } = fieldCanvas(field, pixelsPerUnit);

  const sky = ctx.createLinearGradient(0, 0, field.width, field.height);
  palette.skyStops.forEach((color, i) => {
    sky.addColorStop(SKY_STOP_POSITIONS[i] as number, color);
  });
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, field.width, field.height);

  for (const { x, y, r, color, alpha } of palette.nebula) {
    const cx = x * field.width;
    const cy = y * field.height;
    const radius = r * field.height;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, rgba(color, alpha));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  const rng = createRng(seed);
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
