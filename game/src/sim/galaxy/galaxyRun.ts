import { bossHp, BOSSES } from '../../content/bosses';
import { rockSpeedMultiplier } from '../../content/curves';
import { isFoeKind } from '../../content/foes';
import { tierOf } from '../../content/galaxies';
import type { BossId, GalaxyDef, PickupId, RockKind, WeaponTier } from '../../content/types';
import { aimFromEdge, hasLeftField, launchFromEdge, type Asteroid, type AsteroidSize, type Edge, type EdgeAim } from '../asteroid';
import type { BossFactory, BossSetup, BossView } from '../boss/behaviour';
import { BossRunner, clearSpot, DYING_SECONDS } from '../boss/bossRunner';
import { createMonolith } from '../boss/monolith';
import { SENTINEL } from '../boss/sentinel';
import { ASTEROID, PLAYER } from '../config';
import type { Field } from '../field';
import { FoeField } from '../foes/foeField';
import type { Foe } from '../foes/foe';
import { Wells, type WellState } from '../hazards/gravityWell';
import { TIME_EPSILON } from '../math';
import { Loadout } from '../pickups/effects';
import { PickupField, type Pickup } from '../pickups/pickups';
import { createRng, deriveSeed, type Rng } from '../rng';
import type { Arena, Spawner } from '../rules';
import type { Ship } from '../ship';
import { clearReport, Combo, type GalaxyMode } from '../scoring';
import { GalaxyDirector, SIZE_COST } from './director';
import { phaseAt, type Phase } from './pacing';
import { Showers, type ShowerState } from './showers';

const WARP_SECONDS = 1.5;
/** A beaten boss dies over the warp, so that warp lasts as long as its dying. */
const BOSS_WARP_SECONDS = Math.max(WARP_SECONDS, DYING_SECONDS);
const MERCY_SECONDS = 4;
const MERCY = 0.4;
const KIND_SIZE: Readonly<Record<RockKind, AsteroidSize>> = { large: 0, medium: 1, small: 2 };
/**
 * Meteors are tiny: fast, and they do not split. Keep this tiny: a bigger meteor would split, and
 * its fragments inherit `transient`, so they would pass through too.
 */
const SHOWER_SIZE: AsteroidSize = 3;
/** How each boss fights, made afresh for each fight. */
const BOSS_BEHAVIOURS: Readonly<Record<BossId, BossFactory>> = { monolith: createMonolith, sentinel: () => SENTINEL };
/** Points for beating a boss, per Dimension, before the combo multiplier. */
const BOSS_KILL_POINTS = 1000;

/** The named streams a galaxy run draws from, one per concern, so one never shifts another. */
export interface GalaxyStreams {
  /** Kinds, spawn points and showers. */
  readonly director: Rng;
  readonly boss: Rng;
  /** Whether a kill drops, and what. */
  readonly pickups: Rng;
  /** Foe behaviour: where they enter, their headings and their fragments. */
  readonly foes: Rng;
  /** Where gravity wells sit. */
  readonly hazards: Rng;
}

/** The streams of a run with `seed`. */
export function galaxyStreams(seed: number): GalaxyStreams {
  const stream = (name: string): Rng => createRng(deriveSeed(seed, name));
  return { director: stream('director'), boss: stream('boss'), pickups: stream('pickups'), foes: stream('foes'), hazards: stream('hazards') };
}

const areaOf = (field: Field): number => field.width * field.height;

/**
 * A timed galaxy: it opens on an empty field, the director meters rocks and foes into it from one threat budget, and
 * showers and gravity wells run on schedule. When the timer runs out the ship warps out, clearing the field and reporting the clear; the galaxy's
 * status turns cleared 1.5 s later.
 * A boss galaxy has no clock to beat: once its approach ends its boss arrives, and the step its HP hits 0 warps out
 * instead. The boss dies over that warp, which lasts its 2 s of dying.
 */
