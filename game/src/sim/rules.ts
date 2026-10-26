import type { GalaxyDef } from '../content/types';
import { practiceSettings, spawnPracticeAsteroid, type Asteroid, type PracticeSettings } from './asteroid';
import type { SimEvent } from './events';
import type { Field } from './field';
import { TIME_EPSILON } from './math';
import type { Rng } from './rng';
import type { GalaxyMode } from './scoring';
import type { Ship } from './ship';

export const MIN_PRACTICE_LEVEL = 1;
export const MAX_PRACTICE_LEVEL = 7;
const START_ASTEROIDS = 3;

/** The ruleset a World runs: practice at a level, or a galaxy in Rank or Free play. */
export type RulesOption = { readonly kind: 'practice'; readonly level: number } | { readonly kind: 'galaxy'; readonly galaxy: GalaxyDef; readonly mode: GalaxyMode };

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

/** What a ruleset sees of, and may change in, the World that runs it. */
export interface Arena {
  /** The World's own list: a ruleset appends to it and may empty it. */
  readonly asteroids: Asteroid[];
  /** This step's events: a ruleset appends to them. */
  readonly events: SimEvent[];
  readonly ship: Readonly<Ship>;
  readonly shapeRng: Rng;
  field(): Field;
  elapsed(): number;
  score(): number;
  deaths(): number;
  /** Lives the ship has left, this one included. */
  lives(): number;
  nextId(): number;
  award(points: number): void;
  setStatus(status: 'warping' | 'cleared'): void;
}

/** A World's ruleset: what spawns, what a kill scores and when the run ends. */
export interface Spawner {
  /** Places the opening rocks of a run whose scenario places none. */
  open?(): void;
  /** Runs at the start of every step, once the clock has advanced and before anything moves or collides. */
  beginStep?(): void;
  /**
   * Runs right after the ship has moved, before rocks and shots do: the hazard path. A ruleset's external forces (a
   * gravity well's pull) nudge velocities here, and the entities it owns move, so `stepShip` is never altered.
   */
  moveOwn?(dt: number, ship: Ship): void;
  /** Runs every step once collisions are done, even on the step the run ends: housekeeping for what the collisions spent. */
  afterCollisions?(): void;
  /** Runs once a step, after collisions, while the ship still has lives. */
  step(dt: number): void;
  /** The points a kill worth `base` scores. */
  scoreKill(base: number): number;
  /** The ship has just lost a life. */
  shipLost?(): void;
  /** A shot has just broken `rock`, after the kill is scored. */
  rockKilled?(rock: Readonly<Asteroid>): void;
}

/** Today's practice: a timed spawn, a minimum on the field, rock sizes and speeds by level. */
export class PracticeSpawner implements Spawner {
  private readonly practice: PracticeSettings;
  /** Live `SpawningSystem.reset()` zeroes the timer, so the first step spawns at once. */
  private spawnTimer = 0;

  constructor(
    readonly level: number,
    private readonly spawnRng: Rng,
    private readonly arena: Arena,
  ) {
    assertPracticeLevel(level);
    this.practice = practiceSettings(level);
  }

  open(): void {
    for (let i = 0; i < START_ASTEROIDS; i++) {
      this.spawnAsteroid(true);
    }
  }

  /** Live `_updateAsteroidSpawning`: a timed spawn, then one top-up below the minimum. */
  step(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= TIME_EPSILON) {
      this.spawnAsteroid(false);
      this.spawnTimer = this.practice.spawnInterval;
    }
    if (this.arena.asteroids.length < this.practice.minAsteroids) {
      this.spawnAsteroid(true);
    }
  }

  scoreKill(base: number): number {
    return base;
  }

  private spawnAsteroid(awayFromShip: boolean): void {
    this.arena.asteroids.push(
      spawnPracticeAsteroid(
        this.spawnRng,
        this.level,
        this.arena.field(),
        this.arena.ship,
        awayFromShip,
        this.arena.shapeRng,
        this.arena.nextId(),
      ),
    );
  }
}
