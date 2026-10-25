import type { Asteroid } from '../sim/asteroid';
import { TAU } from '../sim/math';
import { FNV_OFFSET_BASIS, fnv1aStep, mulberry32 } from '../sim/rng';
import { mix, rgba } from './color';
import { get2dContext } from './context';
import type { Palette } from './palette';
import { SpriteCache } from './spriteCache';
import { UNIT_VISUAL, type VisualScale } from './visualScale';

/** A baked offscreen canvas. `halfW`/`halfH` are field units, visual scale included: draw it centred on its anchor. */
export interface Sprite {
  readonly canvas: HTMLCanvasElement;
  readonly halfW: number;
  readonly halfH: number;
}

export interface SpriteBaker {
  /** Additive radial glow; `diameter` (field units) snaps to a multiple of 4. */
  glow(color: string, diameter: number): Sprite;
  /** The hull, centred on the ship's origin with the nose along +x. */
  ship(palette: Palette): Sprite;
  /**
   * The rock unrotated, centred on its origin and lit from the sprite's upper left, so the
   * light turns with the rock. Cached per id, size and shape, so ids reused by a later World never collide.
   */
  asteroid(a: Readonly<Asteroid>, palette: Palette): Sprite;
  /** Shot with its glow baked in: head at the origin, tail along −x. Draw it additively. */
  shot(palette: Palette): Sprite;
  /**
   * Engine flame in ship-local units (behind the hull), so draw it with the ship's transform before the
   * body. Its colours are fixed; `palette` only scopes the cache entry. `length` snaps to steps of 2.
   */
  flame(palette: Palette, length: number): Sprite;
  /**
   * Device pixels per field unit are `pixelsPerUnit × dpr`. `visual` draws the ship, flame, rocks and shots
   * larger than their field size (a sprite's `halfW`/`halfH` then report the drawn size); glows take their
   * size from the caller. A change clears the cache.
   */
  setScale(pixelsPerUnit: number, dpr: number, visual?: VisualScale): void;
  /** Drops every sprite baked for this asteroid id. */
  forget(asteroidId: number): void;
  /** Frees every baked sprite, for example when a new run starts. */
  clear(): void;
}

interface CacheEntry {
  readonly sprite: Sprite;
  readonly asteroidId: number | undefined;
}

export interface Crater {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const WHITE = '#ffffff';
const DEFAULT_CAPACITY = 256;
/** Device pixels of transparent margin around every bake, so antialiased edges never clip. */
const EDGE_PAD_PX = 2;

const GLOW_STOPS: readonly (readonly [offset: number, alpha: number])[] = [
  [0, 1],
  [0.16, 0.62],
  [0.42, 0.2],
  [0.7, 0.06],
  [1, 0],
];
const GLOW_STEP = 4;

/** The hull outline in ship-local units, nose along +x. The HUD's life icons trace it too. */
export const SHIP_HULL: readonly Point[] = [
  { x: 14, y: 0 },
  { x: -10, y: -9 },
  { x: -6, y: 0 },
  { x: -10, y: 9 },
];
const SHIP_HALF_BEAM = 9;
const SHIP_RIM_WIDTH = 1;

const ROCK_RIM_WIDTH = 1.5;
/** Every crater lies within this fraction of the radius: inside the outline for 7+ vertices at ±30 % jaggedness. */
const CRATER_REACH = 0.6;
const CRATER_TRIES = 8;
/** Crater centres stay at least this multiple of their summed radii apart. */
const CRATER_GAP = 1.1;

const SHOT_LENGTH = 8;
const SHOT_WIDTH = 4.5;
const SHOT_CORE_WIDTH = 1.8;
const SHOT_GLOW_DIAMETER = 22;
const SHOT_GLOW_ALPHA = 0.85;

const FLAME_COLORS = ['#ffffff', '#ffe15a', '#ff5a28'] as const;
const FLAME_GLOW = '#ffd36b';
const FLAME_BASE_X = -7;
const FLAME_HALF_WIDTH = 4.5;
const FLAME_STEP = 2;

function requirePositive(name: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) {
    throw new RangeError(`${name} must be a positive finite number (got ${String(value)}); pass a value above 0`);
  }
}

export function snapGlowDiameter(diameter: number): number {
  requirePositive('glow diameter', diameter);
  return Math.max(GLOW_STEP, Math.round(diameter / GLOW_STEP) * GLOW_STEP);
}

export function snapFlameLength(length: number): number {
  requirePositive('flame length', length);
  return Math.max(FLAME_STEP * 2, Math.round(length / FLAME_STEP) * FLAME_STEP);
}

/** Mixed into the asteroid id to seed its crater stream, so the layout depends only on the id. */
const CRATER_SEED_MIX = 0x9e3779b9;

