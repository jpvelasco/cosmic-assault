import {
  createAsteroid,
  practiceSettings,
  spawnPracticeAsteroid,
  splitAsteroid,
  stepAsteroid,
  type Asteroid,
  type AsteroidSize,
  type PracticeSettings,
} from './asteroid';
import { circlesOverlap, SpatialHash } from './collision';
import { ASTEROID, PLAYER, PROJECTILE } from './config';
import type { Controls } from './controls';
import type { SimEvent } from './events';
import { isPositiveFiniteSize, type Field } from './field';
import { projectileFromShot, stepProjectile, type Projectile } from './projectile';
import { createRng, deriveSeed, type Rng } from './rng';
import { createShip, respawnShip, stepShip, type Ship, type Shot } from './ship';

export type WorldStatus = 'playing' | 'gameOver';

export interface ShipPlacement {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface AsteroidPlacement {
  readonly x: number;
  readonly y: number;
  readonly size: AsteroidSize;
  readonly angle: number;
  readonly speedMultiplier: number;
}

export interface WorldOptions {
  readonly seed: number;
  readonly field: Field;
  /** Integer 1–7; defaults to 1. */
  readonly practiceLevel?: number;
  /** Starting pose instead of the field centre; the ship is still invulnerable for 3 s. */
  readonly initialShip?: ShipPlacement;
  /** Replaces the 3 practice spawns at the start of the run. */
  readonly initialAsteroids?: readonly AsteroidPlacement[];
}

export const MIN_PRACTICE_LEVEL = 1;
export const MAX_PRACTICE_LEVEL = 7;
const START_ASTEROIDS = 3;
export const UINT32_MAX = 0xffffffff;
/** Absorbs float residue from summing dt steps so the timer fires on the step its interval ends. */
const SPAWN_EPSILON = 1e-9;
const HASH_CELL_SIZE = ASTEROID.radii[0] * 2;
const ASTEROID_SIZES: readonly AsteroidSize[] = [0, 1, 2, 3];

/** World seeds are unsigned 32-bit integers. */
export function isWorldSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed <= UINT32_MAX;
}

function assertSeed(seed: number): void {
  if (!isWorldSeed(seed)) {
    throw new RangeError(
      `World needs an unsigned 32-bit integer seed (got ${String(seed)}); pass e.g. hashString(text) or value >>> 0`,
    );
  }
}

/** Practice levels are the integers 1–7. */
export function isPracticeLevel(level: number): boolean {
  return Number.isInteger(level) && level >= MIN_PRACTICE_LEVEL && level <= MAX_PRACTICE_LEVEL;
}

function assertPracticeLevel(level: number): void {
  if (!isPracticeLevel(level)) {
    throw new RangeError(
      `World practiceLevel must be an integer from ${String(MIN_PRACTICE_LEVEL)} to ${String(MAX_PRACTICE_LEVEL)} (got ${String(level)}); clamp or round it first`,
    );
  }
}

function assertField(field: Field): void {
  const { width, height } = field;
  if (!isPositiveFiniteSize(width, height)) {
    throw new RangeError(
      `World needs a field with positive finite width and height (got ${String(width)}×${String(height)}); build it with fieldForViewport()`,
    );
  }
}

function assertDt(dt: number): void {
  if (!(dt > 0 && Number.isFinite(dt))) {
    throw new RangeError(
      `World.step() needs a finite dt > 0 seconds (got ${String(dt)}); drive it from the fixed-step loop`,
    );
  }
}

function assertFinite(owner: string, values: Readonly<Record<string, number>>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `${owner}.${name} must be a finite number (got ${String(value)}); pass a real position, angle or multiplier`,
      );
    }
  }
}

function assertAsteroidPlacement(p: AsteroidPlacement, index: number): void {
  const owner = `WorldOptions.initialAsteroids[${String(index)}]`;
  assertFinite(owner, { x: p.x, y: p.y, angle: p.angle, speedMultiplier: p.speedMultiplier });
  if (!ASTEROID_SIZES.includes(p.size)) {
    throw new RangeError(`${owner}.size must be 0, 1, 2 or 3 (got ${String(p.size)}); 0 is large, 3 is tiny`);
  }
}

/** Keeps the items whose index is not flagged, in order, without allocating. */
function removeFlagged(items: unknown[], flagged: readonly boolean[]): void {
  let kept = 0;
  for (let i = 0; i < items.length; i++) {
    if (flagged[i] !== true) {
      items[kept++] = items[i];
    }
  }
  items.length = kept;
}

