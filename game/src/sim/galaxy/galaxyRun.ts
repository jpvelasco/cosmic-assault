import { rockSpeedMultiplier } from '../../content/curves';
import { tierOf } from '../../content/galaxies';
import type { GalaxyDef, RockKind } from '../../content/types';
import { spawnFromEdge, type AsteroidSize, type EdgeSpawn } from '../asteroid';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Arena, Spawner } from '../rules';
import { clearReport, Combo, type GalaxyMode } from '../scoring';
import { GalaxyDirector, ROCK_COST } from './director';
import { phaseAt, type Phase } from './pacing';
import { Showers, type ShowerState } from './showers';

const WARP_SECONDS = 1.5;
const MERCY_SECONDS = 4;
const MERCY = 0.4;
const KIND_SIZE: Readonly<Record<RockKind, AsteroidSize>> = { large: 0, medium: 1, small: 2 };
/** Meteors are tiny: fast, and they do not split. */
const SHOWER_SIZE: AsteroidSize = 3;
/** Budget cost by asteroid size; a tiny fragment weighs half a small rock. */
const SIZE_COST: Readonly<Record<AsteroidSize, number>> = { 0: ROCK_COST.large, 1: ROCK_COST.medium, 2: ROCK_COST.small, 3: ROCK_COST.small / 2 };

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

  step(dt: number): void {
    const elapsed = this.arena.elapsed();
    if (!this.started) {
      this.started = true;
      this.arena.events.push({ type: 'galaxyStart', id: this.galaxy.id });
    }
    if (this.warpEndsAt !== null) {
      if (elapsed + TIME_EPSILON >= this.warpEndsAt) this.finish();
      return;
    }
    this.combo.expire(elapsed);
    this.announceCombo();
    if (phaseAt(this.galaxy, elapsed) === 'warp') {
      this.warpOut(elapsed);
      return;
    }
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
    const meteors = this.showers.step(elapsed, dt, areaOf(field), this.arena.events);
    const edge = this.showers.state?.edge;
    if (edge !== undefined) {
      for (let i = 0; i < meteors; i++) this.addRock({ size: () => SHOWER_SIZE, speedMultiplier: this.rockSpeed, edge });
    }
    const mercy = elapsed < this.mercyUntil ? MERCY : 1;
    const order = this.director.step(dt, { elapsed, onFieldCost: this.fieldCost(), mercy });
    if (order !== null) {
      this.addRock({ size: () => KIND_SIZE[order.kind], speedMultiplier: order.speedMultiplier, avoid: this.arena.ship });
    }
  }

  private addRock(spec: EdgeSpawn): void {
    const { arena } = this;
    arena.asteroids.push(spawnFromEdge(this.rng, arena.field(), spec, arena.shapeRng, arena.nextId()));
  }

  private fieldCost(): number {
    let cost = 0;
    for (const a of this.arena.asteroids) cost += SIZE_COST[a.size];
    return cost;
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
