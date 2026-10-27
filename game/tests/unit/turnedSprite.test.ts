import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sprite } from '../../src/render/sprites';
import { MAX_TURN_LAG_PX, createTurnedSprite } from '../../src/render/turnedSprite';

interface Turn {
  readonly image: unknown;
  readonly cos: number;
  readonly sin: number;
}

let turns: Turn[];

/** A canvas whose context logs each drawImage with the turn in force. */
function fakeCanvas(): unknown {
  let cos = 1;
  let sin = 0;
  const ctx = {
    setTransform: (a: number, b: number) => {
      cos = a;
      sin = b;
    },
    clearRect: () => undefined,
    drawImage: (image: unknown) => turns.push({ image, cos, sin }),
  };
  return { width: 0, height: 0, getContext: () => ctx };
}

/** A baked sprite, `width` by `height` device pixels at 2 per field unit. */
const source = (width: number, height: number): Sprite => ({ canvas: { width, height } as HTMLCanvasElement, halfW: width / 4, halfH: height / 4 });

describe('createTurnedSprite', () => {
  beforeEach(() => {
    turns = [];
    vi.stubGlobal('document', { createElement: fakeCanvas });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns the source onto a canvas that holds it at any angle, in the source\'s field units', () => {
    const art = source(200, 100);
    const turned = createTurnedSprite().turn(art, 0.5);
    expect(turns).toEqual([{ image: art.canvas, cos: Math.cos(0.5), sin: Math.sin(0.5) }]);
    const reach = Math.hypot(200, 100);
    expect(turned.canvas.width).toBeGreaterThanOrEqual(reach);
    expect(turned.canvas.height).toBe(turned.canvas.width);
    expect(turned.halfW).toBe(turned.canvas.width / 4);
    expect(turned.halfH).toBe(turned.halfW);
  });

  it('keeps the last turn while the angle moves its rim less than MAX_TURN_LAG_PX, and turns again past that', () => {
    const art = source(200, 200);
    const sprite = createTurnedSprite();
    const rim = Math.hypot(100, 100);
    const step = MAX_TURN_LAG_PX / rim;
    sprite.turn(art, 1);
    sprite.turn(art, 1 + step * 0.9);
    sprite.turn(art, 1 - step * 0.9);
    expect(turns).toHaveLength(1);
    expect(sprite.angle).toBe(1);
    sprite.turn(art, 1 + step * 1.1);
    expect(turns).toHaveLength(2);
    expect(sprite.angle).toBe(1 + step * 1.1);
  });

  it('turns again for another source, such as a rebake or a white flash, and measures the angle the short way round', () => {
    const sprite = createTurnedSprite();
    const art = source(200, 200);
    sprite.turn(art, Math.PI - 0.0001);
    sprite.turn(art, -Math.PI + 0.0001);
    expect(turns).toHaveLength(1);
    const white = source(200, 200);
    sprite.turn(white, -Math.PI + 0.0001);
    expect(turns.map((t) => t.image)).toEqual([art.canvas, white.canvas]);
  });

  it('frees its canvas on release, and turns afresh after', () => {
    const sprite = createTurnedSprite();
    const art = source(200, 200);
    const turned = sprite.turn(art, 0);
    sprite.release();
    expect(turned.canvas.width).toBe(0);
    expect(sprite.turn(art, 0).canvas.width).toBeGreaterThan(0);
    expect(turns).toHaveLength(2);
  });
});
