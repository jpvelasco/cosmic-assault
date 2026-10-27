import { describe, expect, it } from 'vitest';
import { createFieldPen } from '../../src/render/fieldPen';
import type { Sprite } from '../../src/render/sprites';

type Matrix = readonly [number, number, number, number, number, number];

interface Draw {
  readonly matrix: Matrix;
  readonly args: readonly number[];
}

/** A context that logs each drawImage with the transform in force, and the transform it is left with. */
function fakeContext(): { ctx: CanvasRenderingContext2D; draws: Draw[]; current: () => Matrix } {
  const draws: Draw[] = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const ctx = {
    setTransform: (...next: Matrix) => {
      matrix = next;
    },
    drawImage: (_image: unknown, ...args: number[]) => draws.push({ matrix, args }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws, current: () => matrix };
}

/** A sprite baked at `k` device pixels per field unit, `width` by `height` device pixels. */
const sprite = (width: number, height: number, k: number): Sprite => ({ canvas: { width, height } as HTMLCanvasElement, halfW: width / (2 * k), halfH: height / (2 * k) });

/** Where a draw puts the sprite's top left, in device pixels. */
const topLeft = ({ matrix: [a, , , d, e, f], args: [x = 0, y = 0] }: Draw): readonly [number, number] => [e + a * x, f + d * y];

describe('createFieldPen', () => {
  const K = 1.5;

  it('lands an upright sprite drawn at its baked size on whole device pixels, unscaled, so the canvas copies it without resampling', () => {
    const { ctx, draws } = fakeContext();
    const pen = createFieldPen(ctx);
    pen.aim(K, 10.25, 3.4);
    for (const [width, height] of [[40, 40], [41, 33]] as const) {
      pen.place(100.3, 50.7, 1, 0);
      pen.blit(sprite(width, height, K));
    }
    for (const draw of draws) {
      expect(draw.matrix.slice(0, 4)).toEqual([1, 0, 0, 1]);
      expect(draw.args).toHaveLength(2);
      for (const at of topLeft(draw)) expect(Number.isInteger(at)).toBe(true);
    }
    // Within half a device pixel of where it would sit unsnapped: centred on 1.5 × (100.3, 50.7) + (10.25, 3.4).
    const [x, y] = topLeft(draws[1] as Draw);
    expect(Math.abs(x + 41 / 2 - (K * 100.3 + 10.25))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y + 33 / 2 - (K * 50.7 + 3.4))).toBeLessThanOrEqual(0.5);
  });

  it('leaves the placement in force after an upright blit, for the next draw at the same place', () => {
    const { ctx, current } = fakeContext();
    const pen = createFieldPen(ctx);
    pen.aim(K, 10.25, 3.4);
    pen.place(100.3, 50.7, 1, 0);
    pen.blit(sprite(40, 40, K));
    expect(current().map((v) => v + 0)).toEqual([K, 0, 0, K, K * 100.3 + 10.25, K * 50.7 + 3.4]);
  });

  it('draws a turned or scaled sprite through the exact placement, filtered as before', () => {
    const { ctx, draws } = fakeContext();
    const pen = createFieldPen(ctx);
    pen.aim(K, 10.25, 3.4);
    const art = sprite(40, 40, K);
    pen.place(100.3, 50.7, Math.cos(0.3), Math.sin(0.3));
    pen.blit(art);
    pen.place(100.3, 50.7, 1.2, 0);
    pen.blit(art);
    expect(draws.map((d) => d.matrix.map((v) => v + 0))).toEqual([
      [K * Math.cos(0.3), K * Math.sin(0.3), -K * Math.sin(0.3), K * Math.cos(0.3), K * 100.3 + 10.25, K * 50.7 + 3.4],
      [K * 1.2, 0, 0, K * 1.2, K * 100.3 + 10.25, K * 50.7 + 3.4],
    ]);
    for (const draw of draws) expect(draw.args).toEqual([-art.halfW, -art.halfH, art.halfW * 2, art.halfH * 2]);
  });
});
