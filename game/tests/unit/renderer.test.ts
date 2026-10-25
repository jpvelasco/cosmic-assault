import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REBAKE_DELAY_MS } from '../../src/render/layout';
import { DRIFT } from '../../src/render/palette';
import { ParticlePool } from '../../src/render/particles';
import { QUALITY_LEVELS } from '../../src/render/quality';
import { blinkHidden, createRenderer, type Renderer } from '../../src/render/renderer';
import { createSpriteBaker, type SpriteBaker } from '../../src/render/sprites';
import { createAsteroid, type Asteroid } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';
import { createRng } from '../../src/sim/rng';
import type { World } from '../../src/sim/world';

const FIELD = { width: 1280, height: 720 };

interface DrawCall {
  readonly image: unknown;
  /** The transform's x and y offset when the image was drawn. */
  readonly e: number;
  readonly f: number;
  /** The globalAlpha in force. */
  readonly alpha: number;
}

interface FakeCanvas {
  width: number;
  height: number;
  readonly style: Record<string, string>;
  readonly draws: DrawCall[];
  /** Arcs begun so far; the stars are the only thing drawn as arcs in the stub scene. */
  arcs: number;
  getContext(kind: string): unknown;
}

/** A canvas whose 2D context accepts every call and logs each drawImage with the transform offset in force. */
function fakeCanvas(): FakeCanvas {
  const draws: DrawCall[] = [];
  let e = 0;
  let f = 0;
  let alpha = 1;
  const fake: FakeCanvas = { width: 0, height: 0, style: {}, draws, arcs: 0, getContext: () => ctx };
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        switch (name) {
          case 'setTransform':
            return (_a: number, _b: number, _c: number, _d: number, nextE: number, nextF: number) => {
              e = nextE;
              f = nextF;
            };
          case 'drawImage':
            return (image: unknown) => draws.push({ image, e, f, alpha });
          case 'arc':
            return () => fake.arcs++;
          case 'createLinearGradient':
          case 'createRadialGradient':
            return () => gradient;
          case 'measureText':
            return (text: string) => ({ width: text.length * 10 });
          default:
            return () => undefined;
        }
      },
      set: (_target, name, value) => {
        if (name === 'globalAlpha') alpha = value as number;
        return true;
      },
    },
  );
  return fake;
}

interface Stub {
  status: 'playing' | 'gameOver';
  elapsed: number;
  ship: { x: number; y: number; px: number; py: number; angle: number; pangle: number; vx: number; vy: number; thrusting: boolean; invulnerable: boolean };
  asteroids: Asteroid[];
}

/** A world-shaped stub holding exactly what the renderer reads. */
function stubWorld(): { stub: Stub; world: World } {
  const rng = createRng(5);
  const rock = createAsteroid(rng, 300, 300, 0, 0, 1, rng, 5);
  rock.px = 290;
  rock.py = 300;
  const stub: Stub = {
    status: 'playing',
    elapsed: 0,
    ship: { x: 640, y: 360, px: 640, py: 360, angle: 0, pangle: 0, vx: 0, vy: 0, thrusting: false, invulnerable: false },
    asteroids: [rock],
  };
  const world = Object.assign(stub, { projectiles: [], score: 0, lives: 3, practiceLevel: 1 }) as unknown as World;
  return { stub, world };
}

const destroyed = (id: number): SimEvent => ({ type: 'asteroidDestroyed', id, x: 300, y: 300, size: 0, points: 20 });

describe('blinkHidden', () => {
  it('hides the ship in alternate twentieths of a second (10 Hz)', () => {
    expect([0, 0.04, 0.06, 0.09, 0.11].map(blinkHidden)).toEqual([false, false, true, true, false]);
  });
});

