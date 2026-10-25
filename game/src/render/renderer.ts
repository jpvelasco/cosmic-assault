import type { Asteroid } from '../sim/asteroid';
import type { SimEvent } from '../sim/events';
import { isPositiveFiniteSize, type Field } from '../sim/field';
import { createRng, deriveSeed } from '../sim/rng';
import type { World } from '../sim/world';
import { get2dContext } from './context';
import { createEffects, type Effects } from './effects';
import { createHud, type HudBounds, type HudRect } from './hud';
import { interpolatePose, wrapCopies } from './interp';
import { DRIFT } from './palette';
import { ParticlePool, type Particle } from './particles';
import { bakeSky, bakeVignette } from './sky';
import { createSpriteBaker, type Sprite } from './sprites';
import { createStarLayers } from './starfieldLayers';

export interface Renderer {
  resize(cssWidth: number, cssHeight: number, field: Field): void;
  /** Where the HUD may sit: safe-area insets and a corner to keep clear of, in CSS px. */
  setHudBounds(bounds: HudBounds): void;
  /** Feeds one sim step's events to the effects and drops the sprites of destroyed asteroids. */
  handle(events: readonly SimEvent[], world: World): void;
  /** Advances effects, particles and stars by one play-mode frame of `dt` seconds. */
  advance(dt: number, world: World): void;
  /** Draws the world `alpha` of the way from each entity's previous pose to its current one. */
  draw(world: World, alpha: number): void;
  /** Frees the previous run's sprites and particles; call when a new run starts. */
  reset(): void;
  readonly effects: Effects;
  /** The HUD pills drawn last, in CSS px. */
  readonly hudRects: readonly HudRect[];
  dispose(): void;
}

const MAX_DPR = 2;
const PARTICLE_CAPACITY = 400;
/** Sky, vignette and sprites re-bake this long after the last resize, not on every resize event. */
const REBAKE_DELAY_MS = 280;
/**
 * Render-only randomness; the sim never reads it. Each consumer derives its own stream, so the
 * sky dust, stars, flame flicker and bursts never line up with one another.
 */
const RENDER_SEED = 0x57a7f1e1;
const STAR_COUNT_SCALE = 1;
const BLINK_HZ = 10;
const TAU = Math.PI * 2;
const WHITE = '#ffffff';

// Glow and particle looks from the mockup's renderGlossy.
const ROCK_GLOW_SCALE = 3.2;
const ROCK_GLOW_ALPHA = 0.28;
const SHIP_GLOW_DIAMETER = 64;
const SHIP_GLOW_ALPHA = 0.3;
const FLAME_MIN_LENGTH = 12;
const FLAME_FLICKER = 6;
const FLASH_ALPHA = 0.22;
/** The field is larger on screen units than the mockup's, so rings run thicker to read at the same weight. */
const RING_MAX_WIDTH = 6;
const RING_MIN_WIDTH = 1.5;
const SHARD_ASPECT = 0.7;
const SHARD_EDGE_ALPHA = 0.7;
const SMOKE_ALPHA = 0.35;
const TRAIL_GLOW_SCALE = 3;
const SPARK_TAIL_SECONDS = 0.04;
const SPARK_WIDTH = 2.5;
/** Sparks stay at full brightness until their fade falls below 1 / SPARK_HOLD, then fade out. */
const SPARK_HOLD = 1.6;

interface Layout {
  readonly field: Field;
  readonly dpr: number;
  /** Device pixels per field unit. */
  readonly k: number;
  /** The field's top-left corner in device pixels. */
  readonly fieldX: number;
  readonly fieldY: number;
  readonly scale: number;
}

function devicePixelRatio(): number {
  const ratio = globalThis.devicePixelRatio;
  return Math.min(Number.isFinite(ratio) && ratio > 0 ? ratio : 1, MAX_DPR);
}

/** Backdrop layers baked per resize. */
interface Bakes {
  readonly sky: HTMLCanvasElement;
  readonly vignette: HTMLCanvasElement;
}

