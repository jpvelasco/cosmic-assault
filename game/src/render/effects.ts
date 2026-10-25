import { ASTEROID } from '../sim/config';
import type { SimEvent } from '../sim/events';
import { createRng, type Rng } from '../sim/rng';
import type { World } from '../sim/world';
import { DRIFT, type Palette } from './palette';
import type { ParticlePool } from './particles';

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
  /** Advances shake, flash and the thruster trail by `dt` seconds. */
  step(dt: number, world: World): void;
  readonly shakeX: number;
  readonly shakeY: number;
  readonly flash: number;
  readonly flashColor: string;
  /** While true, shake and flash stay 0; particles still emit. Turning it on clears them at once. */
  reducedMotion: boolean;
}

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
/** A pool at least this big gets the full trail rate; smaller ones get proportionally less. */
const TRAIL_FULL_RATE_CAPACITY = 512;
const TRAIL_OFFSET = 12;
const RING_STAGGER_SECONDS = 0.12;

type Counts = Omit<BurstSpec, 'flashColor'>;

/** Asteroid bursts by size, big to tiny. */
const ASTEROID_BURSTS: readonly [Counts, Counts, Counts, Counts] = [
  { shards: 12, sparks: 18, rings: 1, smoke: 6, shake: 5, flash: 0.3 },
  { shards: 9, sparks: 14, rings: 1, smoke: 4, shake: 3.5, flash: 0.2 },
  { shards: 7, sparks: 10, rings: 1, smoke: 2, shake: 2, flash: 0 },
  { shards: 5, sparks: 8, rings: 1, smoke: 0, shake: 1.2, flash: 0 },
];

const NO_BURST_COUNTS: Counts = { shards: 0, sparks: 0, rings: 0, smoke: 0, shake: 0, flash: 0 };

/** The pure event-to-burst table. `null` means the event is silent. */
export function burstFor(event: SimEvent, palette: Palette): BurstSpec | null {
  switch (event.type) {
    case 'asteroidDestroyed':
      return { ...ASTEROID_BURSTS[event.size], flashColor: palette.ring };
    case 'shipHit':
      return { shards: 16, sparks: 24, rings: 2, smoke: 8, shake: 7, flash: 0.45, flashColor: HIT_TINT };
    case 'shot':
      return { ...NO_BURST_COUNTS, sparks: 1, flashColor: palette.shot };
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

function emitBurst({ pool, rng, palette }: Emitter, spec: BurstSpec, at: Origin): void {
  const shardColor = at.tint ?? palette.rock[0];
  const sparkColor = at.tint ?? palette.spark;
  const ringColor = at.tint ?? palette.ring;
  const direction = (): readonly [number, number] => {
    const a = rng.range(0, Math.PI * 2);
    return [Math.cos(a), Math.sin(a)];
  };
  const scatter = (): number => rng.range(0, at.radius * 0.4);
  for (let i = 0; i < spec.shards; i++) {
    const [dx, dy] = direction();
    const speed = rng.range(60, 220);
    const s = scatter();
    pool.emit('shard', at.x + dx * s, at.y + dy * s, dx * speed + at.vx, dy * speed + at.vy, rng.range(0.6, 1.1), rng.range(2, 5), shardColor, {
      drag: 0.3,
      spin: rng.range(-8, 8),
      rot: rng.range(0, Math.PI * 2),
    });
  }
  for (let i = 0; i < spec.sparks; i++) {
    const [dx, dy] = direction();
    const speed = rng.range(80, 320);
    pool.emit('spark', at.x, at.y, dx * speed + at.vx, dy * speed + at.vy, rng.range(0.3, 0.7), rng.range(1.5, 3), sparkColor, { drag: 0.1 });
  }
  for (let i = 0; i < spec.smoke; i++) {
    const [dx, dy] = direction();
    const speed = rng.range(10, 50);
    const s = scatter();
    pool.emit('smoke', at.x + dx * s, at.y + dy * s, dx * speed + at.vx, dy * speed + at.vy, rng.range(0.9, 1.5), rng.range(6, 12), SMOKE_COLOR, {
      drag: 0.4,
    });
  }
  for (let i = 0; i < spec.rings; i++) {
    pool.emit('ring', at.x, at.y, 0, 0, 0.5, at.radius * (1.6 + i * 0.5), ringColor, { delay: i * RING_STAGGER_SECONDS });
  }
}

/**
 * Render-side "juice". It draws randomness from its own `createRng(seed)`, never the sim's streams,
 * so the same events and seed always look the same without touching gameplay.
 */
export function createEffects(pool: ParticlePool, seed: number, palette: Palette = DRIFT): Effects {
  const emitter: Emitter = { pool, rng: createRng(seed), palette };
  const { rng } = emitter;
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

  const originFor = (event: SimEvent, world: World): Origin | null => {
    switch (event.type) {
      case 'asteroidDestroyed':
        return { x: event.x, y: event.y, radius: ASTEROID.radii[event.size], tint: null, vx: 0, vy: 0 };
      case 'shipHit':
        return { x: event.x, y: event.y, radius: 30, tint: HIT_TINT, vx: 0, vy: 0 };
      case 'shot':
        return { x: event.x, y: event.y, radius: 0, tint: null, vx: world.ship.vx * 0.5, vy: world.ship.vy * 0.5 };
      case 'gameOver':
        return null;
    }
  };

  const emitTrail = (world: World, dt: number): void => {
    const { ship } = world;
    if (!ship.thrusting || world.status !== 'playing') {
      trailBudget = 0;
      return;
    }
    trailBudget += dt * TRAIL_PER_SECOND * Math.min(1, pool.capacity / TRAIL_FULL_RATE_CAPACITY);
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
        { drag: 0.2 },
      );
    }
  };

  return {
    handle(events, world) {
      for (const event of events) {
        const spec = burstFor(event, palette);
        const origin = originFor(event, world);
        if (spec === null || origin === null) continue;
        emitBurst(emitter, spec, origin);
        kick(spec);
      }
    },
    step(dt, world) {
      time += dt;
      shake *= SHAKE_DECAY ** dt;
      if (shake < SHAKE_REST) shake = 0;
      flash = Math.max(0, flash - dt * FLASH_DECAY_PER_SECOND);
      emitTrail(world, dt);
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
