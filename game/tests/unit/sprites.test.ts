import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foeKeys } from '../../src/render/foePass';
import { DRIFT, ION_REACH, PALETTE_IDS, paletteFor, type Palette } from '../../src/render/palette';
import {
  craterLayout,
  createSpriteBaker,
  shapeFingerprint,
  type SpriteBaker,
  snapFlameLength,
  snapGlowDiameter,
} from '../../src/render/sprites';
import { SKIN_IDS, SKINS, type SkinId } from '../../src/content/cosmetics';
import { rgba } from '../../src/render/color';
import { createAsteroid, type AsteroidSize } from '../../src/sim/asteroid';
import { ASTEROID } from '../../src/sim/config';
import { createRng } from '../../src/sim/rng';

interface Point {
  readonly x: number;
  readonly y: number;
}

function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function insidePolygon(px: number, py: number, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Point;
    const b = points[j] as Point;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('craterLayout', () => {
  it('is deterministic per id and differs between ids', () => {
    expect(craterLayout(42, 40)).toEqual(craterLayout(42, 40));
    expect(craterLayout(42, 40)).not.toEqual(craterLayout(43, 40));
  });

  it('keeps the layout it has always drawn for an id', () => {
    expect(craterLayout(1, 40)).toEqual([
      { x: -6.090271208901983, y: 12.336100609752222, r: 8.558787885680793 },
      { x: 9.091579617917331, y: -9.783580514574991, r: 8.06939064078033 },
    ]);
  });

  it('keeps crater centres at least 1.1 × their summed radii apart', () => {
    for (let id = 1; id <= 400; id++) {
      const craters = craterLayout(id, ASTEROID.radii[id % 4] ?? 0);
      craters.forEach((a, i) => {
        for (const b of craters.slice(i + 1)) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual((a.r + b.r) * 1.1);
        }
      });
    }
  });

  it('places two or three craters of 0.12 to 0.24 radius, all of them inside the asteroid outline', () => {
    const rng = createRng(99);
    const counts = new Set<number>();
    for (let id = 1; id <= 400; id++) {
      const size = (id % 4) as AsteroidSize;
      const a = createAsteroid(rng, 0, 0, size, 0, 1, rng, id);
      const craters = craterLayout(a.id, a.radius);
      counts.add(craters.length);
      for (const c of craters) {
        expect(c.r).toBeGreaterThanOrEqual(0.12 * a.radius);
        expect(c.r).toBeLessThanOrEqual(0.24 * a.radius);
        expect(insidePolygon(c.x, c.y, a.vertices)).toBe(true);
        a.vertices.forEach((v, i) => {
          const next = a.vertices[(i + 1) % a.vertices.length] as Point;
          expect(distanceToSegment(c.x, c.y, v, next)).toBeGreaterThanOrEqual(c.r);
        });
      }
    }
    expect([...counts].sort()).toEqual([2, 3]);
  });
});

describe('shapeFingerprint', () => {
  it('matches for the same shape and differs for another shape', () => {
    const a = createAsteroid(createRng(1), 0, 0, 1, 0, 1, createRng(1), 5);
    const twin = createAsteroid(createRng(1), 300, 40, 1, 2, 1, createRng(1), 9);
    const other = createAsteroid(createRng(2), 0, 0, 1, 0, 1, createRng(2), 5);
    expect(shapeFingerprint(twin)).toBe(shapeFingerprint(a));
    expect(shapeFingerprint(other)).not.toBe(shapeFingerprint(a));
  });

  it('keeps the key it has always made for a shape', () => {
    const rng = createRng(5);
    expect(shapeFingerprint(createAsteroid(rng, 300, 300, 0, 0, 1, rng, 5))).toBe('927cc616');
  });
});

describe('snapping', () => {
  it('snaps glow diameters to multiples of 4, at least 4', () => {
    expect(snapGlowDiameter(22)).toBe(24);
    expect(snapGlowDiameter(64)).toBe(64);
    expect(snapGlowDiameter(1)).toBe(4);
    expect(snapGlowDiameter(ASTEROID.radii[0] * 3.2)).toBe(192);
  });

  it('snaps flame lengths to steps of 2, at least 4', () => {
    expect(snapFlameLength(12.9)).toBe(12);
    expect(snapFlameLength(13.1)).toBe(14);
    expect(snapFlameLength(0.5)).toBe(4);
  });

  it('rejects sizes that are not positive and finite', () => {
    expect(() => snapGlowDiameter(0)).toThrow(RangeError);
    expect(() => snapFlameLength(Number.NaN)).toThrow(RangeError);
  });
});

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): unknown;
}

