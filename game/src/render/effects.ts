import { FOES, MINE } from '../content/foes';
import { WARP_RIFT } from '../content/hazards';
import type { FoeKind } from '../content/types';
import { ASTEROID, PICKUP } from '../sim/config';
import { isWarpClear, type SimEvent } from '../sim/events';
import { TAU } from '../sim/math';
import { createRng, type Rng } from '../sim/rng';
import type { World } from '../sim/world';
import { DRIFT, type Palette } from './palette';
import { DEFAULT_PARTICLE_CAPACITY, type EmitOptions, type ParticlePool } from './particles';
import { PICKUP_COLORS, SHIELD_RING_RADIUS } from './pickupArt';

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
  /** Bursts from now on take their colours from `palette`; bursts already flying keep theirs. */
  setPalette(palette: Palette): void;
  /** While true, flash stays 0; particles still emit. Turning it on clears the flash at once. Shake has its own gate. */
  reducedMotion: boolean;
  /** While false, shake stays 0; turning it off clears shake at once. The app sets it from `shakeEnabled(setting, reducedMotion)`. */
  shakeEnabled: boolean;
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
/** A shot hurting a boss or a foe without killing it. */
const HIT_BURST: Counts = { shards: 0, sparks: 6, rings: 0, smoke: 0, shake: 0, flash: 0 };
/** A shot glancing off a shielded boss core: a few sparks, no more. */
const DEFLECT_BURST: Counts = { shards: 0, sparks: 3, rings: 0, smoke: 0, shake: 0, flash: 0 };
/** A boss's part breaking bursts like a small rock. */
const PART_BREAK_BURST = ASTEROID_BURSTS[2];
/** About a boss part's size, for the spread of its burst. */
const PART_BURST_RADIUS = 16;
/** A boss's core laid bare: rings and a spray of sparks, a shake and a flash, so the opening is plain. */
const EXPOSED_BURST: Counts = { shards: 0, sparks: 18, rings: 2, smoke: 0, shake: 4, flash: 0.2 };
/** The core shielded again: one ring closing the opening. */
const SHIELDED_BURST: Counts = { shards: 0, sparks: 6, rings: 1, smoke: 0, shake: 0, flash: 0 };
/** A destroyed foe bursts like a rock of its weight: the splitter a medium one, a drone a small one (the sounds in sfx.ts match). */
const FOE_BURSTS: Readonly<Record<FoeKind, Counts>> = {
  splitter: ASTEROID_BURSTS[1],
  drone: ASTEROID_BURSTS[2],
  gunship: ASTEROID_BURSTS[1],
  mine: ASTEROID_BURSTS[2],
  phaser: ASTEROID_BURSTS[2],
  armoured: ASTEROID_BURSTS[1],
};
/** A mine going off: rings out to its blast reach, sparks and smoke, a shake and a flash in the hostile hue. */
const MINE_BLAST_BURST: Counts = { shards: 0, sparks: 22, rings: 2, smoke: 4, shake: 5, flash: 0.25 };
/** A blast going off: two rings out to its reach, sparks and a hard shake, in the ring colour. */
const BLAST_BURST: Counts = { shards: 0, sparks: 20, rings: 1, smoke: 0, shake: 8, flash: 0.25 };
/** An armoured rock turning a shot aside: more sparks than a boss's shield tick, so it reads on a phone. */
const FOE_DEFLECT_BURST: Counts = { shards: 0, sparks: 6, rings: 0, smoke: 0, shake: 0, flash: 0 };
/** A phaser blinking: a spray of sparks and a ring where it lands. */
const PHASER_BLINK_BURST: Counts = { shards: 0, sparks: 10, rings: 1, smoke: 0, shake: 0, flash: 0 };
/** A ship passing through a warp rift: a ring at the mouth and a spray of sparks; a rock or foe passing is only a few sparks. */
const RIFT_SHIP_BURST: Counts = { shards: 0, sparks: 12, rings: 1, smoke: 0, shake: 0, flash: 0.1 };
const RIFT_BODY_BURST: Counts = { shards: 0, sparks: 3, rings: 0, smoke: 0, shake: 0, flash: 0 };
/** The first ring of a burst is 1.6 times its origin's radius, so a blast's origin is its radius over this. */
const BLAST_RING_SCALE = 1.6;
/** A bolt leaving its muzzle: a couple of sparks. */
const MUZZLE_BURST: Counts = { shards: 0, sparks: 3, rings: 0, smoke: 0, shake: 0, flash: 0 };
/** A pickup dropping or being collected: a ring and a spray of sparks in its colour, no shake. */
const PICKUP_DROP_BURST: Counts = { shards: 0, sparks: 8, rings: 1, smoke: 0, shake: 0, flash: 0 };
const PICKUP_TAKE_BURST: Counts = { shards: 0, sparks: 12, rings: 1, smoke: 0, shake: 0, flash: 0 };
/** The Shield taking a hit for the ship: it shatters, with a little shake but none of a lost life's weight. */
const SHIELD_BREAK_BURST: Counts = { shards: 10, sparks: 14, rings: 1, smoke: 0, shake: 3, flash: 0 };
/** A rock the warp clears: a light puff, so a busy field does not go up in one frame of full blasts. */
const WARP_CLEAR_BURST: Counts = { shards: 2, sparks: 4, rings: 0, smoke: 0, shake: 0, flash: 0 };

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
      return writeBurst(into, isWarpClear(event) ? WARP_CLEAR_BURST : ASTEROID_BURSTS[event.size], palette.ring);
    case 'shipHit':
      return writeBurst(into, SHIP_HIT_BURST, HIT_TINT);
    case 'shot':
      return writeBurst(into, SHOT_BURST, palette.shot);
    case 'bossHit':
    case 'bossPartHit':
    case 'foeHit':
      return writeBurst(into, HIT_BURST, palette.shot);
    case 'bossDeflected':
      return writeBurst(into, DEFLECT_BURST, palette.spark);
    case 'foeDeflected':
      return writeBurst(into, FOE_DEFLECT_BURST, palette.spark);
    case 'phaserBlink':
      return writeBurst(into, PHASER_BLINK_BURST, palette.accent[0]);
    case 'riftJump':
      return writeBurst(into, event.ship ? RIFT_SHIP_BURST : RIFT_BODY_BURST, palette.accent[1]);
    case 'blast':
      return writeBurst(into, BLAST_BURST, palette.ring);
    case 'bossPartBroken':
      return writeBurst(into, PART_BREAK_BURST, palette.ring);
    case 'bossExposed':
      return writeBurst(into, EXPOSED_BURST, palette.accent[2]);
    case 'bossShielded':
      return writeBurst(into, SHIELDED_BURST, palette.ring);
    case 'foeDestroyed':
      return writeBurst(into, event.points === 0 ? WARP_CLEAR_BURST : FOE_BURSTS[event.kind], palette.ring);
    case 'pickupDropped':
      return writeBurst(into, PICKUP_DROP_BURST, palette.ring);
    case 'pickupCollected':
      return writeBurst(into, PICKUP_TAKE_BURST, palette.ring);
    case 'shieldBroken':
      return writeBurst(into, SHIELD_BREAK_BURST, palette.ring);
    case 'mineBlast':
      return writeBurst(into, MINE_BLAST_BURST, palette.hostile);
    case 'boltFired':
      return writeBurst(into, MUZZLE_BURST, palette.hostile);
    // The hangar's doors and the light inside are the drawer's to show. A gunship's aim, a mine's arming, a phaser's
    // warning, a zone, a rift's mouths and a repulsion field are the foe and hazard passes' to show.
    case 'foeWindup':
    case 'phaserWarn':
    case 'riftWarning':
    case 'riftOpen':
    case 'riftClose':
    case 'mineArmed':
    case 'zoneWarning':
    case 'zoneStart':
    case 'zoneEnd':
    case 'hangarOpen':
    case 'hangarClose':
    case 'gameOver':
    case 'asteroidLeft':
    case 'galaxyStart':
    case 'showerWarning':
    case 'showerStart':
    case 'showerEnd':
    case 'warpOut':
    case 'galaxyCleared':
    case 'combo':
    case 'bossIntro':
    case 'bossWindup':
    case 'bossPhase':
    case 'bossDown':
    case 'pickupExpired':
    case 'effectEnded':
    case 'foeSpawned':
    case 'wellWarning':
    case 'wellStart':
    case 'wellEnd':
      return null;
  }
}

