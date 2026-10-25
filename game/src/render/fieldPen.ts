import type { Sprite } from './sprites';

/**
 * The frame's shaken field transform, device = k × field point + (tx, ty), and the sprite moves
 * drawn through it. One per renderer, so passes share the frame's transform without passing it around.
 */
export interface FieldPen {
  /** Sets the frame's scale and offset (shake included). Takes effect at the next `field` or `place`. */
  aim(k: number, tx: number, ty: number): void;
  /** Applies the plain field transform, for paths drawn in field units. */
  field(): void;
  /** Applies the field transform moved to (x, y) and turned by (cos, sin). */
  place(x: number, y: number, cos: number, sin: number): void;
  /** Draws `sprite` centred on the current origin. */
  blit(sprite: Sprite): void;
}

export function createFieldPen(ctx: CanvasRenderingContext2D): FieldPen {
  let k = 1;
  let tx = 0;
  let ty = 0;
  return {
    aim(nextK, nextTx, nextTy) {
      k = nextK;
      tx = nextTx;
      ty = nextTy;
    },
    field() {
      ctx.setTransform(k, 0, 0, k, tx, ty);
    },
    place(x, y, cos, sin) {
      ctx.setTransform(k * cos, k * sin, -k * sin, k * cos, k * x + tx, k * y + ty);
    },
    blit({ canvas, halfW, halfH }) {
      ctx.drawImage(canvas, -halfW, -halfH, halfW * 2, halfH * 2);
    },
  };
}