describe('createRenderer', () => {
  let canvas: FakeCanvas;
  let baker: SpriteBaker;
  let particles: ParticlePool;
  let renderer: Renderer;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: fakeCanvas });
    canvas = fakeCanvas();
    baker = createSpriteBaker();
    particles = new ParticlePool(400);
    renderer = createRenderer(canvas as unknown as HTMLCanvasElement, { baker, particles });
  });

  afterEach(() => {
    renderer.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Where the main canvas drew `image` on the last frame. */
  function drawsOf(image: unknown): DrawCall[] {
    return canvas.draws.filter((call) => call.image === image);
  }

  function drawFrame(world: World, alpha: number): void {
    canvas.draws.length = 0;
    renderer.draw(world, alpha);
  }

  it('refuses to draw before the first resize, saying what to do', () => {
    expect(() => {
      renderer.draw(stubWorld().world, 0);
    }).toThrow('call resize() once the canvas has a size');
  });

  it('bakes at once on the first resize, then re-bakes only once resizing has settled', () => {
    const setScale = vi.spyOn(baker, 'setScale');
    renderer.resize(1280, 720, FIELD);
    expect(setScale).toHaveBeenCalledTimes(1);
    expect(renderer.consumeRedrawRequest()).toBe(false);

    renderer.resize(640, 360, FIELD);
    vi.advanceTimersByTime(REBAKE_DELAY_MS - 80);
    renderer.resize(960, 540, FIELD);
    vi.advanceTimersByTime(REBAKE_DELAY_MS - 1);
    expect(setScale).toHaveBeenCalledTimes(1);
    expect(renderer.consumeRedrawRequest()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(setScale).toHaveBeenCalledTimes(2);
    expect(setScale).toHaveBeenLastCalledWith(0.75, 1);
    expect(renderer.consumeRedrawRequest()).toBe(true);
    expect(renderer.consumeRedrawRequest()).toBe(false);
  });

  it('forgets the sprite of each destroyed asteroid, and only those', () => {
    const forget = vi.spyOn(baker, 'forget');
    const { world } = stubWorld();
    renderer.handle([destroyed(7), { type: 'shot', x: 0, y: 0 }, destroyed(9)], world);
    expect(forget.mock.calls).toEqual([[7], [9]]);
  });

  it('interpolates while playing and draws the latest pose at game over', () => {
    renderer.resize(1280, 720, FIELD);
    const { stub, world } = stubWorld();
    const rock = baker.asteroid(stub.asteroids[0] as Asteroid, DRIFT).canvas;
    drawFrame(world, 0);
    expect(drawsOf(rock).map((call) => call.e)).toEqual([290]);
    drawFrame(world, 0.5);
    expect(drawsOf(rock).map((call) => call.e)).toEqual([295]);
    stub.status = 'gameOver';
    drawFrame(world, 0);
    expect(drawsOf(rock).map((call) => call.e)).toEqual([300]);
  });

  it('hides the ship after game over and blinks it at 10 Hz only while invulnerable', () => {
    renderer.resize(1280, 720, FIELD);
    const { stub, world } = stubWorld();
    const ship = baker.ship(DRIFT).canvas;
    const shipDrawn = (): boolean => {
      drawFrame(world, 1);
      return drawsOf(ship).length > 0;
    };
    expect(shipDrawn()).toBe(true);
    stub.elapsed = 0.06;
    expect(shipDrawn()).toBe(true);
    stub.ship.invulnerable = true;
    expect(shipDrawn()).toBe(false);
    stub.elapsed = 0.11;
    expect(shipDrawn()).toBe(true);
    stub.status = 'gameOver';
    expect(shipDrawn()).toBe(false);
  });

  it('reset() frees the sprites and particles of the previous run', () => {
    const clear = vi.spyOn(baker, 'clear');
    renderer.handle([destroyed(1)], stubWorld().world);
    expect(particles.count).toBeGreaterThan(0);
    renderer.reset();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(particles.count).toBe(0);
  });

  it('leaves no thruster trail while frozen, but particles still age', () => {
    const { stub, world } = stubWorld();
    stub.ship.thrusting = true;
    for (let i = 0; i < 10; i++) renderer.advance(1 / 60, world, true);
    expect(particles.count).toBe(0);
    for (let i = 0; i < 10; i++) renderer.advance(1 / 60, world, false);
    expect(particles.count).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) renderer.advance(1 / 60, world, true);
    expect(particles.count).toBe(0);
  });

  it('lets a burst play out after game over, then reports nothing left to redraw', () => {
    const { stub, world } = stubWorld();
    stub.status = 'gameOver';
    renderer.handle([{ type: 'shipHit', x: 640, y: 360, livesLeft: 0 }], world);
    expect(renderer.hasActiveParticles()).toBe(true);
    renderer.settle(0.1, world);
    expect(renderer.hasActiveParticles()).toBe(true);
    for (let i = 0; i < 40; i++) renderer.settle(0.1, world);
    expect(renderer.hasActiveParticles()).toBe(false);
  });

  it('counts the frames it draws', () => {
    renderer.resize(1280, 720, FIELD);
    const { world } = stubWorld();
    renderer.draw(world, 1);
    renderer.draw(world, 1);
    expect(renderer.drawCount).toBe(2);
  });

  describe('setQuality', () => {
    const [high, , low, lowest] = QUALITY_LEVELS as [(typeof QUALITY_LEVELS)[number], unknown, (typeof QUALITY_LEVELS)[number], (typeof QUALITY_LEVELS)[number]];

    it('resizes the particle pool to the level', () => {
      renderer.setQuality(lowest);
      expect(particles.capacity).toBe(60);
      renderer.setQuality(high);
      expect(particles.capacity).toBe(400);
    });

    it('caps the backing store at the level, re-baking after the debounce rather than per frame', () => {
      vi.stubGlobal('devicePixelRatio', 2);
      renderer.resize(1280, 720, FIELD);
      expect(canvas.width).toBe(2560);
      const setScale = vi.spyOn(baker, 'setScale');

      renderer.setQuality(low);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(900);
      expect(canvas.style['width']).toBe('1280px');
      expect(setScale).not.toHaveBeenCalled();
      renderer.draw(stubWorld().world, 1);
      expect(setScale).not.toHaveBeenCalled();

      vi.advanceTimersByTime(REBAKE_DELAY_MS);
      expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 1.25);
      expect(renderer.consumeRedrawRequest()).toBe(true);
    });

    it('leaves the canvas alone when the cap does not change the ratio', () => {
      renderer.resize(1280, 720, FIELD);
      const setScale = vi.spyOn(baker, 'setScale');
      renderer.setQuality(lowest);
      vi.advanceTimersByTime(REBAKE_DELAY_MS * 2);
      expect(setScale).not.toHaveBeenCalled();
      expect(renderer.consumeRedrawRequest()).toBe(false);
    });

    it('applies the cap to the first resize after it is set', () => {
      vi.stubGlobal('devicePixelRatio', 3);
      renderer.setQuality(lowest);
      renderer.resize(1280, 720, FIELD);
      expect(canvas.width).toBe(1280);
    });

    it('scales the glow alpha, never touching the other sprites', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      const shipGlow = baker.glow(DRIFT.ship[1], 64).canvas;
      drawFrame(world, 1);
      expect(drawsOf(shipGlow).map((call) => call.alpha)).toEqual([0.3]);
      renderer.setQuality(lowest);
      drawFrame(world, 1);
      expect(drawsOf(shipGlow).map((call) => call.alpha)).toEqual([0.3 * 0.4]);
    });

    it('draws the vignette only where the level asks for it', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      drawFrame(world, 1);
      const withVignette = canvas.draws.length;
      renderer.setQuality(low);
      drawFrame(world, 1);
      expect(canvas.draws.length).toBe(withVignette - 1);
    });

    it('draws fewer stars at a lower level', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      renderer.draw(world, 1);
      const full = canvas.arcs;
      canvas.arcs = 0;
      renderer.setQuality(lowest);
      renderer.draw(world, 1);
      expect(canvas.arcs).toBeLessThan(full);
    });
  });

  it('dispose() cancels a pending re-bake and frees every sprite and particle', () => {
    const setScale = vi.spyOn(baker, 'setScale');
    const clear = vi.spyOn(baker, 'clear');
    renderer.resize(1280, 720, FIELD);
    renderer.resize(640, 360, FIELD);
    renderer.handle([destroyed(1)], stubWorld().world);
    renderer.dispose();
    vi.advanceTimersByTime(REBAKE_DELAY_MS * 4);
    expect(setScale).toHaveBeenCalledTimes(1);
    expect(renderer.consumeRedrawRequest()).toBe(false);
    expect(clear).toHaveBeenCalled();
    expect(particles.count).toBe(0);
  });
});
