import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REBAKE_DELAY_MS } from '../../src/render/layout';
import { DRIFT, ION_REACH, paletteFor } from '../../src/render/palette';
import { ParticlePool } from '../../src/render/particles';
import { QUALITY_LEVELS } from '../../src/render/quality';
import { blinkHidden, createRenderer, type Renderer } from '../../src/render/renderer';
import { createSpriteBaker, type SpriteBaker } from '../../src/render/sprites';
import { createAsteroid, type Asteroid } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';
import { createRng } from '../../src/sim/rng';
import { visualScaleFor } from '../../src/render/visualScale';
import { noEffects, type TimedPickupId } from '../../src/content/pickups';
import { galaxyById } from '../../src/content/galaxies';
import { boltKey } from '../../src/render/boltPass';
import { foeKeys, mineMarkKeys } from '../../src/render/foePass';
import { MINE } from '../../src/content/foes';
import { CRACK_SECONDS } from '../../src/render/pickupPass';
import type { Bolt } from '../../src/sim/foes/bolts';
import { foeAt } from '../helpers/foeAt';
import type { Foe } from '../../src/sim/foes/foe';
import type { HazardState } from '../../src/sim/hazards/hazard';
import type { Pickup } from '../../src/sim/pickups/pickups';
import type { World, WorldStatus } from '../../src/sim/world';

const FIELD = { width: 1280, height: 720 };

interface DrawCall {
  readonly image: unknown;
  /** The transform's x scale when the image was drawn: the field scale, times the sprite's own turn and scale. */
  readonly a: number;
  /** The transform's x and y offset when the image was drawn. */
  readonly e: number;
  readonly f: number;
  /** The globalAlpha in force. */
  readonly alpha: number;
  readonly smoothing: boolean;
}

interface FakeCanvas {
  width: number;
  height: number;
  readonly style: Record<string, string>;
  readonly draws: DrawCall[];
  /** The colour of every gradient stop added so far. */
  readonly stops: string[];
  /** Arcs begun so far; the stars are the only thing drawn as arcs in the stub scene. */
  arcs: number;
  /** Every point a line was drawn to, with the alpha then. */
  readonly lines: { x: number; y: number; alpha: number }[];
  getContext(kind: string): unknown;
}

/** A canvas whose 2D context accepts every call and logs each drawImage with the transform offset in force. */
function fakeCanvas(): FakeCanvas {
  const draws: DrawCall[] = [];
  let a = 1;
  let e = 0;
  let f = 0;
  let alpha = 1;
  let smoothing = true;
  const fake: FakeCanvas = { width: 0, height: 0, style: {}, draws, stops: [], arcs: 0, lines: [], getContext: () => ctx };
  const gradient = { addColorStop: (_at: number, color: string) => fake.stops.push(color) };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        switch (name) {
          case 'setTransform':
            return (nextA: number, _b: number, _c: number, _d: number, nextE: number, nextF: number) => {
              a = nextA;
              e = nextE;
              f = nextF;
            };
          case 'drawImage':
            return (image: unknown) => draws.push({ image, a, e, f, alpha, smoothing });
          case 'arc':
            return () => fake.arcs++;
          case 'lineTo':
            return (x: number, y: number) => fake.lines.push({ x, y, alpha });
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
        if (name === 'imageSmoothingEnabled') smoothing = value as boolean;
        return true;
      },
    },
  );
  return fake;
}