function resetFlags(flags: boolean[], length: number): void {
  flags.length = length;
  flags.fill(false);
}

/**
 * The deterministic game: same seed and same `step` inputs always give the same run.
 * Randomness comes from three streams derived from the seed:
 * - 'spawn': practice spawns and the rotation, spin and speed of `initialAsteroids`;
 * - 'split': the angles and speeds of split children;
 * - 'shape': asteroid outlines (vertex count and radii) on every creation path, so
 *   outline changes never shift gameplay draws.
 */
export class World {
  private readonly level: number;
  private readonly practice: PracticeSettings;
  private readonly spawnRng: Rng;
  private readonly splitRng: Rng;
  private readonly shapeRng: Rng;
  private currentField: Field;
  private readonly shipState: Ship;
  private readonly asteroidList: Asteroid[] = [];
  private readonly projectileList: Projectile[] = [];
  private readonly events: SimEvent[] = [];
  private readonly hash = new SpatialHash(HASH_CELL_SIZE);
  /** Asteroid indices broken this step, in the order they broke. */
  private readonly broken: number[] = [];
  private readonly brokenFlags: boolean[] = [];
  private readonly spentFlags: boolean[] = [];
  private readonly children: Asteroid[] = [];
  /** Live `SpawningSystem.reset()` zeroes the timer, so the first step spawns at once. */
  private spawnTimer = 0;
  private scoreValue = 0;
  private livesValue: number = PLAYER.startLives;
  private statusValue: WorldStatus = 'playing';
  private elapsedValue = 0;

  constructor(opts: WorldOptions) {
    assertSeed(opts.seed);
    assertField(opts.field);
    this.level = opts.practiceLevel ?? MIN_PRACTICE_LEVEL;
    assertPracticeLevel(this.level);
    this.practice = practiceSettings(this.level);
    this.currentField = opts.field;
    this.spawnRng = createRng(deriveSeed(opts.seed, 'spawn'));
    this.splitRng = createRng(deriveSeed(opts.seed, 'split'));
    this.shapeRng = createRng(deriveSeed(opts.seed, 'shape'));
    this.shipState = World.placeShip(opts.field, opts.initialShip);
    if (opts.initialAsteroids === undefined) {
      for (let i = 0; i < START_ASTEROIDS; i++) {
        this.spawnAsteroid(true);
      }
    } else {
      opts.initialAsteroids.forEach((a, i) => {
        assertAsteroidPlacement(a, i);
        this.asteroidList.push(
          createAsteroid(this.spawnRng, a.x, a.y, a.size, a.angle, a.speedMultiplier, this.shapeRng),
        );
      });
    }
  }

  /** Live view, mutated in place by `step()`; copy it if you keep it across steps. */
  get ship(): Readonly<Ship> {
    return this.shipState;
  }

  /** Live view, mutated in place by `step()`; copy it if you keep it across steps. */
  get asteroids(): readonly Readonly<Asteroid>[] {
    return this.asteroidList;
  }

  /** Live view, mutated in place by `step()`; copy it if you keep it across steps. */
  get projectiles(): readonly Readonly<Projectile>[] {
    return this.projectileList;
  }

  get score(): number {
    return this.scoreValue;
  }

  get lives(): number {
    return this.livesValue;
  }

  get status(): WorldStatus {
    return this.statusValue;
  }

  get elapsed(): number {
    return this.elapsedValue;
  }

  /** The level this run was created with (1–7). */
  get practiceLevel(): number {
    return this.level;
  }

  get field(): Field {
    return this.currentField;
  }

  /**
   * Advances the run by `dt` seconds. The returned array is reused: it is valid only
   * until the next `step`, so copy any events you need to keep.
   */
  step(dt: number, controls: Controls): readonly SimEvent[] {
    assertDt(dt);
    this.events.length = 0;
    if (this.statusValue === 'gameOver') {
      return this.events;
    }
    this.elapsedValue += dt;
    this.addProjectiles(stepShip(this.shipState, controls, dt, this.currentField));
    this.moveEntities(dt);
    this.prepareCollisions();
    const stillPlaying = this.collideShip();
    if (stillPlaying) {
      this.collideProjectiles();
    }
    this.breakAsteroids();
    if (stillPlaying) {
      this.spawnPractice(dt);
    }
    return this.events;
  }

  /** Keeps every entity where it is; nothing is clamped into the new field. */
  resize(field: Field): void {
    assertField(field);
    this.currentField = field;
  }

  /** Ends the run without emitting anything (used by "Quit"). */
  endRun(): void {
    this.statusValue = 'gameOver';
  }