/** A Canvas 2D stand-in that accepts every call, so the baker's sizing and caching run in Node. */
function fakeContext(): unknown {
  const gradient = { addColorStop: () => undefined };
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'createLinearGradient' || name === 'createRadialGradient' ? () => gradient : () => undefined,
      set: () => true,
    },
  );
}

describe('createSpriteBaker', () => {
  let created: FakeCanvas[];

  beforeEach(() => {
    created = [];
    vi.stubGlobal('document', {
      createElement: (): FakeCanvas => {
        const canvas: FakeCanvas = { width: 0, height: 0, getContext: fakeContext };
        created.push(canvas);
        return canvas;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function rock(id: number, size: AsteroidSize = 1) {
    const rng = createRng(id);
    return createAsteroid(rng, 0, 0, size, 0, 1, rng, id);
  }

  it('bakes in device pixels and reports half sizes in field units that cover the art', () => {
    const baker = createSpriteBaker();
    baker.setScale(1.5, 2);
    const ship = baker.ship(DRIFT);
    expect(ship.canvas.width).toBe(Math.round(ship.halfW * 2 * 3));
    expect(ship.halfW).toBeGreaterThanOrEqual(14.5);
    expect(ship.halfH).toBeGreaterThanOrEqual(9.5);

    const a = rock(5, 0);
    const reach = Math.max(...a.vertices.map((v) => Math.hypot(v.x, v.y)));
    const sprite = baker.asteroid(a, DRIFT);
    expect(sprite.halfW).toBeGreaterThan(reach);
    expect(sprite.halfH).toBe(sprite.halfW);

    expect(baker.glow('#5b8cff', 22).halfW).toBeGreaterThanOrEqual(12);
    expect(baker.flame(DRIFT, 18).halfW).toBeGreaterThanOrEqual(7 + 18);
    expect(baker.shot(DRIFT).halfW).toBeGreaterThanOrEqual(11);
  });

  it('draws the ship, flame, rocks and shots larger at a visual scale, but not glows or the pixel density', () => {
    const baker = createSpriteBaker();
    baker.setScale(1, 1);
    const a = rock(5, 1);
    const plain = {
      ship: baker.ship(DRIFT),
      flame: baker.flame(DRIFT, 16),
      rock: baker.asteroid(a, DRIFT),
      shot: baker.shot(DRIFT),
      glow: baker.glow('#5b8cff', 24),
    };
    baker.setScale(1, 1, { ship: 1.4, rock: 1.2, shot: 1.3, effect: 1.4 });
    expect(plain.ship.canvas.width).toBe(0);
    const near = (scaled: { halfW: number }, base: { halfW: number }, factor: number): void => {
      expect(scaled.halfW / base.halfW).toBeCloseTo(factor, 1);
    };
    near(baker.ship(DRIFT), plain.ship, 1.4);
    near(baker.flame(DRIFT, 16), plain.flame, 1.4);
    near(baker.asteroid(a, DRIFT), plain.rock, 1.2);
    near(baker.shot(DRIFT), plain.shot, 1.3);
    near(baker.glow('#5b8cff', 24), plain.glow, 1);
    // Bigger art, same pixel density: the canvas grows with the drawn size.
    const ship = baker.ship(DRIFT);
    expect(ship.canvas.width).toBe(Math.round(ship.halfW * 2));
  });

  it('keeps the cache when the visual scale is unchanged, and rebakes when it changes', () => {
    const baker = createSpriteBaker();
    baker.setScale(1, 1, { ship: 1.4, rock: 1.2, shot: 1.4, effect: 1.4 });
    const ship = baker.ship(DRIFT);
    baker.setScale(1, 1, { ship: 1.4, rock: 1.2, shot: 1.4, effect: 1.4 });
    expect(baker.ship(DRIFT)).toBe(ship);
    baker.setScale(1, 1, { ship: 1.2, rock: 1.1, shot: 1.2, effect: 1.2 });
    expect(baker.ship(DRIFT)).not.toBe(ship);
  });

  it('reports the sprites it holds by key, and how many it has evicted to stay within its capacity', () => {
    const baker = createSpriteBaker(2);
    expect(baker.cacheUse).toEqual({ size: 0, evictions: 0, keys: [] });
    baker.ship(DRIFT);
    baker.shot(DRIFT);
    expect(baker.cacheUse).toMatchObject({ size: 2, evictions: 0 });
    expect(baker.cacheUse.keys).toHaveLength(2);
    expect(baker.cacheUse.keys[0]).toMatch(/^ship\|drift:classic\|/);
    baker.glow('#5b8cff', 24);
    expect(baker.cacheUse).toMatchObject({ size: 2, evictions: 1 });
    expect(baker.cacheUse.keys[1]).toMatch(/^glow\|#5b8cff\|/);
  });

  it('holds at least 256 sprites by default', () => {
    const baker = createSpriteBaker();
    for (let id = 1; id <= 256; id++) baker.asteroid(rock(id), DRIFT);
    expect(baker.cacheUse).toMatchObject({ size: 256, evictions: 0 });
  });

  it('returns the cached sprite for the same key, including snapped glow and flame sizes', () => {
    const baker = createSpriteBaker();
    expect(baker.ship(DRIFT)).toBe(baker.ship(DRIFT));
    expect(baker.glow('#ff4fd8', 22.5)).toBe(baker.glow('#ff4fd8', 25));
    expect(baker.glow('#ff4fd8', 21)).not.toBe(baker.glow('#39ff14', 21));
    expect(baker.flame(DRIFT, 15.2)).toBe(baker.flame(DRIFT, 16.4));
    const a = rock(3);
    expect(baker.asteroid(a, DRIFT)).toBe(baker.asteroid(a, DRIFT));
    expect(baker.asteroid(rock(4), DRIFT)).not.toBe(baker.asteroid(a, DRIFT));
  });

  it('keys every sprite by palette, so a new palette bakes its own and the old ones are never looked up again', () => {
    const baker = createSpriteBaker();
    baker.setScale(1, 1);
    expect(baker.ship(ION_REACH)).not.toBe(baker.ship(DRIFT));
    expect(baker.shot(ION_REACH)).not.toBe(baker.shot(DRIFT));
    expect(baker.flame(ION_REACH, 16)).not.toBe(baker.flame(DRIFT, 16));
    expect(baker.ship(ION_REACH)).toBe(baker.ship(ION_REACH));
  });

  it('paints the shot and the asteroid in each palette\'s own colours', () => {
    const painted: string[] = [];
    const recording = new Proxy(
      {},
      {
        get: (_target, name) => (name === 'createLinearGradient' || name === 'createRadialGradient' ? () => ({ addColorStop: (_at: number, color: string) => painted.push(color) }) : () => undefined),
        set: (_target, name, value) => {
          if (name === 'fillStyle' || name === 'strokeStyle') painted.push(String(value));
          return true;
        },
      },
    );
    vi.stubGlobal('document', { createElement: (): FakeCanvas => ({ width: 0, height: 0, getContext: () => recording }) });
    const all = PALETTE_IDS.map(paletteFor);
    const a = rock(5);
    const bakes: Record<string, (baker: SpriteBaker, p: Palette) => unknown> = {
      shot: (baker, p) => baker.shot(p),
      asteroid: (baker, p) => baker.asteroid(a, p),
    };
    for (const [name, bake] of Object.entries(bakes)) {
      const colorSets = all.map((p) => {
        const baker = createSpriteBaker();
        baker.setScale(1, 1);
        painted.length = 0;
        bake(baker, p);
        return JSON.stringify([...new Set(painted)].sort());
      });
      expect(painted.length, name).toBeGreaterThan(0);
      expect(new Set(colorSets).size, name).toBe(all.length);
    }
  });

  it('keys the foe sprites by palette too', () => {
    const keys = [...Object.values(foeKeys(DRIFT)), ...Object.values(foeKeys(ION_REACH))];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('frees and rebakes everything when the scale or dpr changes, and keeps the cache otherwise', () => {
    const baker = createSpriteBaker();
    baker.setScale(1, 2);
    const ship = baker.ship(DRIFT);
    baker.setScale(1, 2);
    expect(baker.ship(DRIFT)).toBe(ship);
    baker.setScale(1, 1);
    expect(ship.canvas.width).toBe(0);
    expect(ship.canvas.height).toBe(0);
    const rebaked = baker.ship(DRIFT);
    expect(rebaked).not.toBe(ship);
    baker.setScale(2, 1);
    expect(rebaked.canvas.width).toBe(0);
  });

  it('forgets one asteroid sprite by id', () => {
    const baker = createSpriteBaker();
    const a = rock(7);
    const b = rock(8);
    const spriteA = baker.asteroid(a, DRIFT);
    const spriteB = baker.asteroid(b, DRIFT);
    baker.forget(a.id);
    expect(spriteA.canvas.width).toBe(0);
    expect(spriteB.canvas.width).toBeGreaterThan(0);
    expect(baker.asteroid(a, DRIFT)).not.toBe(spriteA);
    expect(baker.asteroid(b, DRIFT)).toBe(spriteB);
  });

  it('bakes separate sprites for asteroids that share an id but not a shape, as a new World reuses ids', () => {
    const baker = createSpriteBaker();
    const first = createAsteroid(createRng(1), 0, 0, 0, 0, 1, createRng(1), 1);
    const reused = createAsteroid(createRng(2), 0, 0, 0, 0, 1, createRng(2), 1);
    const sprite = baker.asteroid(first, DRIFT);
    expect(baker.asteroid(reused, DRIFT)).not.toBe(sprite);
    expect(baker.asteroid(first, DRIFT)).toBe(sprite);
    baker.forget(1);
    expect(sprite.canvas.width).toBe(0);
    expect(created.every((canvas) => canvas.width === 0)).toBe(true);
  });

  it('fingerprints each asteroid object once, not every frame', () => {
    const baker = createSpriteBaker();
    const a = rock(6);
    let reads = 0;
    const counted = Object.defineProperty({ ...a }, 'vertices', {
      get: () => {
        reads++;
        return a.vertices;
      },
    });
    baker.asteroid(counted, DRIFT);
    const afterBake = reads;
    for (let frame = 0; frame < 5; frame++) baker.asteroid(counted, DRIFT);
    expect(afterBake).toBeGreaterThan(0);
    expect(reads).toBe(afterBake);
  });

  it('re-keys a remembered asteroid when the palette changes', () => {
    const baker = createSpriteBaker();
    const a = rock(7);
    const drift = baker.asteroid(a, DRIFT);
    const other = baker.asteroid(a, ION_REACH);
    expect(other).not.toBe(drift);
    expect(baker.asteroid(a, DRIFT)).toBe(drift);
  });

  it('clear() frees every baked canvas', () => {
    const baker = createSpriteBaker();
    baker.ship(DRIFT);
    baker.shot(DRIFT);
    baker.flame(DRIFT, 14);
    baker.glow('#39ff14', 64);
    const a = rock(2);
    const sprite = baker.asteroid(a, DRIFT);
    baker.clear();
    expect(created).toHaveLength(5);
    expect(created.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(baker.asteroid(a, DRIFT)).not.toBe(sprite);
  });

  it('evicts the least recently used sprite past capacity and frees its canvas', () => {
    const baker = createSpriteBaker(2);
    const first = baker.asteroid(rock(1), DRIFT);
    baker.asteroid(rock(2), DRIFT);
    baker.asteroid(rock(3), DRIFT);
    expect(first.canvas.width).toBe(0);
    expect(created).toHaveLength(3);
  });

  describe('white silhouettes', () => {
    /** Canvases whose context logs the calls that decide the look of a white bake. */
    function recordingCanvases(): { calls: string[][]; canvases: unknown[] } {
      const calls: string[][] = [];
      const canvases: unknown[] = [];
      vi.stubGlobal('document', {
        createElement: () => {
          const log: string[] = [];
          calls.push(log);
          const gradient = { addColorStop: () => undefined };
          const ctx = new Proxy(
            {},
            {
              get: (_target, name) => {
                if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => gradient;
                return (...args: unknown[]) => log.push(`${String(name)}(${args.map((arg) => (typeof arg === 'number' ? String(arg) : 'canvas')).join(',')})`);
              },
              set: (_target, name, value) => {
                log.push(`${String(name)}=${String(value)}`);
                return true;
              },
            },
          );
          const canvas = { width: 0, height: 0, getContext: () => ctx };
          canvases.push(canvas);
          return canvas;
        },
      });
      return { calls, canvases };
    }

    it('bakes a rock, then stamps it solid white: draw it, then fill white only where it has pixels', () => {
      const { calls } = recordingCanvases();
      const baker = createSpriteBaker();
      const a = rock(3);
      const body = baker.asteroid(a, DRIFT);
      const key = baker.whiteRock(a.id);
      const white = key === undefined ? undefined : baker.cached(key);
      expect(white).toBeDefined();
      expect(white?.canvas).not.toBe(body.canvas);
      expect(white?.halfW).toBe(body.halfW);
      expect(white?.halfH).toBe(body.halfH);
      expect(white?.canvas.width).toBe(body.canvas.width);
      const log = calls.at(-1) ?? [];
      expect(log).toEqual(['drawImage(canvas,0,0)', 'globalCompositeOperation=source-in', 'fillStyle=#ffffff', expect.stringMatching(/^fillRect\(0,0,/)]);
      expect(log.some((entry) => entry.startsWith('shadowBlur') || entry.startsWith('filter'))).toBe(false);
    });

    it('is baked once per rock, and not for a rock never drawn', () => {
      const baker = createSpriteBaker();
      const a = rock(3);
      expect(baker.whiteRock(a.id)).toBeUndefined();
      baker.asteroid(a, DRIFT);
      const key = baker.whiteRock(a.id);
      expect(key).toBeDefined();
      expect(baker.whiteRock(a.id)).toBe(key);
      const key2 = key ?? '';
      expect(baker.cached(key2)).toBe(baker.cached(key2));
    });

    it('outlives the rock\'s own sprite, so a flash can finish after the rock is forgotten', () => {
      const baker = createSpriteBaker();
      const a = rock(3);
      baker.asteroid(a, DRIFT);
      const key = baker.whiteRock(a.id) ?? '';
      baker.forget(a.id);
      expect(baker.cached(key)?.canvas.width).toBeGreaterThan(0);
      expect(baker.whiteRock(a.id)).toBeUndefined();
    });

    it('whitens a custom sprite by key, and only one that is cached', () => {
      const baker = createSpriteBaker();
      expect(baker.white('boss|core|70')).toBeUndefined();
      const core = baker.custom('boss|core|70', 72, () => undefined);
      const white = baker.white('boss|core|70');
      expect(white?.canvas).not.toBe(core.canvas);
      expect(white?.halfW).toBe(core.halfW);
      expect(baker.white('boss|core|70')).toBe(white);
    });

    it('is gone from the cache, not a zero-size canvas, once the scale changes', () => {
      const baker = createSpriteBaker();
      const a = rock(3);
      baker.asteroid(a, DRIFT);
      const key = baker.whiteRock(a.id) ?? '';
      const white = baker.cached(key);
      baker.setScale(2, 1);
      expect(white?.canvas.width).toBe(0);
      expect(baker.cached(key)).toBeUndefined();
    });

    it('asks for no new key string each time a custom sprite is whitened', () => {
      const baker = createSpriteBaker();
      baker.custom('boss|core|70', 72, () => undefined);
      const first = baker.white('boss|core|70');
      expect(baker.white('boss|core|70')).toBe(first);
    });

    it('is rebaked with the rest when the scale changes', () => {
      const baker = createSpriteBaker();
      baker.custom('k', 10, () => undefined);
      const white = baker.white('k');
      baker.setScale(2, 1);
      expect(white?.canvas.width).toBe(0);
      expect(baker.white('k')).toBeUndefined();
    });
  });

  it('rejects a scale that is not positive and finite', () => {
    const baker = createSpriteBaker();
    expect(() => {
      baker.setScale(0, 1);
    }).toThrow(RangeError);
    expect(() => {
      baker.setScale(1, Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);
  });
});

describe('ship skins', () => {
  /** A canvas whose context logs each path op and fill with its arguments; a gradient logs its stops. */
  function recordingCanvas(ops: string[]): { getContext(kind: string): unknown } {
    let fillStyle: unknown = '';
    let strokeStyle: unknown = '';
    const gradient = () => {
      const stops: string[] = [];
      return { stops, addColorStop: (offset: number, color: string) => stops.push(`${String(offset)}:${color}`) };
    };
    const ctx = new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === 'createLinearGradient' || name === 'createRadialGradient') return gradient;
          if (name === 'fill') return () => ops.push(`fill ${JSON.stringify(fillStyle)}`);
          if (name === 'stroke') return () => ops.push(`stroke ${String(strokeStyle)}`);
          if (typeof name === 'string' && ['beginPath', 'moveTo', 'lineTo', 'closePath', 'bezierCurveTo', 'arc', 'ellipse', 'clip'].includes(name)) {
            return (...args: unknown[]) => ops.push(`${name} ${args.map(String).join(' ')}`);
          }
          return () => undefined;
        },
        set: (_target, name, value) => {
          if (name === 'fillStyle') fillStyle = value;
          if (name === 'strokeStyle') strokeStyle = value;
          return true;
        },
      },
    );
    return { getContext: () => ctx };
  }

  /** The ops a ship bake makes with `skin`, from a fresh baker, with the fills and strokes that are not the hull's. */
  function bakeOps(skin: SkinId, palette: Palette = DRIFT) {
    const ops: string[] = [];
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, ...recordingCanvas(ops) }) });
    createSpriteBaker().ship(palette, skin);
    vi.unstubAllGlobals();
    return ops;
  }

  it('keys the ship by palette and skin, so a skin change misses the cache once and leaves the others', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: fakeContext }) });
    const baker = createSpriteBaker();
    const classic = baker.ship(DRIFT);
    const ember = baker.ship(DRIFT, 'ember');
    expect(ember).not.toBe(classic);
    expect(baker.cached('ship|drift:ember|0')).toBe(ember);
    expect(baker.ship(DRIFT)).toBe(classic);
    expect(baker.ship(DRIFT, 'ember')).toBe(ember);
    vi.unstubAllGlobals();
  });

  it('draws the hull path identically for every skin, so a skin trims the hull and never reshapes it', () => {
    const hullOf = (ops: readonly string[]) => ops.slice(0, ops.indexOf(ops.find((op) => op.startsWith('fill')) ?? ''));
    const classic = hullOf(bakeOps('classic'));
    expect(classic.length).toBeGreaterThan(4);
    expect(hullOf(bakeOps('ember'))).toEqual(classic);
    expect(hullOf(bakeOps('nova'))).toEqual(classic);
  });

  /** The hero's green, which every palette's ship body is built around and no trim may change. */
  const HERO_GREEN = '#39ff14';

  it.each(PALETTE_IDS)('fills the body with the hero green under every trim in the %s palette', (id) => {
    const palette = paletteFor(id);
    const bodyFill = (ops: readonly string[]) => ops.find((op) => op.startsWith('fill')) ?? '';
    const stops = JSON.stringify({ stops: palette.ship.map((color, i) => `${String([0, 0.5, 1][i])}:${color}`) });
    expect(palette.ship[1]).toBe(HERO_GREEN);
    for (const skin of SKIN_IDS) expect(bodyFill(bakeOps(skin, palette)), skin).toBe(`fill ${stops}`);
  });

  it('rims the hull in the skin\'s colour and adds the panel lines only to a skin that has them', () => {
    const strokes = (ops: readonly string[]) => ops.filter((op) => op.startsWith('stroke'));
    expect(strokes(bakeOps('classic'))[0]).toBe(`stroke ${rgba('#ffffff', 0.7)}`);
    expect(strokes(bakeOps('ember'))[0]).toBe(`stroke ${rgba(SKINS.ember.rim, 0.7)}`);
    // The rim, the glint and the cockpit's outline, plus the panel lines when the skin has them.
    expect(strokes(bakeOps('classic'))).toHaveLength(3);
    expect(strokes(bakeOps('ember'))).toHaveLength(4);
  });
});