/**
 * Two or three craters for asteroid `id`, spread around the centre, kept within `CRATER_REACH × radius`
 * and apart from each other. A crater that finds no free spot in `CRATER_TRIES` draws is dropped.
 */
export function craterLayout(id: number, radius: number): readonly Crater[] {
  const next = mulberry32(id ^ CRATER_SEED_MIX);
  const count = next() < 0.5 ? 2 : 3;
  const start = next() * TAU;
  const craters: Crater[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < CRATER_TRIES; attempt++) {
      const size = 0.12 + next() * 0.12;
      const angle = start + ((i + (next() - 0.5) * 0.3) / count) * TAU;
      const distance = (0.5 + 0.5 * next()) * (CRATER_REACH - size) * radius;
      const crater = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, r: size * radius };
      if (craters.every((other) => !cratersOverlap(crater, other))) {
        craters.push(crater);
        break;
      }
    }
  }
  return craters;
}

export function cratersOverlap(a: Crater, b: Crater): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * CRATER_GAP;
}

/** FNV-1a over the radius and vertices rounded to 1e-3, so rocks that share an id but not a shape get distinct keys. */
export function shapeFingerprint(a: Readonly<Asteroid>): string {
  let hash = FNV_OFFSET_BASIS;
  const add = (value: number): void => {
    hash = fnv1aStep(hash, Math.round(value * 1000));
  };
  add(a.radius);
  for (const v of a.vertices) {
    add(v.x);
    add(v.y);
  }
  return (hash >>> 0).toString(16);
}

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

function paintGlow(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, radius: number, alpha = 1): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  for (const [offset, stopAlpha] of GLOW_STOPS) gradient.addColorStop(offset, rgba(color, stopAlpha * alpha));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function addStops(gradient: CanvasGradient, colors: readonly string[], offsets: readonly number[]): CanvasGradient {
  colors.forEach((color, i) => {
    gradient.addColorStop(offsets[i] ?? 1, color);
  });
  return gradient;
}

function paintShip(ctx: CanvasRenderingContext2D, p: Palette): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePath(ctx, SHIP_HULL);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, SHIP_HALF_BEAM, 0, -SHIP_HALF_BEAM), p.ship, [0, 0.5, 1]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Shade the trailing wings so the hull reads as a solid wedge, not a flat badge.
  const tail = ctx.createLinearGradient(14, 0, -10, 0);
  tail.addColorStop(0.55, rgba(p.ship[0], 0));
  tail.addColorStop(1, rgba(p.ship[0], 0.4));
  ctx.fillStyle = tail;
  ctx.fillRect(-10, -SHIP_HALF_BEAM, 24, SHIP_HALF_BEAM * 2);
  ctx.restore();
  ctx.strokeStyle = rgba(WHITE, 0.7);
  ctx.lineWidth = SHIP_RIM_WIDTH;
  ctx.stroke();
  // Specular glint along the lit leading edge.
  ctx.beginPath();
  ctx.moveTo(12.4, -1.1);
  ctx.lineTo(-7.6, -7.4);
  ctx.strokeStyle = rgba(WHITE, 0.6);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  paintCockpit(ctx, p.cockpit);
}

function paintCockpit(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.beginPath();
  ctx.ellipse(2, 0, 3.5, 2, 0, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(1.1, -0.8, 0, 1.6, 0, 4), [WHITE, color, mix(color, '#0066b0', 0.6)], [0, 0.35, 1]);
  ctx.fill();
  ctx.strokeStyle = rgba(mix(color, WHITE, 0.6), 0.8);
  ctx.lineWidth = 0.35;
  ctx.stroke();
}

function paintAsteroid(ctx: CanvasRenderingContext2D, a: Readonly<Asteroid>, p: Palette): void {
  const r = a.radius;
  ctx.lineJoin = 'round';
  tracePath(ctx, a.vertices);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.4 * r, -0.45 * r, 0.1 * r, 0, 0, 1.1 * r), p.rock, [0, 0.5, 1]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  paintGlow(ctx, WHITE, -0.4 * r, -0.45 * r, 0.36 * r, 0.1);
  paintCraters(ctx, craterLayout(a.id, r), p);
  ctx.restore();
  ctx.strokeStyle = p.rockRim;
  ctx.lineWidth = ROCK_RIM_WIDTH;
  ctx.stroke();
}

/** Dark pits with a lit lower lip, as the light falls from the upper left onto the far wall. */
function paintCraters(ctx: CanvasRenderingContext2D, craters: readonly Crater[], p: Palette): void {
  const pit = rgba(mix(p.rock[2], '#000000', 0.45), 0.48);
  const lip = rgba(mix(p.rock[0], WHITE, 0.35), 0.2);
  for (const c of craters) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, TAU);
    ctx.fillStyle = pit;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0.13 * Math.PI, 0.87 * Math.PI);
    ctx.strokeStyle = lip;
    ctx.lineWidth = Math.max(0.5, c.r * 0.12);
    ctx.stroke();
  }
}

