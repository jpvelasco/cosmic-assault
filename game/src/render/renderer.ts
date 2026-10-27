import type { PaletteId } from '../content/types';
import type { Asteroid } from '../sim/asteroid';
import type { SimEvent } from '../sim/events';
import { isPositiveFiniteSize, type Field } from '../sim/field';
import { enemyTimeScale } from '../sim/pickups/effects';
import { createRng, deriveSeed } from '../sim/rng';
import { hasEnded, type World } from '../sim/world';
import { get2dContext } from './context';
import { createEffects, type Effects } from './effects';
import { createFieldPen } from './fieldPen';
import { createBoltPass } from './boltPass';
import { createFoePass } from './foePass';
import { createHazardPass } from './hazardPass';
import { createHitFlash, HIT_FLASH_SECONDS } from './hitFlash';
import { createHud, type HudBounds, type HudRect } from './hud';
import { interpolatePose, wrapCopies } from './interp';
import { createBossPass } from './bossPass';
import { createBackdrop, devicePixelRatio, layoutFor, type Bakes, type Layout } from './layout';
import { DRIFT, paletteFor, type Palette } from './palette';
import { createParticlePass } from './particlePass';
import { createPickupPass } from './pickupPass';
import { createWingmanPass } from './wingmanPass';
import type { SceneLook } from './scene';
import { DEFAULT_PARTICLE_CAPACITY, ParticlePool } from './particles';
import { HIGH_QUALITY, type QualityLevel } from './quality';
import { createSpriteBaker, type Sprite, type SpriteBaker } from './sprites';
import { createStarLayers } from './starfieldLayers';
import { UNIT_VISUAL, type VisualScale } from './visualScale';

export interface Renderer {
  resize(cssWidth: number, cssHeight: number, field: Field): void;
  /** Where the HUD may sit: safe-area insets and a corner to keep clear of, in CSS px. */
  setHudBounds(bounds: HudBounds): void;
  /** Feeds one sim step's events to the effects and drops the sprites of destroyed asteroids. */
  handle(events: readonly SimEvent[], world: World): void;
  /**
   * Advances effects, particles and stars by one play-mode frame of `dt` seconds. While `frozen`
   * (hit-stop) the ship leaves no trail; particles still move.
   */
  advance(dt: number, world: World, frozen: boolean): void;
  /** After the run ends: lets bursts, shake and flash play out by `dt` seconds; the stars stay still. */
  settle(dt: number, world: World): void;
  /** True while any particle is still alive, so a still frame needs redrawing. */
  hasActiveParticles(): boolean;
  /** True once after a deferred re-bake, so a still frame is redrawn with it. Reading clears it. */
  consumeRedrawRequest(): boolean;
  /**
   * Applies a quality level: backing-store ratio, glow alpha, particle pool, star count, vignette.
   * A changed pixel ratio re-bakes after the usual resize debounce, not on the next frame.
   */
  setQuality(level: QualityLevel): void;
  /** Draws the world `alpha` of the way from each entity's previous pose to its current one; the HUD shows `score`. */
  draw(world: World, alpha: number, score: number): void;
  /** Frees the previous run's sprites and particles; call when a new run starts. */
  reset(): void;
  /**
   * Redraws everything in palette `id`: the sky and vignette re-bake at once, the sprites bake under the new palette's
   * keys (the old ones are never looked up again), and bursts, the HUD, the stars and the foe, hazard, pickup and boss
   * art take its colours. Nothing happens for the palette already in force. Call it when a run starts.
   */
  setPalette(id: PaletteId): void;
  /** The palette in force. */
  readonly palette: PaletteId;
  readonly effects: Effects;
  /** The HUD pills drawn last, in CSS px. */
  readonly hudRects: readonly HudRect[];
  /** Frames drawn so far. */
  readonly drawCount: number;
  /** How much larger than their field size sprites are drawn at the current layout; 1 across the board before the first `resize`. */
  readonly visualScale: VisualScale;
  /** Cancels a pending re-bake and frees every sprite and particle. */
  dispose(): void;
}

/** The size last given to `resize()`, kept so a quality change can lay the canvas out again. */
interface View {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly field: Field;
}

/** Parts a caller may supply instead of the defaults, such as test doubles. */
export interface RendererParts {
  readonly baker?: SpriteBaker;
  readonly particles?: ParticlePool;
}

/**
 * Render-only randomness; the sim never reads it. Each consumer derives its own stream, so the
 * sky dust, stars, flame flicker and bursts never line up with one another.
 */
const RENDER_SEED = 0x57a7f1e1;
const BLINK_HZ = 10;

