import { rockSpeedMultiplier } from '../../content/curves';
import { tierOf } from '../../content/galaxies';
import type { GalaxyDef, RockKind } from '../../content/types';
import { aimFromEdge, hasLeftField, launchFromEdge, type Asteroid, type AsteroidSize, type Edge, type EdgeAim } from '../asteroid';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Arena, Spawner } from '../rules';
import { clearReport, Combo, type GalaxyMode } from '../scoring';
import { GalaxyDirector, SIZE_COST } from './director';
import { phaseAt, type Phase } from './pacing';
import { Showers, type ShowerState } from './showers';

const WARP_SECONDS = 1.5;
const MERCY_SECONDS = 4;
const MERCY = 0.4;
const KIND_SIZE: Readonly<Record<RockKind, AsteroidSize>> = { large: 0, medium: 1, small: 2 };
/** Meteors are tiny: fast, and they do not split. */
const SHOWER_SIZE: AsteroidSize = 3;

const areaOf = (field: Field): number => field.width * field.height;

/**
 * A timed galaxy: it opens on an empty field, the director meters rocks into it and showers fall on
 * schedule. When the timer runs out the ship warps out, clearing the field, and the galaxy is cleared 1.5 s later.
 */
export class GalaxyRun implements Spawner {
  private readonly director: GalaxyDirector;
  private readonly showers: Showers;
  private readonly combo = new Combo();
  private readonly rockSpeed: number;
  private shownMultiplier = 1;
  private started = false;
  private warpEndsAt: number | null = null;
  private mercyUntil = 0;
  /** Refilled every step, so the director's input costs no allocation. */
  private readonly context = { elapsed: 0, onFieldCost: 0, mercy: 1 };

  constructor(
    readonly galaxy: GalaxyDef,
    private readonly mode: GalaxyMode,
    /** The 'director' stream: kinds, spawn points and showers, so practice streams never shift. */
    private readonly rng: Rng,
    private readonly arena: Arena,
  ) {
    this.director = new GalaxyDirector(galaxy, rng, areaOf(arena.field()));
    this.showers = new Showers(galaxy.events, rng);
    this.rockSpeed = rockSpeedMultiplier(tierOf(galaxy));
  }

  get phase(): Phase {
    return phaseAt(this.galaxy, this.arena.elapsed());
  }

  /** Seconds left on the galaxy timer (for a boss galaxy, its approach). */
  get timeLeft(): number {
    return Math.max(0, this.galaxy.duration - this.arena.elapsed());
  }

  get comboCount(): number {
    return this.combo.count;
  }

  get multiplier(): number {
    return this.combo.multiplier;
  }

  get shower(): ShowerState | null {
    return this.showers.state;
  }

  resize(field: Field): void {
    this.director.fieldArea = areaOf(field);
  }

  /** Announces the galaxy on its first step, and warps out on the step its timer runs out, before anything collides. */
  beginStep(): void {
    if (!this.started) {
      this.started = true;
      this.arena.events.push({ type: 'galaxyStart', id: this.galaxy.id });
    }
    const elapsed = this.arena.elapsed();
    if (this.warpEndsAt === null && phaseAt(this.galaxy, elapsed) === 'warp') this.warpOut(elapsed);
  }

  step(dt: number): void {
    const elapsed = this.arena.elapsed();
    if (this.warpEndsAt !== null) {
      if (elapsed + TIME_EPSILON >= this.warpEndsAt) this.finish();
      return;
    }
    this.combo.expire(elapsed);
    this.announceCombo();
    this.spawn(dt, elapsed);
  }

  scoreKill(base: number): number {
    const multiplier = this.combo.kill(this.arena.elapsed());
    this.announceCombo();
    return base * multiplier;
  }

  shipLost(): void {
    this.combo.reset();
    this.announceCombo();
    this.mercyUntil = this.arena.elapsed() + MERCY_SECONDS;
  }

  private spawn(dt: number, elapsed: number): void {
    const field = this.arena.field();
    const meteors = this.showers.step(elapsed, dt, areaOf(field), this.sweepField(), this.arena.events);
    const edge = this.showers.state?.edge;
    if (edge !== undefined) this.dropMeteors(meteors, edge, field);
    this.context.elapsed = elapsed;
    this.context.mercy = elapsed < this.mercyUntil ? MERCY : 1;
    const order = this.director.step(dt, this.context);
    if (order !== null) this.addRock(aimFromEdge(this.rng, field, null, this.arena.ship), KIND_SIZE[order.kind], order.speedMultiplier);
  }

  /** Meteors enter from the shower's edge and pass through: they never wrap. They count toward the field cost. */
  private dropMeteors(count: number, edge: Edge, field: Field): void {
    for (let i = 0; i < count; i++) {
      this.addRock(aimFromEdge(this.rng, field, edge, null), SHOWER_SIZE, this.rockSpeed).transient = true;
      this.context.onFieldCost += SIZE_COST[SHOWER_SIZE];
    }
  }

  private addRock(aim: EdgeAim, size: AsteroidSize, speedMultiplier: number): Asteroid {
    const { arena } = this;
    const rock = launchFromEdge(this.rng, aim, size, speedMultiplier, arena.shapeRng, arena.nextId());
    arena.asteroids.push(rock);
    return rock;
  }

  /**
   * Removes the meteors that have passed out of the field, totting up the field's cost into the
   * director's context as it goes. Returns how many meteors are still on the field.
   */
  private sweepField(): number {
    const { asteroids, events } = this.arena;
    const field = this.arena.field();
    let kept = 0;
    let cost = 0;
    let meteors = 0;
    for (const a of asteroids) {
      if (a.transient === true) {
        if (hasLeftField(a, field)) {
          events.push({ type: 'asteroidLeft', id: a.id });
          continue;
        }
        meteors++;
      }
      cost += SIZE_COST[a.size];
      asteroids[kept++] = a;
    }
    asteroids.length = kept;
    this.context.onFieldCost = cost;
    return meteors;
  }

  /** Pushes a `combo` event when the multiplier has changed since the last one. */
  private announceCombo(): void {
    const { multiplier } = this.combo;
    if (multiplier === this.shownMultiplier) return;
    this.shownMultiplier = multiplier;
    this.arena.events.push({ type: 'combo', multiplier });
  }

  /** Clears every rock for 0 points; the ship cannot be hit until the galaxy is cleared. */
  private warpOut(elapsed: number): void {
    const { asteroids, events } = this.arena;
    events.push({ type: 'warpOut' });
    for (const a of asteroids) events.push({ type: 'asteroidDestroyed', id: a.id, x: a.x, y: a.y, size: a.size, points: 0 });
    asteroids.length = 0;
    this.showers.stop();
    this.warpEndsAt = elapsed + WARP_SECONDS;
    this.arena.setStatus('warping');
  }

  private finish(): void {
    const { arena } = this;
    const report = clearReport({ score: arena.score(), deaths: arena.deaths(), dimension: this.galaxy.dimension, mode: this.mode });
    arena.award(report.score - arena.score());
    arena.setStatus('cleared');
    arena.events.push({ type: 'galaxyCleared', ...report });
  }
}