interface Emitter {
  readonly pool: ParticlePool;
  readonly rng: Rng;
  palette: Palette;
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
  let flashColor: string = emitter.palette.ring;
  let reducedMotion = false;
  let shakeEnabled = true;
  let trailBudget = 0;

  const kick = (spec: BurstSpec): void => {
    if (shakeEnabled) shake = Math.min(MAX_SHAKE, Math.max(shake, spec.shake));
    if (!reducedMotion && spec.flash > 0 && spec.flash >= flash) {
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
      case 'bossHit':
      case 'bossPartHit':
      case 'bossDeflected':
      case 'foeHit':
        return writeOrigin(origin, event.x, event.y, 0, null);
      case 'bossPartBroken':
        return writeOrigin(origin, event.x, event.y, PART_BURST_RADIUS, null);
      case 'bossExposed':
      case 'bossShielded':
        return writeOrigin(origin, event.x, event.y, world.boss?.radius ?? PART_BURST_RADIUS, null);
      case 'foeDestroyed':
        return writeOrigin(origin, event.x, event.y, FOES[event.kind].radius, null);
      case 'pickupDropped':
        return writeOrigin(origin, event.x, event.y, PICKUP.radius, PICKUP_COLORS[event.kind]);
      case 'pickupCollected':
        return writeOrigin(origin, world.ship.x, world.ship.y, PICKUP.radius, PICKUP_COLORS[event.kind]);
      case 'shieldBroken':
        return writeOrigin(origin, world.ship.x, world.ship.y, SHIELD_RING_RADIUS, PICKUP_COLORS.shield);
      // Its rings reach out to the blast's edge.
      case 'mineBlast':
        return writeOrigin(origin, event.x, event.y, MINE.blastRadius / 2, emitter.palette.hostile);
      case 'boltFired':
        return writeOrigin(origin, event.x, event.y, 0, emitter.palette.hostile);
      // A blast's ring reaches its edge: a ring is drawn at 1.6 times the origin's radius.
      case 'blast':
        return writeOrigin(origin, event.x, event.y, event.radius / BLAST_RING_SCALE, emitter.palette.ring);
      case 'foeDeflected':
        return writeOrigin(origin, event.x, event.y, 0, null);
      case 'phaserBlink':
        return writeOrigin(origin, event.x, event.y, FOES.phaser.radius, emitter.palette.accent[0]);
      case 'riftJump':
        return writeOrigin(origin, event.x, event.y, WARP_RIFT.radius, emitter.palette.accent[1]);
      case 'foeWindup':
      case 'mineArmed':
      case 'zoneWarning':
      case 'zoneStart':
      case 'zoneEnd':
      case 'hangarOpen':
      case 'hangarClose':
      case 'gameOver':
      case 'asteroidLeft':
      case 'galaxyStart':
      case 'showerWarning':
      case 'showerStart':
      case 'showerEnd':
      case 'warpOut':
      case 'galaxyCleared':
      case 'combo':
      case 'bossIntro':
      case 'bossWindup':
      case 'bossPhase':
      case 'bossDown':
      case 'pickupExpired':
      case 'effectEnded':
      case 'foeSpawned':
      case 'wellWarning':
      case 'wellStart':
      case 'wellEnd':
      case 'phaserWarn':
      case 'riftWarning':
      case 'riftOpen':
      case 'riftClose':
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
        const burst = burstFor(event, emitter.palette, spec);
        const at = originFor(event, world);
        if (burst === null || at === null) continue;
        emitBurst(emitter, burst, at);
        kick(burst);
      }
    },
    setPalette(next) {
      emitter.palette = next;
      flashColor = next.ring;
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
      if (value) flash = 0;
    },
    get shakeEnabled() {
      return shakeEnabled;
    },
    set shakeEnabled(value: boolean) {
      shakeEnabled = value;
      if (!value) shake = 0;
    },
  };
}
