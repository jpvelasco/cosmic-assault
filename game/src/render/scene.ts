import type { Field } from '../sim/field';
import type { Sprite } from './sprites';
import type { VisualScale } from './visualScale';

/** Draws a sprite centred at (x, y), turned by (cos, sin), with the wrap copies an entity of `radius` needs. */
export type Stamp = (sprite: Sprite, x: number, y: number, cos: number, sin: number, radius: number, field: Field) => void;

/** What the scene passes draw a frame with; the renderer keeps one and updates it in place each frame. */
export interface SceneLook {
  /** The quality level's glow strength, 0–1. */
  readonly glow: number;
  /** Reduced motion: hold pulses and blinks steady. */
  readonly still: boolean;
  /** Seconds of play, for spins and pulses; it stands still while the game is paused. */
  readonly time: number;
  /** How much larger than their field size sprites are drawn at this layout. */
  readonly visual: VisualScale;
}

/** Fast at first, settling at the end: t from 0 to 1. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * The visual scale a pass's painters bake at, which it sets each frame. The baker drops every sprite when that scale
 * changes, so they rebake with the new one.
 */
export interface Zoom {
  /** The scale the next bake paints at. */
  value: number;
  /** `paint`, scaled up by the zoom in force when it runs. */
  wrap(paint: (ctx: CanvasRenderingContext2D) => void): (ctx: CanvasRenderingContext2D) => void;
}

export function createZoom(): Zoom {
  const zoom: Zoom = {
    value: 1,
    wrap: (paint) => (ctx) => {
      ctx.scale(zoom.value, zoom.value);
      paint(ctx);
    },
  };
  return zoom;
}