export class GalaxyRun implements Spawner {
  private readonly director: GalaxyDirector;
  private readonly showers: Showers;
  private readonly wells: Wells;
  private readonly foes: FoeField;
  private readonly combo = new Combo();
  private readonly rockSpeed: number;
  private shownMultiplier = 1;
  private started = false;
  private bossRunner: BossRunner | null = null;
  private warpEndsAt: number | null = null;
  private mercyUntil = 0;
  /** What the ship carries: its weapon tier and its timed effects. */
  readonly loadout: Loadout;
  private readonly pickupField: PickupField;
  /** Hands a collected pickup to the loadout; made once so stepping allocates nothing. */
  private readonly takePickup = (kind: PickupId): void => {
    this.loadout.collect(kind);
  };
  /** Refilled every step, so the director's input costs no allocation. */
  private readonly context = { elapsed: 0, onFieldCost: 0, mercy: 1 };

  constructor(
    readonly galaxy: GalaxyDef,
    private readonly mode: GalaxyMode,
    private readonly streams: GalaxyStreams,
    private readonly arena: Arena,
    startTier: WeaponTier = 0,
    /** How each boss fights; tests stand in a behaviour of their own. */
    private readonly behaviours: Readonly<Record<BossId, BossFactory>> = BOSS_BEHAVIOURS,
  ) {
    this.loadout = new Loadout(startTier);
    this.pickupField = new PickupField(galaxy.pickups, tierOf(galaxy), streams.pickups);
    this.director = new GalaxyDirector(galaxy, streams.director, areaOf(arena.field()));
    this.showers = new Showers(galaxy.events, streams.director);
    this.wells = new Wells(galaxy.events, streams.hazards, () => arena.nextId());
    this.foes = new FoeField(arena, streams.foes, { score: (base) => this.scoreKill(base), killed: (x, y) => { this.dropFrom(x, y); } });
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

  /** The boss, once its approach is over; the same object every step. */
  get boss(): BossView | null {
    return this.bossRunner?.view ?? null;
  }

  /** The pickups on the field; a live view. */
  get pickups(): readonly Readonly<Pickup>[] {
    return this.pickupField.list;
  }

  /** The foes on the field; a live view. */
  get foeList(): readonly Foe[] {
    return this.foes.list;
  }

  /** The gravity well being telegraphed or pulling, for the HUD and renderer; a live view. */
  get well(): WellState | null {
    return this.wells.state;
  }

  resize(old: Field, field: Field): void {
    this.director.fieldArea = areaOf(field);
    this.pickupField.resize(old, field);
    this.foes.resize(old, field);
    this.wells.resize(old, field);
    this.bossRunner?.resize(old, field);
  }

  /** Announces the galaxy on its first step, and warps out on the step its timer runs out, before anything collides. */
  beginStep(): void {
    if (!this.started) {
      this.started = true;
      this.arena.events.push({ type: 'galaxyStart', id: this.galaxy.id });
    }
    const elapsed = this.arena.elapsed();
    if (this.warpEndsAt === null && phaseAt(this.galaxy, elapsed) === 'warp') this.warpOut(elapsed, WARP_SECONDS);
  }

  /**
   * The hazard path. A gravity well pulls by nudging the velocities of the ship, the rocks and the foes it pulls, and
   * a boss's attack shoves the ship, here, after `stepShip` and before anything else moves; then the foes move.
   */
  moveOwn(dt: number, ship: Ship): void {
    this.wells.pull(dt, ship, this.arena.asteroids, this.foes.list);
    this.bossRunner?.shove(ship);
    this.foes.step(dt);
  }

  /** Takes off the field the foes this step's collisions destroyed, whether or not the ship survived them. */
  afterCollisions(): void {
    this.foes.sweep();
  }

  step(dt: number): void {
    const elapsed = this.arena.elapsed();
    if (this.warpEndsAt === null && !this.bossBeaten) {
      this.combo.expire(elapsed);
      this.announceCombo();
      this.spawn(dt, elapsed);
    }
    // The fight, or a beaten boss dying under the warp.
    this.stepBoss(dt, elapsed);
    if (this.warpEndsAt === null) {
      if (this.bossBeaten) this.warpOut(elapsed, BOSS_WARP_SECONDS);
    } else if (elapsed + TIME_EPSILON >= this.warpEndsAt) {
      this.finish();
    }
    const { events, ship } = this.arena;
    this.loadout.step(dt, events);
    this.pickupField.step(dt, this.arena.field(), ship, this.takePickup, events);
  }

  /** The boss's HP has hit 0: it is dying, or down. */
  private get bossBeaten(): boolean {
    const state = this.bossRunner?.state;
    return state === 'dying' || state === 'down';
  }

  scoreKill(base: number): number {
    const multiplier = this.combo.kill(this.arena.elapsed());
    this.announceCombo();
    return base * multiplier;
  }

  /**
   * A shot at (x, y) has reached the boss, if it overlaps a live part or the core; true means the shot is spent. A part
   * takes 1 damage, reporting `bossPartHit` or `bossPartBroken`. The core takes 1 damage and reports a `bossHit`, or a
   * `bossDeflected` at (x, y) while shielded or off its weak point, and nothing while invulnerable; the blow that kills
   * it scores `1000 x Dimension` as a combo kill.
   */
  hitBoss(x: number, y: number, radius: number): boolean {
    const boss = this.bossRunner;
    if (boss === null || boss.state === 'down') return false;
    const part = boss.partAt(x, y, radius);
    if (part >= 0) {
      this.hitPart(boss, part);
      return true;
    }
    if (!boss.overlaps(x, y, radius)) return false;
    const result = boss.hit(1, x, y);
    if (result === 'blocked') return true;
    if (result === 'deflected') {
      this.arena.events.push({ type: 'bossDeflected', x, y });
      return true;
    }
    this.arena.events.push({ type: 'bossHit', x, y, hp: boss.hp });
    if (result === 'killed') this.arena.award(this.scoreKill(BOSS_KILL_POINTS * this.galaxy.dimension));
    return true;
  }

  private hitPart(boss: BossRunner, index: number): void {
    const result = boss.hitPart(index, 1);
    const part = boss.view.parts[index];
    if (result === 'blocked' || part === undefined) return;
    const { x, y } = part;
    this.arena.events.push(result === 'broken' ? { type: 'bossPartBroken', part: index, x, y } : { type: 'bossPartHit', part: index, x, y, hp: part.hp });
  }

  /** True when a circle at (x, y) touches a boss that is fighting, its core or a live part; the intro and dying are harmless. */
  touchesBoss(x: number, y: number, radius: number): boolean {
    return this.bossRunner?.state === 'fighting' && this.bossRunner.touches(x, y, radius);
  }

  shipLost(): void {
    this.combo.reset();
    this.announceCombo();
    this.mercyUntil = this.arena.elapsed() + MERCY_SECONDS;
    // Rank punishes a death with a tier; Free play only resets the tier with the next galaxy.
    this.loadout.die(this.arena.events, this.mode === 'rank');
  }

  /** A kill may drop a pickup, unless the rock was a pass-through one (a meteor, a shard or a splitter's fragment). */
  rockKilled(rock: Readonly<Asteroid>): void {
    if (rock.transient !== true) this.dropFrom(rock.x, rock.y);
  }

  private dropFrom(x: number, y: number): void {
    this.pickupField.roll(x, y, { lastLife: this.arena.lives() === 1, weaponTier: this.loadout.tier }, this.arena.events);
  }

  /** A shot at (x, y) has reached a foe, if it overlaps one; true means the shot is spent. A kill scores and may drop a pickup. */
  hitFoe(x: number, y: number, radius: number): boolean {
    return this.foes.hit(x, y, radius);
  }

  /** True when the ship at (x, y) has run into a foe, which is destroyed for 0 points, or into a boss that is fighting. */
  shipStruck(x: number, y: number, radius: number): boolean {
    return this.foes.ram(x, y, radius) || this.touchesBoss(x, y, radius);
  }

  /** A ship respawning while a boss is on the field comes back clear of its reach, not at the centre, where the boss may be. */
  respawned(ship: Ship): void {
    const boss = this.bossRunner;
    if (boss === null || boss.state === 'down') return;
    const spot = clearSpot(boss.view, boss.reach + PLAYER.radius + ASTEROID.safeRadius, this.arena.field());
    ship.x = ship.px = spot.x;
    ship.y = ship.py = spot.y;
  }

  /** The Shield takes a hit meant for the ship, if it has one; true means the hit is absorbed: no life is lost. */
  absorbHit(): boolean {
    if (!this.loadout.shielded) return false;
    this.loadout.breakShield();
    this.arena.events.push({ type: 'shieldBroken' });
    return true;
  }

  /** Brings the boss in as the approach ends, and runs it. */
  private stepBoss(dt: number, elapsed: number): void {
    const { boss: id, dimension } = this.galaxy;
    if (id === null || phaseAt(this.galaxy, elapsed) !== 'boss') return;
    this.bossRunner ??= this.bringBoss(id, dimension);
    this.bossRunner.step(dt, this.arena);
  }

  private bringBoss(id: BossId, dimension: GalaxyDef['dimension']): BossRunner {
    const def = BOSSES[id];
    const setup: BossSetup = { maxHp: bossHp(def, dimension), rng: this.streams.boss, rockSpeed: this.rockSpeed, field: this.arena.field(), foes: this.foes };
    return new BossRunner(def, this.behaviours[id](setup), setup);
  }

  private spawn(dt: number, elapsed: number): void {
    const field = this.arena.field();
    const meteors = this.showers.step(elapsed, dt, areaOf(field), this.sweepField(), this.arena.events);
    const edge = this.showers.state?.edge;
    if (edge !== undefined) this.dropMeteors(meteors, edge, field);
    this.wells.step(elapsed, field, this.arena.events);
    this.context.onFieldCost += this.foes.cost;
    this.context.elapsed = elapsed;
    this.context.mercy = elapsed < this.mercyUntil ? MERCY : 1;
    const order = this.director.step(dt, this.context);
    if (order === null) return;
    if (isFoeKind(order.kind)) this.foes.spawn(order.kind, order.count, order.speedMultiplier);
    else this.addRock(aimFromEdge(this.streams.director, field, null, this.arena.ship), KIND_SIZE[order.kind], order.speedMultiplier);
  }

  /** Meteors enter from the shower's edge and pass through: they never wrap. They count toward the field cost. */
  private dropMeteors(count: number, edge: Edge, field: Field): void {
    for (let i = 0; i < count; i++) {
      this.addRock(aimFromEdge(this.streams.director, field, edge, null), SHOWER_SIZE, this.rockSpeed).transient = true;
      this.context.onFieldCost += SIZE_COST[SHOWER_SIZE];
    }
  }

  private addRock(aim: EdgeAim, size: AsteroidSize, speedMultiplier: number): Asteroid {
    const { arena } = this;
    const rock = launchFromEdge(this.streams.director, aim, size, speedMultiplier, arena.shapeRng, arena.nextId());
    arena.asteroids.push(rock);
    return rock;
  }

  /**
   * Removes the meteors that have passed out of the field, totting up the field's cost into the
   * director's context as it goes. Returns how many meteors are still on the field: every transient rock counts, a
   * boss's shards and a broken splitter's fragments included, so they thin a shower while they last.
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

  /**
   * Clears every rock for 0 points and reports the clear: from here the ship cannot be hit and nothing scores, so
   * the outcome is final, and an app that records it now keeps the win even if the page closes during the warp.
   */
  private warpOut(elapsed: number, seconds: number): void {
    const { arena } = this;
    const { asteroids, events } = arena;
    events.push({ type: 'warpOut' });
    for (const a of asteroids) events.push({ type: 'asteroidDestroyed', id: a.id, x: a.x, y: a.y, size: a.size, points: 0 });
    asteroids.length = 0;
    this.foes.clear();
    this.showers.stop();
    this.wells.stop();
    this.warpEndsAt = elapsed + seconds;
    arena.setStatus('warping');
    const report = clearReport({ score: arena.score(), deaths: arena.deaths(), dimension: this.galaxy.dimension, mode: this.mode });
    arena.award(report.score - arena.score());
    events.push({ type: 'galaxyCleared', ...report });
  }

  /** The warp is over: the galaxy is cleared, with no second event. */
  private finish(): void {
    this.arena.setStatus('cleared');
  }
}