function paintShot(ctx: CanvasRenderingContext2D, p: Palette): void {
  ctx.globalCompositeOperation = 'lighter';
  paintGlow(ctx, p.shot, 0, 0, SHOT_GLOW_DIAMETER / 2, SHOT_GLOW_ALPHA);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-SHOT_LENGTH, 0);
  ctx.strokeStyle = mix(p.shot, p.shotCore, 0.25);
  ctx.lineWidth = SHOT_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = p.shotCore;
  ctx.lineWidth = SHOT_CORE_WIDTH;
  ctx.stroke();
}

/** A teardrop: a rounded head at `x` (hidden under the hull) tapering to a point `length` behind it. */
function traceTeardrop(ctx: CanvasRenderingContext2D, x: number, halfWidth: number, length: number): void {
  ctx.beginPath();
  ctx.moveTo(x, -halfWidth);
  ctx.bezierCurveTo(x + halfWidth, -halfWidth, x + halfWidth, halfWidth, x, halfWidth);
  ctx.bezierCurveTo(x - length * 0.4, halfWidth, x - length * 0.7, halfWidth * 0.35, x - length, 0);
  ctx.bezierCurveTo(x - length * 0.7, -halfWidth * 0.35, x - length * 0.4, -halfWidth, x, -halfWidth);
  ctx.closePath();
}

function flameFill(ctx: CanvasRenderingContext2D, x: number, length: number): CanvasGradient {
  const [hot, warm, tip] = FLAME_COLORS;
  return addStops(ctx.createLinearGradient(x, 0, x - length, 0), [hot, warm, rgba(tip, 0)], [0, 0.35, 1]);
}

function paintFlame(ctx: CanvasRenderingContext2D, length: number): void {
  const x = FLAME_BASE_X;
  ctx.globalCompositeOperation = 'lighter';
  paintGlow(ctx, FLAME_GLOW, x - length * 0.3, 0, flameGlowRadius(length), 0.45);
  ctx.globalCompositeOperation = 'source-over';
  traceTeardrop(ctx, x, FLAME_HALF_WIDTH, length);
  ctx.fillStyle = flameFill(ctx, x, length);
  ctx.fill();
  traceTeardrop(ctx, x, FLAME_HALF_WIDTH * 0.45, length * 0.5);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = flameFill(ctx, x, length * 0.5);
  ctx.fill();
}

function flameGlowRadius(length: number): number {
  return Math.max(FLAME_HALF_WIDTH * 1.6, length * 0.55);
}

function maxDistance(points: readonly Point[]): number {
  return Math.max(...points.map((p) => Math.hypot(p.x, p.y)));
}

/** The map stored under `key`, created empty on first use. */
function inner<K, K2, V>(map: Map<K, Map<K2, V>>, key: K): Map<K2, V> {
  let next = map.get(key);
  if (next === undefined) {
    next = new Map<K2, V>();
    map.set(key, next);
  }
  return next;
}

/** Per rock object: its shape fingerprint, worked out once, and its cache key for the last palette drawn. */
interface RockKey {
  readonly fingerprint: string;
  readonly paletteId: string;
  readonly key: string;
}

/**
 * Keys are `kind|palette or colour|size(|asteroid id|shape)`. They omit the scale and visual scale because
 * `setScale` clears the cache, so every live entry was baked at the current ones.
 */