// Glow looks from the mockup's renderGlossy.
const ROCK_GLOW_SCALE = 3.2;
const ROCK_GLOW_ALPHA = 0.28;
const SHIP_GLOW_DIAMETER = 64;
const SHIP_GLOW_ALPHA = 0.3;
const FLAME_MIN_LENGTH = 12;
const FLAME_FLICKER = 6;
const FLASH_ALPHA = 0.22;
/** Time Warp's vignette fades over this many seconds as the warp runs out. */
const TIME_WARP_FADE_SECONDS = 0.5;

/** True while an invulnerable ship is in the hidden half of its BLINK_HZ blink. */
export function blinkHidden(elapsed: number): boolean {
  return Math.floor(elapsed * BLINK_HZ * 2) % 2 === 1;
}

/** True while the ship is drawn hidden: invulnerable and in the hidden half of its blink. The ship and its Wingman share this. */
export function shipHidden(world: Pick<World, 'ship' | 'elapsed'>): boolean {
  return world.ship.invulnerable && blinkHidden(world.elapsed);
}

export function createRenderer(canvas: HTMLCanvasElement, parts: RendererParts = {}): Renderer {
  const ctx = get2dContext(canvas);
  let palette: Palette = DRIFT;
  const baker = parts.baker ?? createSpriteBaker();
  const particles = parts.particles ?? new ParticlePool(DEFAULT_PARTICLE_CAPACITY);
  const hitFlash = createHitFlash(baker);
  const effects = createEffects(particles, deriveSeed(RENDER_SEED, 'effects'), palette);
  const stars = createStarLayers(deriveSeed(RENDER_SEED, 'stars'), HIGH_QUALITY.starScale);
  const flicker = createRng(deriveSeed(RENDER_SEED, 'flame'));
  const backdrop = createBackdrop(baker, palette, deriveSeed(RENDER_SEED, 'sky'));
  const pen = createFieldPen(ctx);
  const particlePass = createParticlePass(ctx, pen, baker, particles);
  const hud = createHud(palette);
  const bossLook = { glow: 1, still: false, aimX: 0, aimY: 0, field: { width: 0, height: 0 } };
  const scene: { -readonly [K in keyof SceneLook]: SceneLook[K] } = { glow: 1, still: false, time: 0, visual: UNIT_VISUAL };
  const copies = new Float64Array(6);
  const pose = { x: 0, y: 0, angle: 0 };
  let layout: Layout | null = null;
  let view: View | null = null;
  let quality = HIGH_QUALITY;
  let drawCount = 0;

  function resize(cssWidth: number, cssHeight: number, field: Field): void {
    if (!isPositiveFiniteSize(cssWidth, cssHeight)) {
      throw new RangeError(
        `Renderer.resize() needs positive finite sizes (got ${String(cssWidth)}×${String(cssHeight)}); wait for layout first`,
      );
    }
    view = { cssWidth, cssHeight, field };
    applyView(view);
  }

  /** Sizes the canvas and layout at the pixel ratio the quality level allows, and schedules the re-bake. */
  function applyView({ cssWidth, cssHeight, field }: View): void {
    const dpr = devicePixelRatio(quality.dprCap);
    canvas.style.width = `${String(cssWidth)}px`;
    canvas.style.height = `${String(cssHeight)}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    layout = layoutFor(cssWidth, cssHeight, field, dpr);
    stars.resize(field);
    hud.resize(cssWidth, cssHeight);
    backdrop.schedule(layout);
  }

  function setQuality(level: QualityLevel): void {
    quality = level;
    particles.setCapacity(level.particles);
    stars.setCountScale(level.starScale);
    if (view !== null && devicePixelRatio(level.dprCap) !== layout?.dpr) applyView(view);
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

  /** Draws `sprite` centred at (x, y) and turned by (cos, sin), plus each wrap copy an entity of `radius` needs. */
  function stamp(sprite: Sprite, x: number, y: number, cos: number, sin: number, radius: number, field: Field): void {
    const count = wrapCopies(x, y, radius, field, copies);
    for (let i = -1; i < count; i++) {
      pen.place(i < 0 ? x : x + (copies[i * 2] as number), i < 0 ? y : y + (copies[i * 2 + 1] as number), cos, sin);
      pen.blit(sprite);
    }
  }

  /** The passes whose sprite keys and painters are made once per palette. */
  const passesFor = (p: Palette) => ({
    boss: createBossPass(ctx, pen, baker, p),
    bolt: createBoltPass(ctx, stamp, baker, p),
    foe: createFoePass(ctx, pen, stamp, baker, p),
    hazard: createHazardPass(ctx, pen, stamp, baker, p),
    pickup: createPickupPass(ctx, stamp, baker, p),
    wingman: createWingmanPass(ctx, stamp, baker, p),
  });
  let passes = passesFor(palette);

  function setPalette(id: PaletteId): void {
    if (id === palette.id) return;
    palette = paletteFor(id);
    effects.setPalette(palette);
    hud.setPalette(palette);
    backdrop.setPalette(palette);
    passes = passesFor(palette);
  }

  /** Writes the asteroid's interpolated pose into `pose` and returns its drawn glow's reach, which covers its body too. */
  function rockPose(a: Readonly<Asteroid>, alpha: number, field: Field, visual: VisualScale): number {
    interpolatePose(a.px, a.py, a.protation, a.x, a.y, a.rotation, alpha, field, pose);
    return (a.radius * ROCK_GLOW_SCALE * visual.rock) / 2;
  }

  function drawRockGlows(world: World, alpha: number, field: Field, visual: VisualScale): void {
    ctx.globalAlpha = ROCK_GLOW_ALPHA * quality.glow;
    for (const a of world.asteroids) {
      const reach = rockPose(a, alpha, field, visual);
      stamp(baker.glow(palette.rockGlow, reach * 2), pose.x, pose.y, 1, 0, reach, field);
    }
    ctx.globalAlpha = 1;
  }

  function drawRocks(world: World, alpha: number, field: Field, visual: VisualScale): void {
    for (const a of world.asteroids) {
      const reach = rockPose(a, alpha, field, visual);
      stamp(baker.asteroid(a, palette), pose.x, pose.y, Math.cos(pose.angle), Math.sin(pose.angle), reach, field);
    }
  }

  /** The silhouettes of rocks that just broke, fading over their flash; unturned, since the event holds no rotation. */
  function drawRockFlashes(field: Field): void {
    for (const { key, x, y, left } of hitFlash.rocks) {
      // A rebake or an eviction may have freed the silhouette since the break: skip it, never draw an empty canvas.
      const sprite = baker.cached(key);
      if (sprite === undefined || sprite.canvas.width === 0) continue;
      ctx.globalAlpha = left / HIT_FLASH_SECONDS;
      stamp(sprite, x, y, 1, 0, sprite.halfW, field);
    }
    ctx.globalAlpha = 1;
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

  function drawShip(world: World, alpha: number, field: Field, visual: VisualScale): void {
    const { ship } = world;
    // A lost last life leaves only its burst.
    if (world.status === 'gameOver') return;
    interpolatePose(ship.px, ship.py, ship.pangle, ship.x, ship.y, ship.angle, alpha, field, pose);
    const { x, y } = pose;
    // The Shield's ring (and its crack, as the hit that broke it starts the blink) shows through the blink.
    passes.pickup.drawShield(world.effects.shield, x, y, field, scene);
    if (shipHidden(world)) return;
    // The squash scales the hull and its flame, not the glow: the pen's turn (cos, sin) carries a scale too.
    const squash = effects.reducedMotion ? 1 : hitFlash.shipScale;
    const cos = Math.cos(pose.angle) * squash;
    const sin = Math.sin(pose.angle) * squash;
    const glowDiameter = SHIP_GLOW_DIAMETER * visual.ship;
    const radius = glowDiameter / 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = SHIP_GLOW_ALPHA * quality.glow;
    stamp(baker.glow(palette.ship[1], glowDiameter), x, y, 1, 0, radius, field);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (ship.thrusting) {
      const length = FLAME_MIN_LENGTH + flicker.range(0, FLAME_FLICKER);
      stamp(baker.flame(palette, length), x, y, cos, sin, radius, field);
    }
    stamp(baker.ship(palette), x, y, cos, sin, radius, field);
  }

  /** Under the rocks, so an attack's shards fly out of the core; its eye follows the ship. */
  function drawBoss(world: World, alpha: number): void {
    bossLook.glow = quality.glow;
    bossLook.still = effects.reducedMotion;
    bossLook.aimX = world.ship.x;
    bossLook.aimY = world.ship.y;
    bossLook.field = world.field;
    passes.boss.draw(world.boss, alpha, bossLook);
  }

  /** Steps 1–2: sky and stars, unshaken, clipped to the field. */
  function drawBackdrop(world: World, { field, k, fieldX, fieldY }: Layout, sky: HTMLCanvasElement): void {
    ctx.setTransform(k, 0, 0, k, fieldX, fieldY);
    ctx.beginPath();
    ctx.rect(0, 0, field.width, field.height);
    ctx.clip();
    ctx.drawImage(sky, 0, 0, field.width, field.height);
    stars.draw(ctx, world.elapsed, palette.star);
  }

  /** Steps 3–8: the shaken scene. */
  function drawScene(world: World, alpha: number, { field, k, fieldX, fieldY, visual }: Layout): void {
    pen.aim(k, fieldX + k * effects.shakeX, fieldY + k * effects.shakeY);
    scene.glow = quality.glow;
    scene.still = effects.reducedMotion;
    scene.time = world.elapsed;
    scene.visual = visual;
    ctx.globalCompositeOperation = 'lighter';
    drawRockGlows(world, alpha, field, visual);
    particlePass.drawRings(visual.effect);
    ctx.globalCompositeOperation = 'source-over';
    passes.hazard.drawHazards(world.hazards, field, scene);
    drawBoss(world, alpha);
    drawRocks(world, alpha, field, visual);
    passes.foe.drawFoes(world.foes, alpha, field, scene);
    drawRockFlashes(field);
    passes.foe.drawFlashes(hitFlash.foes, field);
    passes.hazard.drawWarnings(world.hazards, field, scene);
    passes.pickup.drawPickups(world.pickups, alpha, field, scene);
    passes.bolt.drawBolts(world.bolts, alpha, field, scene);
    ctx.globalCompositeOperation = 'lighter';
    drawShots(world, alpha, field);
    drawShip(world, alpha, field, visual);
    // The Wingman flies with the ship, so it blinks hidden with it while the ship is invulnerable and in its hidden half.
    if (!shipHidden(world)) passes.wingman.draw(world, alpha, field, scene);
    particlePass.drawBursts(visual.effect);
  }

  /** Steps 9–11, in device pixels: the vignette, Time Warp's cool one while it runs, then the flash. */
  function drawOverlays({ field, k, fieldX, fieldY }: Layout, { vignette, timeWarp }: Bakes, timeWarpLeft: number): void {
    const width = field.width * k;
    const height = field.height * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (quality.vignette) {
      // The quarter-resolution gradient stretches nearest-neighbour within one colour level of a full bake;
      // a smoothed stretch would cost several times a 1:1 blit on CPU-rasterized canvases.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(vignette, fieldX, fieldY, width, height);
      ctx.imageSmoothingEnabled = true;
    }
    if (timeWarpLeft > 0) {
      // Time Warp's vignette is baked, not filtered: it fades out over the warp's last moments.
      ctx.globalAlpha = Math.min(1, timeWarpLeft / TIME_WARP_FADE_SECONDS);
      ctx.drawImage(timeWarp, fieldX, fieldY, width, height);
      ctx.globalAlpha = 1;
    }
    if (effects.flash > 0) {
      ctx.globalAlpha = effects.flash * FLASH_ALPHA;
      ctx.fillStyle = effects.flashColor;
      ctx.fillRect(fieldX, fieldY, width, height);
      ctx.globalAlpha = 1;
    }
  }

  function draw(world: World, alpha: number, score: number): void {
    const current = layout;
    const { bakes } = backdrop;
    if (current === null || bakes === null) {
      throw new Error('Renderer.draw() called before resize(); call resize() once the canvas has a size');
    }
    // A step after the run ends does not refresh previous poses, so interpolating would pull entities back.
    const a = hasEnded(world.status) ? 1 : alpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    clearBars(current);
    ctx.save();
    drawBackdrop(world, current, bakes.sky);
    drawScene(world, a, current);
    drawOverlays(current, bakes, world.effects.timeWarp);
    ctx.restore();
    ctx.setTransform(current.dpr, 0, 0, current.dpr, 0, 0);
    hud.draw(ctx, world, score, effects.reducedMotion);
    drawCount++;
  }

  function stepBursts(dt: number, world: World, frozen: boolean): void {
    effects.step(dt, world, frozen);
    hitFlash.step(dt);
    passes.pickup.advance(dt);
    particles.step(dt);
    passes.boss.advance(dt, world.boss, enemyTimeScale(world.effects));
  }

  function freeRun(): void {
    baker.clear();
    particles.clear();
    passes.boss.reset();
    hitFlash.reset();
    passes.pickup.reset();
  }

  return {
    resize,
    setHudBounds(bounds) {
      hud.setBounds(bounds);
    },
    handle(events, world) {
      effects.handle(events, world);
      passes.boss.handle(events);
      passes.pickup.handle(events);
      // Before the forget below: a flash needs the rock's sprite, which `forget` frees.
      hitFlash.handle(events);
      for (const event of events) if (event.type === 'asteroidDestroyed' || event.type === 'asteroidLeft') baker.forget(event.id);
    },
    advance(dt, world, frozen) {
      stepBursts(dt, world, frozen);
      stars.step(dt, world.ship.vx, world.ship.vy);
    },
    settle(dt, world) {
      stepBursts(dt, world, true);
    },
    hasActiveParticles() {
      return particles.count > 0;
    },
    consumeRedrawRequest() {
      return backdrop.consumeRebaked();
    },
    setQuality,
    draw,
    reset: freeRun,
    setPalette,
    get palette() {
      return palette.id;
    },
    effects,
    get hudRects() {
      return hud.rects;
    },
    get drawCount() {
      return drawCount;
    },
    get visualScale() {
      return layout?.visual ?? UNIT_VISUAL;
    },
    dispose() {
      backdrop.dispose();
      freeRun();
    },
  };
}
