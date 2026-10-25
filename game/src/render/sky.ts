import type { Field } from '../sim/field';
import { createRng } from '../sim/rng';
import { rgba } from './color';
import { get2dContext } from './context';
import type { Palette } from './palette';

const SKY_SEED = 0x57a7f1e1;
const DUST_COUNT = 320;
const DUST_MAX_ALPHA = 0.3;
const DUST_COLOR = '#fff0ff';
const SKY_STOP_POSITIONS = [0, 0.55, 1] as const;

/**
 * Paints the palette's diagonal gradient, nebula glows and faint dust onto a fresh offscreen
 * canvas covering `field`, with `pixelsPerUnit` backing pixels per logical unit so it blits 1:1.
 * Bake once per resize and palette: it is far too costly to redraw each frame.
 */
export function bakeSky(field: Field, pixelsPerUnit: number, palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(field.width * pixelsPerUnit));
  canvas.height = Math.max(1, Math.round(field.height * pixelsPerUnit));
  const ctx = get2dContext(canvas);
  ctx.setTransform(pixelsPerUnit, 0, 0, pixelsPerUnit, 0, 0);

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

  const rng = createRng(SKY_SEED);
  ctx.fillStyle = DUST_COLOR;
  for (let i = 0; i < DUST_COUNT; i++) {
    ctx.globalAlpha = rng.range(0, DUST_MAX_ALPHA);
    ctx.fillRect(rng.range(0, field.width), rng.range(0, field.height), 1, 1);
  }
  ctx.globalAlpha = 1;
  return canvas;
}
