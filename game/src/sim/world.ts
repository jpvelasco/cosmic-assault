import type { TimedPickupId } from '../content/pickups';
import type { GalaxyDef, WeaponTier } from '../content/types';
import { createAsteroid, splitAsteroid, stepAsteroid, type Asteroid } from './asteroid';
import type { BossView } from './boss/bossRunner';
import { circlesOverlap, SpatialHash } from './collision';
import { ASTEROID, PLAYER, PROJECTILE } from './config';
import type { Controls } from './controls';
import type { SimEvent } from './events';
import type { Field } from './field';
import { GalaxyRun, galaxyStreams } from './galaxy/galaxyRun';
import type { Phase } from './galaxy/pacing';
import type { ShowerState } from './galaxy/showers';
import type { Foe } from './foes/foe';
import type { WellState } from './hazards/gravityWell';
import type { Pickup } from './pickups/pickups';
import { projectileFromShot, stepProjectile, type Projectile } from './projectile';
import { createRng, deriveSeed, type Rng } from './rng';
import { MIN_PRACTICE_LEVEL, PracticeSpawner, type Arena, type Spawner } from './rules';
import { makeInvulnerable, respawnShip, stepShip, type Ship, type Shot } from './ship';
import { removeFlagged, resetFlags } from './flagged';
import { rescale } from './wrap';
import { assertAsteroidPlacement, assertField, placeShip, resolveOptions, type WorldOptions } from './worldOptions';

export { isPracticeLevel, MAX_PRACTICE_LEVEL, MIN_PRACTICE_LEVEL, type RulesOption } from './rules';
export {
  isGalaxyStartLives,
  isStartLives,
  isWorldSeed,
  MAX_GALAXY_START_LIVES,
  UINT32_MAX,
  type AsteroidPlacement,
  type ShipPlacement,
  type WorldOptions,
} from './worldOptions';

/** `'warping'` ends a galaxy: 1.5 s, or 2 s while a beaten boss dies. Once `'cleared'` or `'gameOver'`, `step` is a no-op. */
export type WorldStatus = 'playing' | 'warping' | 'cleared' | 'gameOver';

/** Whether a run with `status` is over, cleared or lost: it no longer steps, and is drawn at its latest pose. */
export function hasEnded(status: WorldStatus): boolean {
  return status === 'cleared' || status === 'gameOver';
}

const HASH_CELL_SIZE = ASTEROID.radii[0] * 2;
const NO_EFFECTS: Readonly<Record<TimedPickupId, number>> = Object.freeze({ doubleShot: 0, rapidFire: 0, spreadLaser: 0, shield: 0 });
const NO_PICKUPS: readonly Pickup[] = Object.freeze([]);
const NO_FOES: readonly Foe[] = Object.freeze([]);

function assertDt(dt: number): void {
  if (!(dt > 0 && Number.isFinite(dt))) {
    throw new RangeError(
      `World.step() needs a finite dt > 0 seconds (got ${String(dt)}); drive it from the fixed-step loop`,
    );
  }
}

/**
 * The deterministic game: same seed and same `step` inputs always give the same run.
 * The rules decide what spawns and how a run ends: practice, or a timed galaxy.
 * Randomness comes from streams derived from the seed:
 * - 'spawn': practice spawns and the rotation, spin and speed of `initialAsteroids`;
 * - 'split': the angles and speeds of split children;
 * - 'shape': asteroid outlines (vertex count and radii) on every creation path, so
 *   outline changes never shift gameplay draws;
 * - 'director': a galaxy's spawns (what, when, and how many drones come as a group) and showers, so galaxy rules never shift the practice streams;
 * - 'boss': a boss fight's drift and attacks;
 * - 'pickups': whether a kill drops a pickup, and which;
 * - 'foes': foe behaviour once spawned: where they enter, how they head and where their fragments fly;
 * - 'hazards': where gravity wells sit.
 */
export class World {
  private readonly level: number;
  private readonly rules: Spawner;
  /** The same object as `rules` under galaxy rules, else null. */
  private readonly run: GalaxyRun | null = null;
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
  /** Last id handed out; asteroids and projectiles share it. Consumes no RNG. */
  private lastId = 0;
  private scoreValue = 0;
  private livesValue: number;
  private statusValue: WorldStatus = 'playing';
  private elapsedValue = 0;
  private deathsValue = 0;