const fade = (p: Readonly<Particle>): number => p.life / p.max;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = get2dContext(canvas);
  const palette = DRIFT;
  const baker = createSpriteBaker();
  const particles = new ParticlePool(PARTICLE_CAPACITY);
  const effects = createEffects(particles, deriveSeed(RENDER_SEED, 'effects'), palette);
  const stars = createStarLayers(deriveSeed(RENDER_SEED, 'stars'), STAR_COUNT_SCALE);
  const flicker = createRng(deriveSeed(RENDER_SEED, 'flame'));
  const hud = createHud(palette);
  const copies = new Float64Array(6);
  const pose = { x: 0, y: 0, angle: 0 };

  let layout: Layout | null = null;
  let bakes: Bakes | null = null;
  let rebakeTimer: ReturnType<typeof setTimeout> | undefined;
  // The frame's field-plus-shake transform: device = k × field point + (tx, ty).
  let k = 1;
  let tx = 0;
  let ty = 0;

  function rebake({ field, scale, dpr, k: pixelsPerUnit }: Layout): void {
    bakes = {
      sky: bakeSky(field, pixelsPerUnit, palette, deriveSeed(RENDER_SEED, 'sky')),
      vignette: bakeVignette(field, pixelsPerUnit),
    };
    baker.setScale(scale, dpr);
  }

  function resize(cssWidth: number, cssHeight: number, field: Field): void {
    if (!isPositiveFiniteSize(cssWidth, cssHeight)) {
      throw new RangeError(
        `Renderer.resize() needs positive finite sizes (got ${String(cssWidth)}×${String(cssHeight)}); wait for layout first`,
      );
    }
    const dpr = devicePixelRatio();
    canvas.style.width = `${String(cssWidth)}px`;
    canvas.style.height = `${String(cssHeight)}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const scale = Math.min(cssWidth / field.width, cssHeight / field.height);
    const next: Layout = {
      field,
      dpr,
      k: scale * dpr,
      fieldX: ((cssWidth - field.width * scale) / 2) * dpr,
      fieldY: ((cssHeight - field.height * scale) / 2) * dpr,
      scale,
    };
    layout = next;
    stars.resize(field);
    hud.resize(cssWidth, cssHeight);
    clearTimeout(rebakeTimer);
    // The first bake is needed to draw at all; later ones wait for the resize to settle, and until
    // then the old bakes stretch to fit.
    if (bakes === null) rebake(next);
    else
      rebakeTimer = setTimeout(() => {
        rebake(next);
      }, REBAKE_DELAY_MS);
  }

  /** Clears the letterbox bars, where nothing else draws but the HUD may. */
  function clearBars({ fieldX, fieldY }: Layout): void {
    if (fieldX > 0) {
      ctx.clearRect(0, 0, fieldX, canvas.height);
      ctx.clearRect(canvas.width - fieldX, 0, fieldX, canvas.height);
    }
    if (fieldY > 0) {
      ctx.clearRect(0, 0, canvas.width, fieldY);
      ctx.clearRect(0, canvas.height - fieldY, canvas.width, fieldY);
    }
  }

  function fieldTransform(): void {
    ctx.setTransform(k, 0, 0, k, tx, ty);
  }

  /** Sets the shaken field transform, moved to (x, y) and turned by (cos, sin). */
  function place(x: number, y: number, cos: number, sin: number): void {
    ctx.setTransform(k * cos, k * sin, -k * sin, k * cos, k * x + tx, k * y + ty);
  }

  function blit({ canvas: image, halfW, halfH }: Sprite): void {
    ctx.drawImage(image, -halfW, -halfH, halfW * 2, halfH * 2);
  }

  /** Draws `sprite` centred at (x, y) and turned by (cos, sin), plus each wrap copy an entity of `radius` needs. */
  function stamp(sprite: Sprite, x: number, y: number, cos: number, sin: number, radius: number, field: Field): void {
    const count = wrapCopies(x, y, radius, field, copies);
    for (let i = -1; i < count; i++) {
      place(i < 0 ? x : x + (copies[i * 2] as number), i < 0 ? y : y + (copies[i * 2 + 1] as number), cos, sin);
      blit(sprite);
    }
  }

  /** Writes the asteroid's interpolated pose into `pose` and returns its glow's reach, which covers its body too. */
  function rockPose(a: Readonly<Asteroid>, alpha: number, field: Field): number {
    interpolatePose(a.px, a.py, a.protation, a.x, a.y, a.rotation, alpha, field, pose);
    return (a.radius * ROCK_GLOW_SCALE) / 2;
  }

  function drawRockGlows(world: World, alpha: number, field: Field): void {
    ctx.globalAlpha = ROCK_GLOW_ALPHA;
    for (const a of world.asteroids) {
      const reach = rockPose(a, alpha, field);
      stamp(baker.glow(palette.rockGlow, reach * 2), pose.x, pose.y, 1, 0, reach, field);
    }
    ctx.globalAlpha = 1;
  }

  function drawRocks(world: World, alpha: number, field: Field): void {
    for (const a of world.asteroids) {
      const reach = rockPose(a, alpha, field);
      stamp(baker.asteroid(a, palette), pose.x, pose.y, Math.cos(pose.angle), Math.sin(pose.angle), reach, field);
    }
  }

  function drawShots(world: World, alpha: number, field: Field): void {
    const sprite = baker.shot(palette);
    for (const p of world.projectiles) {
      interpolatePose(p.px, p.py, 0, p.x, p.y, 0, alpha, field, pose);
      // Aligned to the velocity: its unit vector is the turn's (cos, sin). Shots always move.
      const speed = Math.hypot(p.vx, p.vy) || 1;
      stamp(sprite, pose.x, pose.y, p.vx / speed, p.vy / speed, sprite.halfW, field);
    }
  }

  function drawShip(world: World, alpha: number, field: Field): void {
    const { ship } = world;
    // A lost last life leaves only its burst; an invulnerable ship blinks at BLINK_HZ.
    if (world.status === 'gameOver') return;
    if (ship.invulnerable && Math.floor(world.elapsed * BLINK_HZ * 2) % 2 === 1) return;
    interpolatePose(ship.px, ship.py, ship.pangle, ship.x, ship.y, ship.angle, alpha, field, pose);
    const { x, y } = pose;
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    const radius = SHIP_GLOW_DIAMETER / 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = SHIP_GLOW_ALPHA;
    stamp(baker.glow(palette.ship[1], SHIP_GLOW_DIAMETER), x, y, 1, 0, radius, field);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (ship.thrusting) {
      const length = FLAME_MIN_LENGTH + flicker.range(0, FLAME_FLICKER);
      stamp(baker.flame(palette, length), x, y, cos, sin, radius, field);
    }
    stamp(baker.ship(palette), x, y, cos, sin, radius, field);
  }

  // Particle visitors, made once so drawing allocates no closures. Each pass draws one blend group.
  // Particles do not wrap, so they skip the wrap copies.
  const drawRing = (p: Readonly<Particle>): void => {
    if (p.kind !== 'ring') return;
    const f = fade(p);
    ctx.globalAlpha = f;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = RING_MAX_WIDTH * f + RING_MIN_WIDTH;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - f), 0, TAU);
    ctx.stroke();
  };
  const drawDebris = (p: Readonly<Particle>): void => {
    if (p.kind === 'smoke') {
      ctx.globalAlpha = fade(p) * SMOKE_ALPHA;
      place(p.x, p.y, 1, 0);
      blit(baker.glow(p.color, p.size * 2));
    } else if (p.kind === 'shard') {
      const f = fade(p);
      const s = p.size;
      place(p.x, p.y, Math.cos(p.rot), Math.sin(p.rot));
      ctx.globalAlpha = f;
      ctx.fillStyle = p.color;
      ctx.fillRect(-s / 2, -s / 2, s, s * SHARD_ASPECT);
      ctx.globalAlpha = f * SHARD_EDGE_ALPHA;
      ctx.fillStyle = WHITE;
      ctx.fillRect(-s / 2, -s / 2, s, 1);
    }
  };
  const drawTrailGlow = (p: Readonly<Particle>): void => {
    if (p.kind !== 'glow') return;
    ctx.globalAlpha = fade(p);
    place(p.x, p.y, 1, 0);
    blit(baker.glow(p.color, p.size * TRAIL_GLOW_SCALE));
  };
  const drawSpark = (p: Readonly<Particle>): void => {
    if (p.kind !== 'spark') return;
    ctx.globalAlpha = Math.min(1, fade(p) * SPARK_HOLD);
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * SPARK_TAIL_SECONDS, p.y - p.vy * SPARK_TAIL_SECONDS);
    ctx.stroke();
  };

  function drawParticles(): void {
    ctx.globalCompositeOperation = 'source-over';
    particles.forEach(drawDebris);
    ctx.globalCompositeOperation = 'lighter';
    particles.forEach(drawTrailGlow);
    fieldTransform();
    ctx.lineWidth = SPARK_WIDTH;
    ctx.lineCap = 'round';
    particles.forEach(drawSpark);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Steps 1–2: sky and stars, unshaken, clipped to the field. */
  function drawBackdrop(world: World, { field, fieldX, fieldY }: Layout, backdrop: HTMLCanvasElement): void {
    ctx.setTransform(k, 0, 0, k, fieldX, fieldY);
    ctx.beginPath();
    ctx.rect(0, 0, field.width, field.height);
    ctx.clip();
    ctx.drawImage(backdrop, 0, 0, field.width, field.height);
    stars.draw(ctx, world.elapsed);
  }

  /** Steps 3–8: the shaken scene. */
  function drawScene(world: World, alpha: number, { field, fieldX, fieldY }: Layout): void {
    tx = fieldX + k * effects.shakeX;
    ty = fieldY + k * effects.shakeY;
    ctx.globalCompositeOperation = 'lighter';
    drawRockGlows(world, alpha, field);
    fieldTransform();
    particles.forEach(drawRing);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawRocks(world, alpha, field);
    ctx.globalCompositeOperation = 'lighter';
    drawShots(world, alpha, field);
    drawShip(world, alpha, field);
    drawParticles();
  }

  /** Steps 9–10, in device pixels: the vignette, then the flash. */
  function drawOverlays({ field, fieldX, fieldY }: Layout, shade: HTMLCanvasElement): void {
    const width = field.width * k;
    const height = field.height * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(shade, fieldX, fieldY, width, height);
    if (effects.flash > 0) {
      ctx.globalAlpha = effects.flash * FLASH_ALPHA;
      ctx.fillStyle = effects.flashColor;
      ctx.fillRect(fieldX, fieldY, width, height);
      ctx.globalAlpha = 1;
    }
  }

  function draw(world: World, alpha: number): void {
    const current = layout;
    if (current === null || bakes === null) {
      throw new Error('Renderer.draw() called before resize(); call resize() once the canvas has a size');
    }
    // The game-over step does not refresh previous poses, so interpolating would pull entities back.
    const a = world.status === 'gameOver' ? 1 : alpha;
    k = current.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    clearBars(current);
    ctx.save();
    drawBackdrop(world, current, bakes.sky);
    drawScene(world, a, current);
    drawOverlays(current, bakes.vignette);
    ctx.restore();
    ctx.setTransform(current.dpr, 0, 0, current.dpr, 0, 0);
    hud.draw(ctx, world);
  }

  return {
    resize,
    setHudBounds(bounds) {
      hud.setBounds(bounds);
    },
    handle(events, world) {
      effects.handle(events, world);
      for (const event of events) if (event.type === 'asteroidDestroyed') baker.forget(event.id);
    },
    advance(dt, world) {
      effects.step(dt, world);
      particles.step(dt);
      stars.step(dt, world.ship.vx, world.ship.vy);
    },
    draw,
    reset() {
      baker.clear();
      particles.clear();
    },
    effects,
    get hudRects() {
      return hud.rects;
    },
    dispose() {
      clearTimeout(rebakeTimer);
    },
  };
}
