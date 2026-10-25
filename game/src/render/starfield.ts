import type { Field } from '../sim/field';
import { get2dContext } from './context';
import { createRng } from '../sim/rng';

const STAR_SEED = 0x57a7f1e1;
/** The canvas clear colour, shared with the renderer so the baked sky blends in. */
export const BACKGROUND = '#05060f';
/** One star per this many logical square units. */
const AREA_PER_STAR = 3500;
const STAR_COLORS = ['#ffffff', '#cfd8ff', '#9fb2ff'] as const;

/**
 * Paints a seeded static starfield onto a fresh offscreen canvas covering `field`,
 * with `pixelsPerUnit` backing pixels per logical unit so it blits 1:1 on screen.
 */
export function bakeStarfield(field: Field, pixelsPerUnit: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(field.width * pixelsPerUnit));
  canvas.height = Math.max(1, Math.round(field.height * pixelsPerUnit));
  const ctx = get2dContext(canvas);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(pixelsPerUnit, 0, 0, pixelsPerUnit, 0, 0);

  const rng = createRng(STAR_SEED);
  const count = Math.round((field.width * field.height) / AREA_PER_STAR);
  for (let i = 0; i < count; i++) {
    const size = rng.range(0.6, 1.8);
    ctx.globalAlpha = rng.range(0.35, 1);
    ctx.fillStyle = rng.pick(STAR_COLORS);
    ctx.fillRect(rng.range(0, field.width), rng.range(0, field.height), size, size);
  }
  return canvas;
}
