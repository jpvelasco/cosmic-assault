import { bossHp, BOSSES } from '../../content/bosses';
import { rockSpeedMultiplier } from '../../content/curves';
import { isFoeKind } from '../../content/foes';
import { tierOf } from '../../content/galaxies';
import { isBlast } from '../../content/pickups';
import type { BossId, GalaxyDef, PickupId, RockKind, WeaponTier } from '../../content/types';
import { aimFromEdge, hasLeftField, launchFromEdge, type Asteroid, type AsteroidSize, type Edge, type EdgeAim } from '../asteroid';
import type { BossFactory, BossSetup, BossView } from '../boss/behaviour';
import { BossArena } from '../boss/bossArena';
import { BossRunner, DYING_SECONDS } from '../boss/bossRunner';
import { BOSS_BEHAVIOURS } from '../boss/roster';
import type { Field } from '../field';
import { Bolts, type Bolt } from '../foes/bolts';
import { FoeField } from '../foes/foeField';
import type { Foe } from '../foes/foe';
import type { HazardState } from '../hazards/hazard';
import { HazardField } from '../hazards/hazardField';
import { TIME_EPSILON } from '../math';
import { blast, type BlastScene } from '../pickups/blast';
import { Loadout } from '../pickups/effects';
import { PickupField, type Pickup } from '../pickups/pickups';
import type { Arena, Spawner } from '../rules';
import type { Ship } from '../ship';
import type { ShotRules } from '../shots';
import { clearReport, Combo, type GalaxyMode } from '../scoring';
import { GalaxyDirector, SIZE_COST } from './director';
import { phaseAt, type Phase } from './pacing';
import { Showers, type ShowerState } from './showers';
import type { GalaxyStreams } from './streams';

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
/** Points for beating a boss, per Dimension, before the combo multiplier. */
const BOSS_KILL_POINTS = 1000;

const areaOf = (field: Field): number => field.width * field.height;

/**
 * A timed galaxy: it opens on an empty field, the director meters rocks and foes into it from one threat budget, and
 * showers and hazards run on schedule. When the timer runs out the ship warps out, clearing the field and reporting the clear; the galaxy's
 * status turns cleared 1.5 s later.
 * A boss galaxy has no clock to beat: once its approach ends its boss arrives, and the step its HP hits 0 warps out
 * instead. The boss dies over that warp, which lasts its 2 s of dying.
 */
