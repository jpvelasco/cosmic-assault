import { ASTEROID } from '../sim/config';
import type { SimEvent } from '../sim/events';
import { createRng, type Rng } from '../sim/rng';
import type { World } from '../sim/world';
import { DRIFT, type Palette } from './palette';
import { DEFAULT_PARTICLE_CAPACITY, type EmitOptions, type ParticlePool } from './particles';

export interface BurstSpec {
  readonly shards: number;
  readonly sparks: number;
  readonly rings: number;
  readonly smoke: number;
  readonly shake: number;
  readonly flash: number;
  readonly flashColor: string;
}

export interface Effects {
  /** Turns simulation events into particles, shake and flash. Reads the world, never writes it. */
  handle(events: readonly SimEvent[], world: World): void;
  /**
   * Advances shake, flash and the thruster trail by `dt` seconds. While `frozen` (hit-stop) the ship
   * stands still, so it trails nothing.
   */
  step(dt: number, world: World, frozen?: boolean): void;
  readonly shakeX: number;
  readonly shakeY: number;
  readonly flash: number;
  readonly flashColor: string;
  /** While true, shake and flash stay 0; particles still emit. Turning it on clears them at once. */
  reducedMotion: boolean;
}

const TAU = Math.PI * 2;
const HIT_TINT = '#ff5a5a';
const SMOKE_COLOR = '#5a5550';
const FLAME_COLORS = ['#ffb347', '#ff6a3c'] as const;

const MAX_SHAKE = 18;
/** Fraction of shake left after one second. */
const SHAKE_DECAY = 0.002;
/** Below this (field units) the shake snaps to rest. */
const SHAKE_REST = 0.01;
const SHAKE_FREQ_X = 63;
const SHAKE_FREQ_Y = 49;
const FLASH_DECAY_PER_SECOND = 3;

const TRAIL_PER_SECOND = 60;
const TRAIL_OFFSET = 12;
const RING_STAGGER_SECONDS = 0.12;

type Counts = Omit<BurstSpec, 'flashColor'>;
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Asteroid bursts by size, big to tiny. */
const ASTEROID_BURSTS: readonly [Counts, Counts, Counts, Counts] = [
  { shards: 12, sparks: 18, rings: 1, smoke: 6, shake: 5, flash: 0.3 },
  { shards: 9, sparks: 14, rings: 1, smoke: 4, shake: 3.5, flash: 0.2 },
  { shards: 7, sparks: 10, rings: 1, smoke: 2, shake: 2, flash: 0 },
  { shards: 5, sparks: 8, rings: 1, smoke: 0, shake: 1.2, flash: 0 },
];

const SHIP_HIT_BURST: Counts = { shards: 16, sparks: 24, rings: 2, smoke: 8, shake: 7, flash: 0.45 };
const SHOT_BURST: Counts = { shards: 0, sparks: 1, rings: 0, smoke: 0, shake: 0, flash: 0 };

const blankBurst = (): Writable<BurstSpec> => ({ ...SHOT_BURST, flashColor: '' });

function writeBurst(into: Writable<BurstSpec>, counts: Counts, flashColor: string): BurstSpec {
  Object.assign(into, counts);
  into.flashColor = flashColor;
  return into;
}

/**
 * The pure event-to-burst table, written into `into` so a caller can reuse one spec for every event.
 * `null` means the event is silent.
 */
export function burstFor(event: SimEvent, palette: Palette, into = blankBurst()): BurstSpec | null {
  switch (event.type) {
    case 'asteroidDestroyed':
      return writeBurst(into, ASTEROID_BURSTS[event.size], palette.ring);
    case 'shipHit':
      return writeBurst(into, SHIP_HIT_BURST, HIT_TINT);
    case 'shot':
      return writeBurst(into, SHOT_BURST, palette.shot);
    case 'gameOver':
      return null;
  }
}

interface Emitter {
  readonly pool: ParticlePool;
  readonly rng: Rng;
  readonly palette: Palette;
}

interface Origin {
  readonly x: number;
  readonly y: number;
  /** Rough size of the thing that burst, in field px. */
  readonly radius: number;
  readonly tint: string | null;
  /** Velocity the burst inherits. */
  readonly vx: number;
  readonly vy: number;
}

// Emit options and a heading, reused across particles: the pool reads options during emit() and keeps none.
const shardOptions = { drag: 0.3, spin: 0, rot: 0 };
const SPARK_OPTIONS: EmitOptions = { drag: 0.1 };
const SMOKE_OPTIONS: EmitOptions = { drag: 0.4 };
const TRAIL_OPTIONS: EmitOptions = { drag: 0.2 };
const ringOptions = { delay: 0 };
const heading = { x: 0, y: 0 };

/** Points `heading` in a random direction. */
function aimRandomly(rng: Rng): void {
  const a = rng.range(0, TAU);
  heading.x = Math.cos(a);
  heading.y = Math.sin(a);
}

