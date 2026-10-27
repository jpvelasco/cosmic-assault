import { turnBetween } from '../sim/math';
import { get2dContext } from './context';
import type { Sprite } from './sprites';

/** How far, in device pixels, the drawn turn may let a sprite's corners lag the true angle before it is turned again. */
export const MAX_TURN_LAG_PX = 0.5;

/**
 * A big sprite drawn turned. A turned blit resamples every pixel it covers, several times the cost of an upright one on
 * a CPU-rasterized canvas, so the sprite is turned once onto a canvas of its own and that is drawn upright, on whole
 * pixels (`FieldPen.blit`), until the angle moves its corners MAX_TURN_LAG_PX or a different source comes in.
 */
export interface TurnedSprite {
  /** `source` turned to about `angle`, drawn upright and centred on the same point; `angle` says exactly how far. */
  turn(source: Sprite, angle: number): Sprite;
  /** The angle the last sprite returned is turned to. */
  readonly angle: number;
  /** Frees the canvas; the next `turn` draws afresh. */
  release(): void;
}

export function createTurnedSprite(): TurnedSprite {
  const canvas = document.createElement('canvas');
  const ctx = get2dContext(canvas);
  let source: Sprite | null = null;
  let angle = 0;
  let sprite: Sprite = { canvas, halfW: 0, halfH: 0 };

  /** Sizes the canvas to hold `next` at any angle; the sprite object is made again only when that size changes. */
  function fit(next: Sprite): void {
    const { width, height } = next.canvas;
    const side = Math.ceil(Math.hypot(width, height));
    const half = side * (next.halfW / width);
    if (canvas.width === side && sprite.halfW === half) return;
    canvas.width = side;
    canvas.height = side;
    sprite = { canvas, halfW: half, halfH: half };
  }

  return {
    get angle() {
      return angle;
    },
    turn(next, to) {
      const { width, height } = next.canvas;
      const lagPx = Math.abs(turnBetween(angle, to)) * (Math.hypot(width, height) / 2);
      if (next === source && canvas.width > 0 && lagPx <= MAX_TURN_LAG_PX) return sprite;
      fit(next);
      const side = canvas.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, side, side);
      ctx.setTransform(Math.cos(to), Math.sin(to), -Math.sin(to), Math.cos(to), side / 2, side / 2);
      ctx.drawImage(next.canvas, -width / 2, -height / 2);
      source = next;
      angle = to;
      return sprite;
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
      source = null;
    },
  };
}