  constructor(opts: WorldOptions) {
    const { rules, lives, startTier } = resolveOptions(opts);
    this.level = rules.kind === 'practice' ? rules.level : MIN_PRACTICE_LEVEL;
    this.livesValue = lives;
    this.currentField = opts.field;
    this.spawnRng = createRng(deriveSeed(opts.seed, 'spawn'));
    this.splitRng = createRng(deriveSeed(opts.seed, 'split'));
    this.shapeRng = createRng(deriveSeed(opts.seed, 'shape'));
    this.shipState = placeShip(opts.field, opts.initialShip);
    const arena = this.createArena();
    if (rules.kind === 'practice') {
      this.rules = new PracticeSpawner(rules.level, this.spawnRng, arena);
    } else {
      this.rules = this.run = new GalaxyRun(rules.galaxy, rules.mode, galaxyStreams(opts.seed), arena, startTier);
    }
    if (opts.initialAsteroids === undefined) {
      this.rules.open?.();
    } else {
      opts.initialAsteroids.forEach((a, i) => {
        assertAsteroidPlacement(a, i);
        this.asteroidList.push(
          createAsteroid(
            this.spawnRng,
            a.x,
            a.y,
            a.size,
            a.angle,
            a.speedMultiplier,
            this.shapeRng,
            this.nextId(),
          ),
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

  /** The practice level this run was created with (1–7). A galaxy run reports 1: tell one apart by `galaxy`, which the galaxy HUD reads instead. */
  get practiceLevel(): number {
    return this.level;
  }

  get field(): Field {
    return this.currentField;
  }

  /** Lives lost so far. */
  get deaths(): number {
    return this.deathsValue;
  }

  /** The galaxy being played, or null in practice. */
  get galaxy(): GalaxyDef | null {
    return this.run?.galaxy ?? null;
  }

  /** Seconds left on the galaxy timer (a boss galaxy's approach), or null in practice. */
  get timeLeft(): number | null {
    return this.run?.timeLeft ?? null;
  }

  get phase(): Phase | null {
    return this.run?.phase ?? null;
  }

  /** The boss of a boss galaxy once its approach is over, else null; a live view, updated in place. */
  get boss(): Readonly<BossView> | null {
    return this.run?.boss ?? null;
  }

  /** Kills chained inside the combo window; always 0 in practice. */
  get combo(): number {
    return this.run?.comboCount ?? 0;
  }

  /** What the next kill's points are multiplied by; always 1 in practice. */
  get multiplier(): number {
    return this.run?.multiplier ?? 1;
  }

  /** The weapon tier, 0–3; always 0 in practice. */
  get weaponTier(): WeaponTier {
    return this.run?.loadout.tier ?? 0;
  }

  /** Seconds left on each timed effect, 0 for one that is off; a live view, and all 0 in practice. */
  get effects(): Readonly<Record<TimedPickupId, number>> {
    return this.run?.loadout.effects ?? NO_EFFECTS;
  }

  /** Whether the Shield is up. */
  get shield(): boolean {
    return this.run?.loadout.shielded === true;
  }

  /** The pickups on the field; a live view, and always empty in practice. */
  get pickups(): readonly Readonly<Pickup>[] {
    return this.run?.pickups ?? NO_PICKUPS;
  }

  /** The foes on the field; a live view, and always empty in practice. */
  get foes(): readonly Readonly<Foe>[] {
    return this.run?.foeList ?? NO_FOES;
  }

  /** The gravity well being telegraphed or pulling; null when there is none, and always in practice. */
  get well(): Readonly<WellState> | null {
    return this.run?.well ?? null;
  }

  /** The meteor shower being telegraphed or falling, for the HUD warning; a live view. */
  get shower(): ShowerState | null {
    return this.run?.shower ?? null;
  }

  /**
   * Advances the run by `dt` seconds. The returned array is reused: it is valid only
   * until the next `step`, so copy any events you need to keep.
   *
   * Once `status` is `'gameOver'` or `'cleared'`, `step` is a no-op and previous poses are not refreshed — draw at alpha = 1.
   */
  step(dt: number, controls: Controls): readonly SimEvent[] {
    assertDt(dt);
    this.events.length = 0;
    if (hasEnded(this.statusValue)) {
      return this.events;
    }
    this.rememberPoses();
    this.elapsedValue += dt;
    this.rules.beginStep?.();
    this.addProjectiles(stepShip(this.shipState, controls, dt, this.currentField, this.run?.loadout.weapon));
    this.rules.moveOwn?.(dt, this.shipState);
    this.moveEntities(dt);
    this.prepareCollisions();
    const stillPlaying = this.collideShip();
    if (stillPlaying) {
      this.collideProjectiles();
    }
    this.breakAsteroids();
    this.rules.afterCollisions?.();
    if (stillPlaying) {
      this.rules.step(dt);
    }
    return this.events;
  }

  /**
   * Stretches the layout to the new field: every entity keeps its fraction of the wrap band
   * (the field plus the wrap margin on each side), so nothing leaves it or jumps across.
   */
  resize(field: Field): void {
    assertField(field);
    const old = this.currentField;
    this.currentField = field;
    for (const e of [this.shipState, ...this.asteroidList, ...this.projectileList]) {
      e.x = rescale(e.x, old.width, field.width);
      e.y = rescale(e.y, old.height, field.height);
      e.px = rescale(e.px, old.width, field.width);
      e.py = rescale(e.py, old.height, field.height);
    }
    this.run?.resize(old, field);
  }

  /** Ends the run without emitting anything (used by "Quit"). */
  endRun(): void {
    this.statusValue = 'gameOver';
  }

  private nextId(): number {
    return ++this.lastId;
  }

  /** The rules' window onto this World. */
  private createArena(): Arena {
    return {
      asteroids: this.asteroidList,
      events: this.events,
      ship: this.shipState,
      shapeRng: this.shapeRng,
      field: () => this.currentField,
      elapsed: () => this.elapsedValue,
      score: () => this.scoreValue,
      deaths: () => this.deathsValue,
      lives: () => this.livesValue,
      nextId: () => this.nextId(),
      award: (points) => {
        this.scoreValue += points;
      },
      setStatus: (status) => {
        this.statusValue = status;
      },
    };
  }

  /** Stores every entity's pose before anything moves, so the renderer can interpolate from it. */
  private rememberPoses(): void {
    const ship = this.shipState;
    ship.px = ship.x;
    ship.py = ship.y;
    ship.pangle = ship.angle;
    for (const a of this.asteroidList) {
      a.px = a.x;
      a.py = a.y;
      a.protation = a.rotation;
    }
    for (const p of this.projectileList) {
      p.px = p.x;
      p.py = p.y;
    }
  }

  private addProjectiles(shots: readonly Shot[]): void {
    for (const shot of shots) {
      this.projectileList.push(projectileFromShot(shot, this.nextId()));
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

  /** Live rule: one hit per step, on the last-indexed overlapping asteroid, else a foe, else a fighting boss' core. Returns false once the run ends. */
  private collideShip(): boolean {
    const ship = this.shipState;
    if (ship.invulnerable || this.statusValue === 'warping') {
      return true;
    }
    const index = this.lastOverlap(ship.x, ship.y, PLAYER.radius);
    if (index >= 0) {
      this.markBroken(index);
    } else if (this.run?.shipStruck(ship.x, ship.y, PLAYER.radius) !== true) {
      return true;
    }
    if (this.run?.absorbHit() === true) {
      makeInvulnerable(ship);
      return true;
    }
    this.livesValue -= 1;
    this.deathsValue += 1;
    this.rules.shipLost?.();
    this.events.push({ type: 'shipHit', x: ship.x, y: ship.y, livesLeft: this.livesValue });
    if (this.livesValue <= 0) {
      this.statusValue = 'gameOver';
      this.events.push({ type: 'gameOver', score: this.scoreValue });
      return false;
    }
    respawnShip(ship, this.currentField);
    return true;
  }

  /** Each projectile breaks at most one asteroid, or is spent on a boss' core or a foe, and is removed once (fixes CA-021). */
  private collideProjectiles(): void {
    const projectiles = this.projectileList;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i] as Projectile;
      if (this.run?.hitBoss(p.x, p.y, PROJECTILE.radius) === true || this.run?.hitFoe(p.x, p.y, PROJECTILE.radius) === true) {
        this.spentFlags[i] = true;
        continue;
      }
      const index = this.lastOverlap(p.x, p.y, PROJECTILE.radius);
      if (index >= 0) {
        this.spentFlags[i] = true;
        const a = this.markBroken(index);
        const points = this.rules.scoreKill(ASTEROID.scores[a.size]);
        this.scoreValue += points;
        this.events.push({ type: 'asteroidDestroyed', id: a.id, x: a.x, y: a.y, size: a.size, points });
        this.rules.rockKilled?.(a);
      }
    }
    removeFlagged(projectiles, this.spentFlags);
  }

  /** Removes broken asteroids and appends their children in break order, like the live splice-and-push. */
  private breakAsteroids(): void {
    for (const index of this.broken) {
      const parent = this.asteroidList[index] as Asteroid;
      this.children.push(...splitAsteroid(this.splitRng, parent, this.shapeRng, () => this.nextId()));
    }
    removeFlagged(this.asteroidList, this.brokenFlags);
    this.asteroidList.push(...this.children);
    this.children.length = 0;
  }
}