export class GalaxyRun implements Spawner {
  private readonly director: GalaxyDirector;
  private readonly showers: Showers;
  private readonly hazards: HazardField;
  private readonly foes: FoeField;
  /** The hostile bolts the boss and the foes fire. */
  private readonly bolts: Bolts;
  private readonly combo = new Combo();
  private readonly rockSpeed: number;
  private shownMultiplier = 1;
  private started = false;
  /** Where the boss, once it arrives, meets the shots, the blasts and the ship. */
  readonly bosses: BossArena;
  private warpEndsAt: number | null = null;
  private mercyUntil = 0;
  /** What the ship carries: its weapon tier and its timed effects. */
  readonly loadout: Loadout;
  private readonly pickupField: PickupField;
  /** Hands a collected pickup to the loadout, or sets off its blast at the ship; made once so stepping allocates nothing. */
  private readonly takePickup = (kind: PickupId): void => {
    if (isBlast(kind)) blast(kind, this.arena.ship.x, this.arena.ship.y, this.blastScene);
    else this.loadout.collect(kind);
  };
  private readonly blastScene: BlastScene;
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
    this.pickupField = new PickupField(galaxy.pickups, tierOf(galaxy), streams.pickups, galaxy.featured);
    this.director = new GalaxyDirector(galaxy, streams.director, areaOf(arena.field()));
    this.showers = new Showers(galaxy.events, streams.director);
    this.hazards = new HazardField(galaxy.events, streams.hazards, () => arena.nextId());
    this.bolts = new Bolts(arena);
    this.foes = new FoeField(arena, streams.foes, { score: (base) => this.scoreKill(base), killed: (x, y) => { this.dropFrom(x, y); } }, this.bolts);
    this.rockSpeed = rockSpeedMultiplier(tierOf(galaxy));
    this.bosses = new BossArena(arena, BOSS_KILL_POINTS * galaxy.dimension, (base) => this.scoreKill(base), () => this.bringBoss());
    this.blastScene = { arena, foes: this.foes, bolts: this.bolts, bosses: this.bosses };
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
    return this.bosses.view;
  }

  /** The pickups on the field; a live view. */
  get pickups(): readonly Readonly<Pickup>[] {
    return this.pickupField.list;
  }

  /** The foes on the field; a live view. */
  get foeList(): readonly Foe[] {
    return this.foes.list;
  }

  /** The hostile bolts on the field; a live view. */
  get boltList(): readonly Bolt[] {
    return this.bolts.list;
  }

  /** The hazards being telegraphed or active, for the HUD, the renderer and the bots; a live view. */
  get hazardStates(): readonly HazardState[] {
    return this.hazards.states;
  }

  resize(old: Field, field: Field): void {
    this.director.fieldArea = areaOf(field);
    this.pickupField.resize(old, field);
    this.foes.resize(old, field);
    this.bolts.resize(old, field);
    this.hazards.resize(old, field);
    this.bosses.resize(old, field);
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
   * The hazard path. Hazards pull by nudging the velocities of the ship (capped, summed), the rocks and the foes they
   * pull, and a boss's attack shoves the ship, here, after `stepShip` and before anything else moves; then the foes
   * and the bolts move, at the enemies' time scale.
   */
  moveOwn(dt: number, ship: Ship): void {
    this.hazards.move(dt, ship, this.arena.asteroids, this.foes.list);
    this.bosses.shove(ship);
    const enemyDt = dt * this.enemyTimeScale();
    this.foes.step(enemyDt);
    this.bolts.step(enemyDt);
  }

  shotRules(): ShotRules {
    return this.loadout.shotRules;
  }

  /** Half while Time Warp runs (M6-R4): the rocks, the foes and the fighting boss run at it; the clock, the hazards, the pickups and the ship never do. */
  enemyTimeScale(): number {
    return this.loadout.timeScale;
  }

  /** Takes off the field the foes this step's collisions destroyed, whether or not the ship survived them. */
  afterCollisions(): void {
    this.foes.sweep();
  }

  step(dt: number): void {
    const elapsed = this.arena.elapsed();
    const beaten = this.bosses.beaten;
    if (this.warpEndsAt === null && !beaten) {
      this.combo.expire(elapsed);
      this.announceCombo();
      this.spawn(dt, elapsed);
    }
    // The fight, at the enemies' time scale, or a beaten boss dying under the warp in real time, so it dies as the warp ends.
    this.stepBoss(beaten ? dt : dt * this.enemyTimeScale(), elapsed);
    if (this.warpEndsAt === null) {
      if (this.bosses.beaten) this.warpOut(elapsed, BOSS_WARP_SECONDS);
    } else if (elapsed + TIME_EPSILON >= this.warpEndsAt) {
      this.finish();
    }
    const { events, ship } = this.arena;
    this.loadout.step(dt, events);
    // Nothing is collected once the warp starts: the clear has already reported the weapon tier the run carries on.
    if (this.warpEndsAt === null) this.pickupField.step(dt, this.arena.field(), ship, this.takePickup, events);
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

  /** A shot at (x, y) has reached a foe not in `struck`, if it overlaps one: returns its id, or -1. A kill scores and may drop a pickup. */
  hitFoe(x: number, y: number, radius: number, struck?: readonly number[]): number {
    return this.foes.hit(x, y, radius, struck);
  }

  /** True when the ship at (x, y) has run into a foe, which is destroyed for 0 points, or a mine's blast, a boss that is fighting, a lethal hazard, or a bolt, which is spent. */
  shipStruck(x: number, y: number, radius: number): boolean {
    return this.foes.strikes(x, y, radius) || this.bosses.touches(x, y, radius) || this.hazards.strikes(x, y, radius) || this.bolts.strikes(x, y, radius);
  }

  /** While a boss is on the field, a respawning ship comes back clear of its reach, not at the centre, where the boss may be; else where a hazard sends it, if one does. */
  respawnPoint(): Readonly<{ x: number; y: number }> | null {
    return this.bosses.respawnPoint() ?? this.hazards.respawnPoint();
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
    if (this.galaxy.boss !== null && phaseAt(this.galaxy, elapsed) === 'boss') this.bosses.step(dt);
  }

  /** The galaxy's boss fight, made as the boss arrives. */
  private bringBoss(): BossRunner {
    const { boss: id, dimension } = this.galaxy;
    if (id === null) throw new RangeError(`${this.galaxy.id} has no boss to bring in: only a boss galaxy's run steps a boss`);
    const def = BOSSES[id];
    const setup: BossSetup = { maxHp: bossHp(def, dimension), rng: this.streams.boss, rockSpeed: this.rockSpeed, field: this.arena.field(), foes: this.foes, bolts: this.bolts };
    return new BossRunner(def, this.behaviours[id](setup), setup);
  }

  private spawn(dt: number, elapsed: number): void {
    const field = this.arena.field();
    const meteors = this.showers.step(elapsed, dt, areaOf(field), this.sweepField(), this.arena.events);
    const edge = this.showers.state?.edge;
    if (edge !== undefined) this.dropMeteors(meteors, edge, field);
    this.hazards.step(elapsed, field, this.arena.events);
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
   * Clears every rock and foe for 0 points and every bolt, expires the pickups, and reports the clear: from here the ship cannot be hit and nothing scores, so
   * the outcome is final, and an app that records it now keeps the win even if the page closes during the warp.
   */
  private warpOut(elapsed: number, seconds: number): void {
    const { arena } = this;
    const { asteroids, events } = arena;
    events.push({ type: 'warpOut' });
    for (const a of asteroids) events.push({ type: 'asteroidDestroyed', id: a.id, x: a.x, y: a.y, size: a.size, points: 0 });
    asteroids.length = 0;
    this.foes.clear();
    this.bolts.clear();
    this.pickupField.expireAll(events);
    this.showers.stop();
    this.hazards.stop();
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
