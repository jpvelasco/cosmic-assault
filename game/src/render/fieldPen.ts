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
  /**
   * Draws `sprite` centred on the current origin. An upright sprite drawn at its baked size lands on whole device
   * pixels, at most half a pixel from its place, because a canvas copies those without resampling, several times
   * faster on a CPU-rasterized canvas; the placement stays in force after.
   */
  blit(sprite: Sprite): void;
}

/** How far a sprite's drawn width may be from its canvas's, in device pixels, and still count as its baked size. */
const SAME_SIZE_PX = 1e-6;

export function createFieldPen(ctx: CanvasRenderingContext2D): FieldPen {
  let k = 1;
  let tx = 0;
  let ty = 0;
  /** The placement in force: its turn and scale (cos, sin) and its origin in device pixels. */
  let cos = 1;
  let sin = 0;
  let originX = 0;
  let originY = 0;

  function apply(): void {
    ctx.setTransform(k * cos, k * sin, -k * sin, k * cos, originX, originY);
  }

  /** Whether the placement in force draws `sprite` upright at its baked size: a canvas pixel to a device pixel. */
  function pixelForPixel({ canvas, halfW, halfH }: Sprite): boolean {
    return sin === 0 && cos === 1 && Math.abs(2 * halfW * k - canvas.width) <= SAME_SIZE_PX && Math.abs(2 * halfH * k - canvas.height) <= SAME_SIZE_PX;
  }

  function place(x: number, y: number, nextCos: number, nextSin: number): void {
    cos = nextCos;
    sin = nextSin;
    originX = k * x + tx;
    originY = k * y + ty;
    apply();
  }

  return {
    aim(nextK, nextTx, nextTy) {
      k = nextK;
      tx = nextTx;
      ty = nextTy;
    },
    field() {
      place(0, 0, 1, 0);
    },
    place,
    blit(sprite) {
      const { canvas, halfW, halfH } = sprite;
      if (!pixelForPixel(sprite)) {
        ctx.drawImage(canvas, -halfW, -halfH, halfW * 2, halfH * 2);
        return;
      }
      const { width, height } = canvas;
      ctx.setTransform(1, 0, 0, 1, Math.round(originX - width / 2) + width / 2, Math.round(originY - height / 2) + height / 2);
      ctx.drawImage(canvas, -width / 2, -height / 2);
      apply();
    },
  };
}
