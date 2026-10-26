import { bossHp, BOSSES } from '../../content/bosses';
import { rockSpeedMultiplier } from '../../content/curves';
import { tierOf } from '../../content/galaxies';
import type { BossId, GalaxyDef, PickupId, RockKind, WeaponTier } from '../../content/types';
import { aimFromEdge, hasLeftField, launchFromEdge, type Asteroid, type AsteroidSize, type Edge, type EdgeAim } from '../asteroid';
import { BossRunner, DYING_SECONDS, type BossBehaviour, type BossView } from '../boss/bossRunner';
import { SENTINEL } from '../boss/sentinel';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import { Loadout } from '../pickups/effects';
import { PickupField, type Pickup } from '../pickups/pickups';
import type { Rng } from '../rng';
import type { Arena, Spawner } from '../rules';
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
const BOSS_BEHAVIOURS: Readonly<Record<BossId, BossBehaviour>> = { sentinel: SENTINEL };
/** Points for beating a boss, per Dimension, before the combo multiplier. */
const BOSS_KILL_POINTS = 1000;

const areaOf = (field: Field): number => field.width * field.height;

/**
 * A timed galaxy: it opens on an empty field, the director meters rocks into it and showers fall on
 * schedule. When the timer runs out the ship warps out, clearing the field and reporting the clear; the galaxy's
 * status turns cleared 1.5 s later.
 * A boss galaxy has no clock to beat: once its approach ends its boss arrives, and the step its HP hits 0 warps out
 * instead. The boss dies over that warp, which lasts its 2 s of dying.
 */
export class GalaxyRun implements Spawner {
  private readonly director: GalaxyDirector;
  private readonly showers: Showers;
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
    /** The 'director' stream: kinds, spawn points and showers, so practice streams never shift. */
    private readonly rng: Rng,
    /** The 'boss' stream. */
    private readonly bossRng: Rng,
    private readonly arena: Arena,
    /** The 'pickups' stream: whether a kill drops, and what. */
    pickupRng: Rng,
    startTier: WeaponTier = 0,
  ) {
    this.loadout = new Loadout(startTier);
    this.pickupField = new PickupField(galaxy.pickups, tierOf(galaxy), pickupRng);
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

  /** The boss, once its approach is over; the same object every step. */
  get boss(): BossView | null {
    return this.bossRunner?.view ?? null;
  }

  /** The pickups on the field; a live view. */
  get pickups(): readonly Readonly<Pickup>[] {
    return this.pickupField.list;
  }

  resize(old: Field, field: Field): void {
    this.director.fieldArea = areaOf(field);
    this.pickupField.resize(old, field);
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
   * A shot at (x, y) has reached the core, if it overlaps it; true means the shot is spent. It takes 1 damage and
   * reports a `bossHit`, unless the boss is invulnerable; the blow that kills it scores `1000 x Dimension` as a combo kill.
   */
  hitBoss(x: number, y: number, radius: number): boolean {
    const boss = this.bossRunner;
    if (boss === null || boss.state === 'down' || !boss.overlaps(x, y, radius)) return false;
    const result = boss.hit(1);
    if (result === 'blocked') return true;
    this.arena.events.push({ type: 'bossHit', x, y, hp: boss.hp });
    if (result === 'killed') this.arena.award(this.scoreKill(BOSS_KILL_POINTS * this.galaxy.dimension));
    return true;
  }

  /** True when a circle at (x, y) touches a boss that is fighting; the intro and dying are harmless. */
  touchesBoss(x: number, y: number, radius: number): boolean {
    return this.bossRunner?.state === 'fighting' && this.bossRunner.overlaps(x, y, radius);
  }

  shipLost(): void {
    this.combo.reset();
    this.announceCombo();
    this.mercyUntil = this.arena.elapsed() + MERCY_SECONDS;
    // Rank punishes a death with a tier; Free play only resets the tier with the next galaxy.
    this.loadout.die(this.arena.events, this.mode === 'rank');
  }

  /** A kill may drop a pickup, unless the rock was a pass-through one (a meteor or a shard). */
  rockKilled(rock: Readonly<Asteroid>): void {
    if (rock.transient === true) return;
    this.pickupField.roll(rock.x, rock.y, { lastLife: this.arena.lives() === 1, weaponTier: this.loadout.tier }, this.arena.events);
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
    const def = BOSSES[id];
    this.bossRunner ??= new BossRunner(def, BOSS_BEHAVIOURS[id], { maxHp: bossHp(def, dimension), rng: this.bossRng, rockSpeed: this.rockSpeed, field: this.arena.field() });
    this.bossRunner.step(dt, this.arena);
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
    this.showers.stop();
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