export function createSpriteBaker(capacity = DEFAULT_CAPACITY): SpriteBaker {
  /** Cache keys per asteroid id, so `forget` finds every entry; eviction keeps it in step. */
  const asteroidKeys = new Map<number, Set<string>>();
  const cache = new SpriteCache<CacheEntry>(capacity, (key, { sprite, asteroidId }) => {
    sprite.canvas.width = 0;
    sprite.canvas.height = 0;
    if (asteroidId === undefined) return;
    const keys = asteroidKeys.get(asteroidId);
    keys?.delete(key);
    if (keys?.size === 0) asteroidKeys.delete(asteroidId);
  });
  const rockKeys = new WeakMap<Readonly<Asteroid>, RockKey>();
  /** kind → palette id or colour → size → key, so looking a key up allocates nothing. */
  const keys = new Map<string, Map<string, Map<number, string>>>();
  let pixelsPerUnit = 1;
  let dpr = 1;
  let visual = UNIT_VISUAL;

  function keyOf(kind: string, name: string, size: number): string {
    const bySize = inner(inner(keys, kind), name);
    let key = bySize.get(size);
    if (key === undefined) {
      key = `${kind}|${name}|${String(size)}`;
      bySize.set(size, key);
    }
    return key;
  }

  /**
   * Bakes `paint` (in the art's own units, origin at the centre) onto a canvas spanning ±halfW × ±halfH plus
   * edge padding, drawn `zoom` times larger than those units on the field.
   */
  function bake(halfW: number, halfH: number, zoom: number, paint: (ctx: CanvasRenderingContext2D) => void): Sprite {
    const k = pixelsPerUnit * dpr;
    const kArt = k * zoom;
    const pad = EDGE_PAD_PX / kArt;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(2 * (halfW + pad) * kArt);
    canvas.height = Math.ceil(2 * (halfH + pad) * kArt);
    const ctx = get2dContext(canvas);
    ctx.setTransform(kArt, 0, 0, kArt, canvas.width / 2, canvas.height / 2);
    paint(ctx);
    return { canvas, halfW: canvas.width / (2 * k), halfH: canvas.height / (2 * k) };
  }

  function store(key: string, sprite: Sprite, asteroidId?: number): Sprite {
    cache.set(key, { sprite, asteroidId });
    if (asteroidId !== undefined) {
      const idKeys = asteroidKeys.get(asteroidId);
      if (idKeys === undefined) asteroidKeys.set(asteroidId, new Set([key]));
      else idKeys.add(key);
    }
    return sprite;
  }

  /** Rocks never change shape in place, so a key worked out once per object stays valid; drawing allocates none. */
  function asteroidKeyOf(a: Readonly<Asteroid>, p: Palette): string {
    const known = rockKeys.get(a);
    if (known?.paletteId === p.id) return known.key;
    const fingerprint = known?.fingerprint ?? shapeFingerprint(a);
    const key = `asteroid|${p.id}|${String(a.size)}|${String(a.id)}|${fingerprint}`;
    rockKeys.set(a, { fingerprint, paletteId: p.id, key });
    return key;
  }

  function bakeAsteroid(a: Readonly<Asteroid>, p: Palette): Sprite {
    const extent = maxDistance(a.vertices) + ROCK_RIM_WIDTH / 2;
    return bake(extent, extent, visual.rock, (ctx) => {
      paintAsteroid(ctx, a, p);
    });
  }

  // Each method looks the key up first and only builds the bake closure on a miss.
  return {
    glow(color, diameter) {
      const size = snapGlowDiameter(diameter);
      const key = keyOf('glow', color, size);
      return (
        cache.get(key)?.sprite ??
        store(
          key,
          bake(size / 2, size / 2, 1, (ctx) => {
            paintGlow(ctx, color, 0, 0, size / 2);
          }),
        )
      );
    },
    ship(p) {
      const key = keyOf('ship', p.id, 0);
      const half = SHIP_RIM_WIDTH / 2;
      return (
        cache.get(key)?.sprite ??
        store(
          key,
          bake(maxDistance(SHIP_HULL) + half, SHIP_HALF_BEAM + half, visual.ship, (ctx) => {
            paintShip(ctx, p);
          }),
        )
      );
    },
    asteroid(a, p) {
      const key = asteroidKeyOf(a, p);
      return cache.get(key)?.sprite ?? store(key, bakeAsteroid(a, p), a.id);
    },
    shot(p) {
      const key = keyOf('shot', p.id, 0);
      const glowRadius = SHOT_GLOW_DIAMETER / 2;
      return (
        cache.get(key)?.sprite ??
        store(
          key,
          bake(Math.max(glowRadius, SHOT_LENGTH + SHOT_WIDTH / 2), glowRadius, visual.shot, (ctx) => {
            paintShot(ctx, p);
          }),
        )
      );
    },
    flame(p, length) {
      const size = snapFlameLength(length);
      const key = keyOf('flame', p.id, size);
      const glowReach = size * 0.3 + flameGlowRadius(size);
      return (
        cache.get(key)?.sprite ??
        store(
          key,
          bake(-FLAME_BASE_X + Math.max(size, glowReach), flameGlowRadius(size), visual.ship, (ctx) => {
            paintFlame(ctx, size);
          }),
        )
      );
    },
    setScale(nextPixelsPerUnit, nextDpr, nextVisual = UNIT_VISUAL) {
      requirePositive('pixelsPerUnit', nextPixelsPerUnit);
      requirePositive('dpr', nextDpr);
      const { ship, rock, shot } = visual;
      if (
        nextPixelsPerUnit === pixelsPerUnit &&
        nextDpr === dpr &&
        nextVisual.ship === ship &&
        nextVisual.rock === rock &&
        nextVisual.shot === shot
      ) {
        return;
      }
      pixelsPerUnit = nextPixelsPerUnit;
      dpr = nextDpr;
      visual = nextVisual;
      cache.clear();
    },
    forget(asteroidId) {
      for (const key of [...(asteroidKeys.get(asteroidId) ?? [])]) cache.delete(key);
    },
    clear() {
      cache.clear();
    },
  };
}