function emitBurst({ pool, rng, palette }: Emitter, spec: BurstSpec, at: Origin): void {
  const shardColor = at.tint ?? palette.rock[0];
  const sparkColor = at.tint ?? palette.spark;
  const ringColor = at.tint ?? palette.ring;
  const scatterReach = at.radius * 0.4;
  for (let i = 0; i < spec.shards; i++) {
    aimRandomly(rng);
    const { x: dx, y: dy } = heading;
    const speed = rng.range(60, 220);
    const s = rng.range(0, scatterReach);
    const life = rng.range(0.6, 1.1);
    const size = rng.range(2, 5);
    shardOptions.spin = rng.range(-8, 8);
    shardOptions.rot = rng.range(0, TAU);
    pool.emit('shard', at.x + dx * s, at.y + dy * s, dx * speed + at.vx, dy * speed + at.vy, life, size, shardColor, shardOptions);
  }
  for (let i = 0; i < spec.sparks; i++) {
    aimRandomly(rng);
    const speed = rng.range(80, 320);
    pool.emit('spark', at.x, at.y, heading.x * speed + at.vx, heading.y * speed + at.vy, rng.range(0.3, 0.7), rng.range(1.5, 3), sparkColor, SPARK_OPTIONS);
  }
  for (let i = 0; i < spec.smoke; i++) {
    aimRandomly(rng);
    const { x: dx, y: dy } = heading;
    const speed = rng.range(10, 50);
    const s = rng.range(0, scatterReach);
    pool.emit('smoke', at.x + dx * s, at.y + dy * s, dx * speed + at.vx, dy * speed + at.vy, rng.range(0.9, 1.5), rng.range(6, 12), SMOKE_COLOR, SMOKE_OPTIONS);
  }
  for (let i = 0; i < spec.rings; i++) {
    ringOptions.delay = i * RING_STAGGER_SECONDS;
    pool.emit('ring', at.x, at.y, 0, 0, 0.5, at.radius * (1.6 + i * 0.5), ringColor, ringOptions);
  }
}

function writeOrigin(into: Writable<Origin>, x: number, y: number, radius: number, tint: string | null, vx = 0, vy = 0): Origin {
  into.x = x;
  into.y = y;
  into.radius = radius;
  into.tint = tint;
  into.vx = vx;
  into.vy = vy;
  return into;
}

/**
 * Render-side "juice". It draws randomness from its own `createRng(seed)`, never the sim's streams,
 * so the same events and seed always look the same without touching gameplay.
 */
export function createEffects(pool: ParticlePool, seed: number, palette: Palette = DRIFT): Effects {
  const emitter: Emitter = { pool, rng: createRng(seed), palette };
  const { rng } = emitter;
  const spec = blankBurst();
  const origin: Writable<Origin> = { x: 0, y: 0, radius: 0, tint: null, vx: 0, vy: 0 };
  let time = 0;
  let shake = 0;
  let flash = 0;
  let flashColor: string = palette.ring;
  let reducedMotion = false;
  let trailBudget = 0;

  const kick = (spec: BurstSpec): void => {
    if (reducedMotion) return;
    shake = Math.min(MAX_SHAKE, Math.max(shake, spec.shake));
    if (spec.flash > 0 && spec.flash >= flash) {
      flash = spec.flash;
      flashColor = spec.flashColor;
    }
  };

  /** Writes where `event`'s burst starts into the shared origin; null for a silent event. */
  const originFor = (event: SimEvent, world: World): Origin | null => {
    switch (event.type) {
      case 'asteroidDestroyed':
        return writeOrigin(origin, event.x, event.y, ASTEROID.radii[event.size], null);
      case 'shipHit':
        return writeOrigin(origin, event.x, event.y, 30, HIT_TINT);
      case 'shot':
        return writeOrigin(origin, event.x, event.y, 0, null, world.ship.vx * 0.5, world.ship.vy * 0.5);
      case 'gameOver':
        return null;
    }
  };

  const emitTrail = (world: World, dt: number, frozen: boolean): void => {
    const { ship } = world;
    if (frozen || !ship.thrusting || world.status !== 'playing') {
      trailBudget = 0;
      return;
    }
    // A pool smaller than the default gets a proportionally thinner trail.
    trailBudget += dt * TRAIL_PER_SECOND * Math.min(1, pool.capacity / DEFAULT_PARTICLE_CAPACITY);
    const dx = -Math.cos(ship.angle);
    const dy = -Math.sin(ship.angle);
    for (; trailBudget >= 1; trailBudget--) {
      const speed = rng.range(40, 110);
      const flame = rng.pick(FLAME_COLORS);
      pool.emit(
        rng.chance(0.5) ? 'glow' : 'spark',
        ship.x + dx * TRAIL_OFFSET + rng.range(-2, 2),
        ship.y + dy * TRAIL_OFFSET + rng.range(-2, 2),
        dx * speed + ship.vx * 0.3 + rng.range(-15, 15),
        dy * speed + ship.vy * 0.3 + rng.range(-15, 15),
        rng.range(0.3, 0.5),
        rng.range(3, 5),
        flame,
        TRAIL_OPTIONS,
      );
    }
  };

  return {
    handle(events, world) {
      for (const event of events) {
        const burst = burstFor(event, palette, spec);
        const at = originFor(event, world);
        if (burst === null || at === null) continue;
        emitBurst(emitter, burst, at);
        kick(burst);
      }
    },
    step(dt, world, frozen = false) {
      time += dt;
      shake *= SHAKE_DECAY ** dt;
      if (shake < SHAKE_REST) shake = 0;
      flash = Math.max(0, flash - dt * FLASH_DECAY_PER_SECOND);
      emitTrail(world, dt, frozen);
    },
    // At rest these are exactly 0, never -0, so the renderer's transform stays on whole pixels.
    get shakeX() {
      return shake === 0 ? 0 : Math.sin(time * SHAKE_FREQ_X) * shake;
    },
    get shakeY() {
      return shake === 0 ? 0 : Math.cos(time * SHAKE_FREQ_Y) * shake;
    },
    get flash() {
      return flash;
    },
    get flashColor() {
      return flashColor;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    set reducedMotion(value: boolean) {
      reducedMotion = value;
      if (value) {
        shake = 0;
        flash = 0;
      }
    },
  };
}