interface Stub {
  status: WorldStatus;
  elapsed: number;
  ship: { x: number; y: number; px: number; py: number; angle: number; pangle: number; vx: number; vy: number; thrusting: boolean; invulnerable: boolean };
  asteroids: Asteroid[];
  foes: Foe[];
  bolts: Bolt[];
  hazards: HazardState[];
  pickups: Pickup[];
  effects: Record<TimedPickupId, number>;
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
    foes: [],
    bolts: [],
    hazards: [],
    pickups: [],
    effects: noEffects(),
  };
  const world = Object.assign(stub, { projectiles: [], score: 0, lives: 3, practiceLevel: 1, galaxy: null, timeLeft: null, multiplier: 1, boss: null, shower: null }) as unknown as World;
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
    canvas.lines.length = 0;
    renderer.draw(world, alpha, 0);
  }

  it('refuses to draw before the first resize, saying what to do', () => {
    expect(() => {
      renderer.draw(stubWorld().world, 0, 0);
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
    expect(setScale).toHaveBeenLastCalledWith(0.75, 1, visualScaleFor(0.75));
    expect(renderer.consumeRedrawRequest()).toBe(true);
    expect(renderer.consumeRedrawRequest()).toBe(false);
  });

  it('forgets the sprite of each destroyed asteroid, and only those', () => {
    const forget = vi.spyOn(baker, 'forget');
    const { world } = stubWorld();
    renderer.handle([destroyed(7), { type: 'shot', x: 0, y: 0 }, destroyed(9)], world);
    expect(forget.mock.calls).toEqual([[7], [9]]);
  });

  it('forgets the sprite of a meteor that left the field', () => {
    const forget = vi.spyOn(baker, 'forget');
    const { world } = stubWorld();
    renderer.handle([{ type: 'asteroidLeft', id: 4 }, { type: 'showerEnd' }], world);
    expect(forget.mock.calls).toEqual([[4]]);
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

  it('freezes on the latest pose once a galaxy is cleared, and still interpolates through the warp-out', () => {
    renderer.resize(1280, 720, FIELD);
    const { stub, world } = stubWorld();
    const rock = baker.asteroid(stub.asteroids[0] as Asteroid, DRIFT).canvas;
    stub.status = 'warping';
    drawFrame(world, 0.5);
    expect(drawsOf(rock).map((call) => call.e)).toEqual([295]);
    stub.status = 'cleared';
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

  describe('setPalette', () => {
    const slain: SimEvent = { type: 'foeDestroyed', id: 9, kind: 'drone', x: 400, y: 300, points: 100 };

    it('starts in the Drift and reports the palette in force', () => {
      expect(renderer.palette).toBe('drift');
      renderer.setPalette('ionReach');
      expect(renderer.palette).toBe('ionReach');
    });

    it('re-bakes the sky once, at once, and draws every sprite kind from the new palette', () => {
      renderer.resize(1280, 720, FIELD);
      const { stub, world } = stubWorld();
      stub.foes.push(foeAt('drone', 400, 300, { id: 9 }));
      stub.pickups.push({ id: 3, kind: 'rapidFire', x: 700, y: 300, px: 700, py: 300, vx: 0, vy: 0, expiresIn: 9 });
      const setScale = vi.spyOn(baker, 'setScale');
      renderer.setPalette('ionReach');
      expect(setScale).toHaveBeenCalledTimes(1);
      expect(renderer.consumeRedrawRequest()).toBe(true);
      drawFrame(world, 1);
      const drawn = (sprite: { readonly canvas: HTMLCanvasElement } | undefined): number => drawsOf(sprite?.canvas).length;
      expect(drawsOf(baker.ship(ION_REACH).canvas)).toHaveLength(1);
      expect(drawsOf(baker.ship(DRIFT).canvas)).toHaveLength(0);
      expect(drawsOf(baker.asteroid(stub.asteroids[0] as Asteroid, ION_REACH).canvas)).toHaveLength(1);
      expect(drawsOf(baker.asteroid(stub.asteroids[0] as Asteroid, DRIFT).canvas)).toHaveLength(0);
      expect(drawn(baker.cached(foeKeys(ION_REACH).drone))).toBe(1);
      expect(drawn(baker.cached(foeKeys(DRIFT).drone))).toBe(0);
      expect(drawn(baker.cached('pickup|ionReach|rapidFire'))).toBe(1);
      expect(baker.cached('pickup|drift|rapidFire')).toBeUndefined();
    });

    it('draws a hostile bolt from its own baked capsule, keyed by the palette, and rebuilds it with the palette', () => {
      renderer.resize(1280, 720, FIELD);
      const { stub, world } = stubWorld();
      stub.bolts.push({ id: 11, x: 500, y: 300, px: 498, py: 300, vx: 230, vy: 0, radius: 5, age: 0, source: 'boss', owner: 0, fromAttack: true });
      drawFrame(world, 1);
      expect(drawsOf(baker.cached(boltKey(DRIFT))?.canvas)).toHaveLength(1);
      renderer.setPalette('crimsonNebula');
      drawFrame(world, 1);
      expect(drawsOf(baker.cached(boltKey(paletteFor('crimsonNebula')))?.canvas)).toHaveLength(1);
    });

    it('rebuilds the palette-derived sprites on each step of a D3 to D4 to D5 switch', () => {
      renderer.resize(1280, 720, FIELD);
      const { stub, world } = stubWorld();
      stub.foes.push(foeAt('drone', 400, 300, { id: 9 }));
      const setScale = vi.spyOn(baker, 'setScale');
      let previous = DRIFT;
      for (const id of ['crimsonNebula', 'voidRift', 'singularity'] as const) {
        renderer.setPalette(id);
        expect(renderer.palette).toBe(id);
        drawFrame(world, 1);
        const palette = paletteFor(id);
        expect(drawsOf(baker.ship(palette).canvas), id).toHaveLength(1);
        expect(drawsOf(baker.ship(previous).canvas), `${id} leaves ${previous.id} unused`).toHaveLength(0);
        expect(baker.cached(foeKeys(palette).drone), id).toBeDefined();
        previous = palette;
      }
      expect(setScale).toHaveBeenCalledTimes(3);
    });

    it('draws the HUD bars in the new palette', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      Object.assign(world, { galaxy: galaxyById('2-4'), timeLeft: 40 });
      renderer.setPalette('ionReach');
      canvas.stops.length = 0;
      drawFrame(world, 1);
      expect(canvas.stops).toContain(ION_REACH.accent[2]);
      expect(canvas.stops).not.toContain(DRIFT.accent[2]);
    });

    it('re-bakes nothing for the palette already in force', () => {
      renderer.resize(1280, 720, FIELD);
      const setScale = vi.spyOn(baker, 'setScale');
      renderer.setPalette('drift');
      expect(setScale).not.toHaveBeenCalled();
      expect(renderer.consumeRedrawRequest()).toBe(false);
    });

    it('colours bursts and the HUD in the new palette, and keeps the effects object the settings hold', () => {
      const { effects } = renderer;
      effects.reducedMotion = true;
      renderer.setPalette('ionReach');
      expect(renderer.effects).toBe(effects);
      expect(effects.reducedMotion).toBe(true);
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      renderer.handle([slain], world);
      expect(particles.count).toBeGreaterThan(0);
      let ringColors = 0;
      particles.forEach((p) => {
        if (p.kind === 'ring') {
          expect(p.color).toBe(ION_REACH.ring);
          ringColors++;
        }
      });
      expect(ringColors).toBeGreaterThan(0);
    });

    it('waits for the first resize when it comes before one, and then bakes in the new palette', () => {
      renderer.setPalette('ionReach');
      const setScale = vi.spyOn(baker, 'setScale');
      renderer.resize(1280, 720, FIELD);
      expect(setScale).toHaveBeenCalledTimes(1);
      drawFrame(stubWorld().world, 1);
      expect(canvas.draws.some((call) => call.image === baker.ship(ION_REACH).canvas)).toBe(true);
    });
  });

  describe('hit-object juice', () => {
    const FRAME = 1 / 60;
    const shipHit: SimEvent = { type: 'shipHit', x: 640, y: 360, livesLeft: 2 };

    /** Draws the rock once so it has a sprite, then breaks it; returns the white silhouette the flash should show. */
    function breakRock(world: World): HTMLCanvasElement {
      renderer.resize(1280, 720, FIELD);
      drawFrame(world, 1);
      const key = baker.whiteRock(5);
      const white = key === undefined ? undefined : baker.cached(key);
      if (white === undefined) throw new Error('the drawn rock must have a white silhouette');
      renderer.handle([destroyed(5)], world);
      return white.canvas;
    }

    function advanceFrames(world: World, frames: number): void {
      for (let i = 0; i < frames; i++) renderer.advance(FRAME, world, false);
    }

    it('flashes a destroyed rock white where it broke, for 60 ms', () => {
      const { world } = stubWorld();
      const white = breakRock(world);
      drawFrame(world, 1);
      // The break's shake moves the scene down, not sideways, in its first instant; the upright flash lands on whole
      // device pixels, within half a pixel of the break.
      const [flash, ...others] = drawsOf(white);
      expect(others).toHaveLength(0);
      expect(Math.abs((flash?.e ?? Number.NaN) - 300)).toBeLessThanOrEqual(0.5);
      advanceFrames(world, 3);
      drawFrame(world, 1);
      expect(drawsOf(white)).toHaveLength(1);
      advanceFrames(world, 2);
      drawFrame(world, 1);
      expect(drawsOf(white)).toHaveLength(0);
    });

    it('fades the flash out as it goes', () => {
      const { world } = stubWorld();
      const white = breakRock(world);
      drawFrame(world, 1);
      const first = drawsOf(white)[0]?.alpha ?? 0;
      advanceFrames(world, 2);
      drawFrame(world, 1);
      const later = drawsOf(white)[0]?.alpha ?? 0;
      expect(first).toBe(1);
      expect(later).toBeGreaterThan(0);
      expect(later).toBeLessThan(first);
    });

    it('keeps the flash under reduced motion, a lighter touch than the full-screen flash it drops', () => {
      const { world } = stubWorld();
      renderer.effects.reducedMotion = true;
      const white = breakRock(world);
      drawFrame(world, 1);
      expect(drawsOf(white)).toHaveLength(1);
    });

    it('draws no flash, and nothing empty, when a rebake drops the silhouette mid-flash', () => {
      const { world } = stubWorld();
      const white = breakRock(world);
      baker.setScale(2, 1);
      drawFrame(world, 1);
      expect(drawsOf(white)).toHaveLength(0);
      expect(canvas.draws.every((call) => (call.image as HTMLCanvasElement).width > 0)).toBe(true);
    });

    it('shows no flash for a rock that was never drawn, or that the warp cleared', () => {
      const { world } = stubWorld();
      renderer.resize(1280, 720, FIELD);
      renderer.handle([destroyed(5), { type: 'asteroidDestroyed', id: 5, x: 300, y: 300, size: 0, points: 0 }], world);
      drawFrame(world, 1);
      // The frame bakes the rock; its silhouette (made now, after the fact) was never drawn.
      const key = baker.whiteRock(5);
      expect(drawsOf(key === undefined ? null : baker.cached(key)?.canvas)).toHaveLength(0);
    });

    describe('foes', () => {
      const KEYS = foeKeys(DRIFT);
      const drone = (): Foe => foeAt('drone', 400, 300, { id: 9 });
      const spawned: SimEvent = { type: 'foeSpawned', id: 9, kind: 'drone', x: 400, y: 300 };
      const hurt: SimEvent = { type: 'foeHit', id: 9, x: 400, y: 300, hp: 1 };
      const slain: SimEvent = { type: 'foeDestroyed', id: 9, kind: 'drone', x: 400, y: 300, points: 100 };

      /** Draws the drone once so it has a sprite; returns the sprite its flash should show. */
      function drawnDrone(): { world: World; stub: Stub; white: HTMLCanvasElement } {
        const { stub, world } = stubWorld();
        stub.foes.push(drone());
        renderer.resize(1280, 720, FIELD);
        renderer.handle([spawned], world);
        drawFrame(world, 1);
        const white = baker.white(KEYS.drone);
        if (white === undefined) throw new Error('the drawn drone must have a white silhouette');
        return { world, stub, white: white.canvas };
      }

      it('draws a foe where it is, from a baked sprite', () => {
        const { world } = drawnDrone();
        const sprite = baker.cached(KEYS.drone);
        expect(drawsOf(sprite?.canvas)).toHaveLength(1);
        expect(drawsOf(sprite?.canvas)[0]?.e).toBe(400);
        drawFrame(world, 1);
        expect(drawsOf(sprite?.canvas)).toHaveLength(1);
      });

      it('turns a drone to its heading, with its engine glow behind it', () => {
        const { world, stub } = drawnDrone();
        stub.foes[0] = { ...drone(), rotation: Math.PI / 2, protation: Math.PI / 2 };
        drawFrame(world, 1);
        const body = drawsOf(baker.cached(KEYS.drone)?.canvas)[0];
        // Turned a quarter: the transform's x scale is cos(π/2) = 0.
        expect(body?.a).toBeCloseTo(0, 9);
        const engine = canvas.draws.find((call) => call.f !== 300 && Math.abs(call.e - 400) < 1e-9);
        expect(engine?.f).toBeLessThan(300);
      });

      it('shows a splitter one hit from breaking with its seams cracked open', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        const splitter: Foe = { ...drone(), kind: 'splitter', radius: 30, hp: 2 };
        stub.foes.push(splitter);
        drawFrame(world, 1);
        expect(drawsOf(baker.cached(KEYS.splitter)?.canvas)).toHaveLength(1);
        expect(baker.cached(KEYS.crackedSplitter)).toBeUndefined();
        splitter.hp = 1;
        drawFrame(world, 1);
        expect(drawsOf(baker.cached(KEYS.crackedSplitter)?.canvas)).toHaveLength(1);
        expect(drawsOf(baker.cached(KEYS.splitter)?.canvas)).toHaveLength(0);
      });

      it('skips a foe that is spent (HP 0) but not yet swept', () => {
        const { world, stub } = drawnDrone();
        const sprite = baker.cached(KEYS.drone);
        stub.foes[0] = { ...drone(), hp: 0 };
        drawFrame(world, 1);
        expect(drawsOf(sprite?.canvas)).toHaveLength(0);
      });

      it.each([
        ['hit', hurt],
        ['destroyed', slain],
      ])('flashes a foe white where it was %s, for 60 ms, fading', (_name, event) => {
        const { world, stub, white } = drawnDrone();
        renderer.handle([event], world);
        stub.foes.length = 0;
        drawFrame(world, 1);
        expect(drawsOf(white).map((call) => call.e)).toEqual([400]);
        const first = drawsOf(white)[0]?.alpha ?? 0;
        advanceFrames(world, 2);
        drawFrame(world, 1);
        const later = drawsOf(white)[0]?.alpha ?? 0;
        expect(later).toBeGreaterThan(0);
        expect(later).toBeLessThan(first);
        advanceFrames(world, 3);
        drawFrame(world, 1);
        expect(drawsOf(white)).toHaveLength(0);
      });

      it('shows no flash for a foe the warp cleared or the ship rammed (0 points)', () => {
        const { world, white } = drawnDrone();
        renderer.handle([{ ...slain, points: 0 }], world);
        drawFrame(world, 1);
        expect(drawsOf(white)).toHaveLength(0);
      });

      it('draws no flash, and nothing empty, when a rebake drops the silhouette mid-flash', () => {
        const { world, white } = drawnDrone();
        renderer.handle([hurt], world);
        baker.setScale(2, 1);
        drawFrame(world, 1);
        expect(drawsOf(white)).toHaveLength(0);
        expect(canvas.draws.every((call) => (call.image as HTMLCanvasElement).width > 0)).toBe(true);
      });

      it('drops a foe flash when a new run starts', () => {
        const { world, white } = drawnDrone();
        renderer.handle([hurt], world);
        renderer.reset();
        renderer.resize(1280, 720, FIELD);
        drawFrame(world, 1);
        expect(drawsOf(white)).toHaveLength(0);
      });
    });

    describe("Crimson Nebula's foes, bolts and zones", () => {
      const CRIMSON = paletteFor('crimsonNebula');
      const KEYS = foeKeys(CRIMSON);
      const MARKS = mineMarkKeys(CRIMSON);
      function crimsonWorld(): { stub: Stub; world: World } {
        renderer.resize(1280, 720, FIELD);
        renderer.setPalette('crimsonNebula');
        return stubWorld();
      }

      it('draws a gunship from its wedge sprite, and its aim line to where it will fire only while it winds up', () => {
        const { stub, world } = crimsonWorld();
        const aim = { aimX: 700, aimY: 500 };
        const aimLines = (): { x: number; y: number; alpha: number }[] => canvas.lines.filter((l) => l.x === aim.aimX && l.y === aim.aimY);
        stub.foes.push(foeAt('gunship', 400, 300, { id: 5, ...aim }));
        drawFrame(world, 1);
        expect(drawsOf(baker.cached(KEYS.gunship)?.canvas)).toHaveLength(1);
        expect(aimLines()).toEqual([]);
        stub.foes[0] = foeAt('gunship', 400, 300, { id: 5, ...aim, charging: true, timer: 0.25 });
        drawFrame(world, 1);
        expect(aimLines()).toHaveLength(1);
        const half = aimLines()[0]?.alpha ?? 0;
        stub.foes[0] = foeAt('gunship', 400, 300, { id: 5, ...aim, charging: true, timer: 0.05 });
        drawFrame(world, 1);
        expect(aimLines()[0]?.alpha).toBeGreaterThan(half);
      });

      it("always shows a mine's arm ring at its true size, and its blast reach only once armed", () => {
        const { stub, world } = crimsonWorld();
        stub.foes.push(foeAt('mine', 500, 300, { id: 6 }));
        drawFrame(world, 1);
        const ring = baker.cached(MARKS.ring);
        expect(drawsOf(ring?.canvas)).toHaveLength(1);
        expect(drawsOf(ring?.canvas)[0]?.e).toBe(500);
        // Gameplay sizes are never scaled up for small screens: the ring is the arm radius, plus its stroke.
        expect(ring?.halfW).toBeGreaterThanOrEqual(MINE.armRadius);
        expect(ring?.halfW).toBeLessThan(MINE.armRadius + 6);
        expect(baker.cached(MARKS.blast)).toBeUndefined();
        expect(drawsOf(baker.cached(KEYS.mine)?.canvas)).toHaveLength(1);
        stub.foes[0] = foeAt('mine', 500, 300, { id: 6, charging: true, timer: 0.3 });
        drawFrame(world, 1);
        expect(drawsOf(baker.cached(MARKS.blast)?.canvas)).toHaveLength(1);
      });

      it('draws a danger zone dashed while it warns and filled once lethal, each from a sprite of its own size', () => {
        const { stub, world } = crimsonWorld();
        const zone = (stage: 'warning' | 'active'): HazardState => ({ id: 7, type: 'dangerZone', stage, x: 300, y: 200, w: 160, h: 140, intensity: 1, remaining: 1.5 });
        stub.hazards = [zone('warning')];
        drawFrame(world, 1);
        const warning = baker.cached('zone|crimsonNebula|warning|160.0x140.0');
        expect(drawsOf(warning?.canvas).map((call) => [call.e, call.f])).toEqual([[300, 200]]);
        expect(warning?.halfH).toBeLessThan(warning?.halfW ?? 0);
        stub.hazards = [zone('active')];
        drawFrame(world, 1);
        expect(drawsOf(baker.cached('zone|crimsonNebula|active|160.0x140.0')?.canvas)).toHaveLength(1);
        expect(drawsOf(warning?.canvas)).toEqual([]);
      });

      it('draws a zone\'s warning over the rocks, so a rock never hides one, and a lethal zone under them', () => {
        const { stub, world } = crimsonWorld();
        const zone = (stage: 'warning' | 'active'): HazardState => ({ id: 8, type: 'dangerZone', stage, x: 300, y: 300, w: 160, h: 140, intensity: 1, remaining: 1.5 });
        const order = (key: string): number => canvas.draws.findIndex((call) => call.image === baker.cached(key)?.canvas);
        const rock = (): number => canvas.draws.findIndex((call) => call.image === baker.asteroid(stub.asteroids[0] as Asteroid, CRIMSON).canvas);
        stub.hazards = [zone('warning')];
        drawFrame(world, 1);
        expect(order('zone|crimsonNebula|warning|160.0x140.0')).toBeGreaterThan(rock());
        stub.hazards = [zone('active')];
        drawFrame(world, 1);
        expect(order('zone|crimsonNebula|active|160.0x140.0')).toBeLessThan(rock());
      });

      it('restyles the bolts in the palette\'s hostile hue, and looks their glow up once a frame however many fly', () => {
        const { stub, world } = crimsonWorld();
        for (let i = 0; i < 5; i++) stub.bolts.push({ id: 20 + i, x: 300 + i * 40, y: 300, px: 300 + i * 40, py: 300, vx: 230, vy: 0, radius: 5, age: 0, source: 'gunship', owner: 5, fromAttack: false });
        const glow = vi.spyOn(baker, 'glow');
        drawFrame(world, 1);
        expect(glow.mock.calls.filter(([color]) => color === CRIMSON.hostile)).toHaveLength(1);
        expect(drawsOf(baker.cached(boltKey(CRIMSON))?.canvas)).toHaveLength(5);
      });
    });

    describe('a gravity well', () => {
      const well = (stage: 'warning' | 'active', remaining = 5): HazardState[] => [{ id: 2, type: 'gravityWell', stage, x: 600, y: 300, intensity: 2, remaining }];
      const sprite = (name: string): HTMLCanvasElement | undefined => baker.cached(`well|drift|${name}`)?.canvas;
      const ARCS = ['arc0', 'arc1', 'arc2'] as const;

      it('is a faint outline alone while it is a warning, pulsing and closing in as it comes due', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        stub.hazards = well('warning', 2);
        drawFrame(world, 1);
        const early = drawsOf(sprite('outline'));
        expect(early.map((call) => call.e)).toEqual([600]);
        expect(early[0]?.alpha).toBeLessThan(0.7);
        for (const name of [...ARCS, 'horizon']) expect(sprite(name)).toBeUndefined();
        stub.hazards = well('warning', 0.2);
        stub.elapsed = 0.3;
        drawFrame(world, 1);
        const late = drawsOf(sprite('outline'))[0];
        expect(late?.a).toBeLessThan(early[0]?.a ?? 0);
        expect(late?.alpha).not.toBe(early[0]?.alpha);
      });

      it('swirls once it pulls: a glow, three arcs that turn with time, and the dark lens over them', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        stub.hazards = well('active');
        drawFrame(world, 1);
        expect(sprite('outline')).toBeUndefined();
        const order = canvas.draws.filter((call) => call.e !== 0 && call.e !== 640).map((call) => call.image);
        const arcs = ARCS.map(sprite);
        for (const arc of arcs) expect(drawsOf(arc)).toHaveLength(1);
        expect(order.indexOf(sprite('horizon'))).toBeGreaterThan(Math.max(...arcs.map((arc) => order.indexOf(arc))));
        const before = drawsOf(arcs[0])[0]?.a;
        stub.elapsed = 0.5;
        drawFrame(world, 1);
        expect(drawsOf(arcs[0])[0]?.a).not.toBeCloseTo(before ?? 0, 3);
      });

      it('holds its arcs still under reduced motion, breathing only in opacity, gently', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        renderer.effects.reducedMotion = true;
        stub.hazards = well('active');
        const frames = [0, 0.35, 0.7, 1.05, 1.4].map((elapsed) => {
          stub.elapsed = elapsed;
          drawFrame(world, 1);
          return ARCS.map((name) => drawsOf(sprite(name))[0]);
        });
        for (const [i] of ARCS.entries()) {
          const angles = new Set(frames.map((arcs) => arcs[i]?.a));
          expect(angles.size, ARCS[i]).toBe(1);
          const alphas = frames.map((arcs) => arcs[i]?.alpha ?? Number.NaN);
          expect(new Set(alphas).size).toBeGreaterThan(1);
          expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.6 - 1e-9);
          expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
        }
      });

      it('swirls up as it starts and fades out as it ends', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        const arcAlpha = (remaining: number): number => {
          stub.hazards = well('active', remaining);
          drawFrame(world, 1);
          return drawsOf(sprite('arc1'))[0]?.alpha ?? Number.NaN;
        };
        expect(arcAlpha(14)).toBe(0);
        expect(arcAlpha(13.8)).toBeGreaterThan(0);
        expect(arcAlpha(13.8)).toBeLessThan(1);
        expect(arcAlpha(7)).toBe(1);
        expect(arcAlpha(0.4)).toBeCloseTo(0.5, 9);
      });

      it('is not drawn when there is none', () => {
        const { world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        drawFrame(world, 1);
        for (const name of [...ARCS, 'horizon', 'outline']) expect(sprite(name)).toBeUndefined();
      });

      it('draws only gravity wells as wells: a repulsion field waits for its own look', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        stub.hazards = well('active').map((h) => ({ ...h, type: 'repulsionField' }));
        drawFrame(world, 1);
        for (const name of [...ARCS, 'horizon', 'outline']) expect(sprite(name)).toBeUndefined();
      });
    });

    describe('pickups and the Shield', () => {
      const capsule = (kind: string): HTMLCanvasElement | undefined => baker.cached(`pickup|drift|${kind}`)?.canvas;
      const ring = (): HTMLCanvasElement | undefined => baker.cached('shield|drift|ring')?.canvas;
      const crack = (): HTMLCanvasElement | undefined => baker.cached('shield|drift|crack')?.canvas;
      const pickup = (id: number, kind: Pickup['kind'], expiresIn: number): Pickup => ({ id, kind, x: 200 + id * 100, y: 400, px: 200 + id * 100, py: 400, vx: 0, vy: 0, expiresIn });

      it('draws each pickup as the capsule of its kind where it is, whole until its last 2 s, then blinking', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        stub.pickups.push(pickup(1, 'shield', 6), pickup(2, 'rapidFire', 1.9));
        drawFrame(world, 1);
        expect(drawsOf(capsule('shield')).map((call) => [call.e, call.alpha])).toEqual([[300, 1]]);
        const blinking = drawsOf(capsule('rapidFire'))[0];
        expect(blinking?.e).toBe(400);
        expect(blinking?.alpha).toBeLessThan(1);
        (stub.pickups[1] as Pickup).expiresIn = 1.8;
        drawFrame(world, 1);
        expect(drawsOf(capsule('rapidFire'))[0]?.alpha).toBe(1);
      });

      it('rings the ship while the Shield is up, blinking through its last 2 s, and not otherwise', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        drawFrame(world, 1);
        expect(ring()).toBeUndefined();
        stub.effects.shield = 10;
        drawFrame(world, 1);
        expect(drawsOf(ring()).map((call) => call.e)).toEqual([640]);
        const steady = drawsOf(ring())[0]?.alpha ?? 0;
        stub.effects.shield = 1.9;
        drawFrame(world, 1);
        expect(drawsOf(ring())[0]?.alpha).toBeLessThan(steady);
        // Even while an invulnerable ship blinks out.
        stub.ship.invulnerable = true;
        stub.elapsed = 0.06;
        drawFrame(world, 1);
        expect(drawsOf(baker.ship(DRIFT).canvas)).toHaveLength(0);
        expect(drawsOf(ring())).toHaveLength(1);
      });

      it('cracks the ring apart when the Shield breaks, growing and fading, gone after the crack', () => {
        const { stub, world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        renderer.handle([{ type: 'shieldBroken' }], world);
        drawFrame(world, 1);
        const first = drawsOf(crack())[0];
        expect(first?.e).toBe(640);
        expect(first?.alpha).toBe(1);
        renderer.advance(CRACK_SECONDS / 2, world, false);
        drawFrame(world, 1);
        const later = drawsOf(crack())[0];
        expect(later?.alpha).toBeCloseTo(0.5, 9);
        expect(later?.a).toBeGreaterThan(first?.a ?? 0);
        renderer.advance(CRACK_SECONDS / 2, world, false);
        drawFrame(world, 1);
        expect(drawsOf(crack())).toHaveLength(0);
        expect(stub.effects.shield).toBe(0);
        expect(drawsOf(ring())).toHaveLength(0);
      });

      it('drops a crack in progress when a new run starts', () => {
        const { world } = stubWorld();
        renderer.resize(1280, 720, FIELD);
        renderer.handle([{ type: 'shieldBroken' }], world);
        renderer.reset();
        renderer.resize(1280, 720, FIELD);
        drawFrame(world, 1);
        expect(crack()).toBeUndefined();
      });
    });

    /** The x scale the ship hull is drawn with now. */
    function shipScale(world: World): number {
      drawFrame(world, 1);
      return drawsOf(baker.ship(DRIFT).canvas)[0]?.a ?? 0;
    }

    it('squashes the ship to 0.9 for a hit, easing back in 80 ms', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      const rest = shipScale(world);
      expect(rest).toBeGreaterThan(0);
      renderer.handle([shipHit], world);
      expect(shipScale(world) / rest).toBeCloseTo(0.9);
      advanceFrames(world, 2);
      const middle = shipScale(world) / rest;
      expect(middle).toBeGreaterThan(0.9);
      expect(middle).toBeLessThan(1);
      advanceFrames(world, 3);
      expect(shipScale(world)).toBe(rest);
    });

    it('squashes the ship through hit-stop, which only freezes the sim', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      const rest = shipScale(world);
      renderer.handle([shipHit], world);
      expect(shipScale(world) / rest).toBeCloseTo(0.9);
      for (let i = 0; i < 6; i++) renderer.advance(FRAME, world, true);
      expect(shipScale(world)).toBe(rest);
    });

    it('does not squash the ship under reduced motion', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      const rest = shipScale(world);
      renderer.effects.reducedMotion = true;
      renderer.handle([shipHit], world);
      expect(shipScale(world)).toBe(rest);
    });

    it('drops every flash and the squash when a new run starts', () => {
      const { world } = stubWorld();
      const white = breakRock(world);
      renderer.handle([shipHit], world);
      renderer.reset();
      renderer.resize(1280, 720, FIELD);
      drawFrame(world, 1);
      expect(drawsOf(white)).toHaveLength(0);
    });
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
    renderer.draw(world, 1, 0);
    renderer.draw(world, 1, 0);
    expect(renderer.drawCount).toBe(2);
  });

  it('reports its sprite cache\'s use as the baker counts it', () => {
    renderer.resize(1280, 720, FIELD);
    const { world } = stubWorld();
    renderer.draw(world, 1, 0);
    expect(renderer.spriteCache).toEqual(baker.cacheUse);
    expect(renderer.spriteCache.size).toBeGreaterThan(0);
  });

  describe('visual scale', () => {
    it('draws at the field size on a desktop screen', () => {
      renderer.resize(1280, 720, FIELD);
      expect(renderer.visualScale).toEqual({ ship: 1, rock: 1, shot: 1, effect: 1 });
    });

    it('bakes the sprites at the visual scale of a phone-sized screen, and reports it at once', () => {
      const setScale = vi.spyOn(baker, 'setScale');
      renderer.resize(390, 219.375, FIELD);
      const visual = visualScaleFor(390 / 1280);
      expect(visual.ship).toBeCloseTo(1.4);
      expect(renderer.visualScale).toEqual(visual);
      expect(setScale).toHaveBeenCalledExactlyOnceWith(390 / 1280, 1, visual);
    });

    it('sizes the ship glow and its wrap copies by the scaled radius', () => {
      renderer.resize(390, 219.375, FIELD);
      const { stub, world } = stubWorld();
      const glow = baker.glow(DRIFT.ship[1], 64 * 1.4).canvas;
      // A copy is needed where x < radius - 2 × WRAP_MARGIN: below -68 for the field-size glow, below -55.2 for the scaled one.
      stub.ship.x = stub.ship.px = -60;
      drawFrame(world, 1);
      expect(drawsOf(glow)).toHaveLength(2);
    });
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
      renderer.draw(stubWorld().world, 1, 0);
      expect(setScale).not.toHaveBeenCalled();

      vi.advanceTimersByTime(REBAKE_DELAY_MS);
      expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 1.25, visualScaleFor(1));
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

    it('stretches the vignette without smoothing and smooths everything else', () => {
      renderer.resize(1280, 720, FIELD);
      drawFrame(stubWorld().world, 1);
      const unsmoothed = canvas.draws.filter((call) => !call.smoothing);
      expect(unsmoothed).toHaveLength(1);
      // The vignette is baked at a quarter of the 1280 px field per axis.
      expect((unsmoothed[0]?.image as FakeCanvas | undefined)?.width).toBe(320);
    });

    it('draws fewer stars at a lower level', () => {
      renderer.resize(1280, 720, FIELD);
      const { world } = stubWorld();
      renderer.draw(world, 1, 0);
      const full = canvas.arcs;
      canvas.arcs = 0;
      renderer.setQuality(lowest);
      renderer.draw(world, 1, 0);
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
