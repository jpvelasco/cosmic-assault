import { rgba } from './color';

/** A pill's box in CSS px from the viewport's top left. */
export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const WHITE = '#ffffff';
/** Room inside a pill either side of its text, in CSS px at scale 1. */
export const PILL_PAD = 12;
export const BRIGHT_STROKE = rgba(WHITE, 0.45);

export const box = (): HudRect => ({ x: 0, y: 0, width: 0, height: 0 });
export const bottom = (r: HudRect): number => r.y + r.height;

/** Fills and strokes `r` as a pill with the current styles. */
export function tracePill(ctx: CanvasRenderingContext2D, r: HudRect): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, r.height / 2);
  ctx.fill();
  ctx.stroke();
}

/** Fills the first `width` of bar `r` with `style`, rounded at both ends. */
export function fillBar(ctx: CanvasRenderingContext2D, r: HudRect, width: number, style: string | CanvasGradient): void {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, width, r.height, r.height / 2);
  ctx.fill();
}

/** A left-to-right gradient across `r`, from `from` to `to`; made on layout, not per frame. */
export function across(ctx: CanvasRenderingContext2D, r: HudRect, from: string, to: string): CanvasGradient {
  const gradient = ctx.createLinearGradient(r.x, 0, r.x + r.width, 0);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  return gradient;
}