  private static placeShip(field: Field, placement: ShipPlacement | undefined): Ship {
    if (placement === undefined) {
      return createShip(field.width / 2, field.height / 2);
    }
    assertFinite('WorldOptions.initialShip', { x: placement.x, y: placement.y, angle: placement.angle });
    const ship = createShip(placement.x, placement.y);
    ship.angle = placement.angle;
    return ship;
  }

  private addProjectiles(shots: readonly Shot[]): void {
    for (const shot of shots) {
      this.projectileList.push(projectileFromShot(shot));
      this.events.push({ type: 'shot', x: shot.x, y: shot.y });
    }
  }

  private moveEntities(dt: number): void {
    const field = this.currentField;
    const projectiles = this.projectileList;
    resetFlags(this.spentFlags, projectiles.length);
    for (let i = 0; i < projectiles.length; i++) {
      this.spentFlags[i] = !stepProjectile(projectiles[i] as Projectile, dt, field);
    }
    removeFlagged(projectiles, this.spentFlags);
    for (const a of this.asteroidList) {
      stepAsteroid(a, dt, field);
    }
  }

  private prepareCollisions(): void {
    const asteroids = this.asteroidList;
    this.hash.clear();
    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i] as Asteroid;
      this.hash.insert(i, a.x, a.y, a.radius);
    }
    resetFlags(this.brokenFlags, asteroids.length);
    resetFlags(this.spentFlags, this.projectileList.length);
    this.broken.length = 0;
  }

  /** Highest-indexed unbroken asteroid overlapping the circle, or -1. */
  private lastOverlap(x: number, y: number, radius: number): number {
    let last = -1;
    this.hash.forEachCandidate(x, y, radius, (i) => {
      const a = this.asteroidList[i] as Asteroid;
      if (i > last && this.brokenFlags[i] !== true && circlesOverlap(x, y, radius, a.x, a.y, a.radius)) {
        last = i;
      }
    });
    return last;
  }

  private markBroken(index: number): Asteroid {
    this.brokenFlags[index] = true;
    this.broken.push(index);
    return this.asteroidList[index] as Asteroid;
  }

  /** Live rule: one hit per step, on the last-indexed overlapping asteroid. Returns false once the run ends. */
  private collideShip(): boolean {
    const ship = this.shipState;
    if (ship.invulnerable) {
      return true;
    }
    const index = this.lastOverlap(ship.x, ship.y, PLAYER.radius);
    if (index < 0) {
      return true;
    }
    this.markBroken(index);
    this.livesValue -= 1;
    this.events.push({ type: 'shipHit', x: ship.x, y: ship.y, livesLeft: this.livesValue });
    if (this.livesValue <= 0) {
      this.statusValue = 'gameOver';
      this.events.push({ type: 'gameOver', score: this.scoreValue });
      return false;
    }
    respawnShip(ship, this.currentField);
    return true;
  }

  /** Each projectile breaks at most one asteroid and is removed once (fixes CA-021). */
  private collideProjectiles(): void {
    const projectiles = this.projectileList;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i] as Projectile;
      const index = this.lastOverlap(p.x, p.y, PROJECTILE.radius);
      if (index >= 0) {
        this.spentFlags[i] = true;
        const a = this.markBroken(index);
        const points = ASTEROID.scores[a.size];
        this.scoreValue += points;
        this.events.push({ type: 'asteroidDestroyed', x: a.x, y: a.y, size: a.size, points });
      }
    }
    removeFlagged(projectiles, this.spentFlags);
  }

  /** Removes broken asteroids and appends their children in break order, like the live splice-and-push. */
  private breakAsteroids(): void {
    for (const index of this.broken) {
      this.children.push(...splitAsteroid(this.splitRng, this.asteroidList[index] as Asteroid, this.shapeRng));
    }
    removeFlagged(this.asteroidList, this.brokenFlags);
    this.asteroidList.push(...this.children);
    this.children.length = 0;
  }

  /** Live `_updateAsteroidSpawning`: a timed spawn, then one top-up below the minimum. */
  private spawnPractice(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= SPAWN_EPSILON) {
      this.spawnAsteroid(false);
      this.spawnTimer = this.practice.spawnInterval;
    }
    if (this.asteroidList.length < this.practice.minAsteroids) {
      this.spawnAsteroid(true);
    }
  }

  private spawnAsteroid(awayFromShip: boolean): void {
    this.asteroidList.push(
      spawnPracticeAsteroid(this.spawnRng, this.level, this.currentField, this.shipState, awayFromShip, this.shapeRng),
    );
  }
}
