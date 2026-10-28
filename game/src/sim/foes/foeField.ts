import { FOES } from '../../content/foes';
import type { FoeKind } from '../../content/types';
import type { BossFoes } from '../boss/behaviour';
import { circlesOverlap, SpatialHash } from '../collision';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { NONE_STRUCK } from '../projectile';
import type { Rng } from '../rng';
import type { Arena } from '../rules';
import { overlapsAcrossWrap, rescalePose } from '../wrap';
import type { Bolts } from './bolts';
import { ARMOURED_BEHAVIOUR } from './armoured';
import { DRONE } from './drone';
import { FoePool, type Foe, type FoeBehaviour, type FoeWorld } from './foe';
import { GUNSHIP_BEHAVIOUR } from './gunship';
import { MINE_BEHAVIOUR } from './mine';
import { PHASER_BEHAVIOUR } from './phaser';
import { SPLITTER } from './splitter';

/** The most foes on the field at once; a spawn beyond it is dropped. A boss's drones share the pool. */
export const FOE_CAPACITY = 64;
const HASH_CELL_SIZE = ASTEROID.radii[0] * 2;

const BEHAVIOURS: Readonly<Record<FoeKind, FoeBehaviour>> = {
  splitter: SPLITTER,
  drone: DRONE,
  gunship: GUNSHIP_BEHAVIOUR,
  mine: MINE_BEHAVIOUR,
  phaser: PHASER_BEHAVIOUR,
  armoured: ARMOURED_BEHAVIOUR,
};
/** What `hit` returns for a shot an armoured foe turned aside: it is spent, and it struck nothing. */
export const FOE_DEFLECTED = -2;

/** What the galaxy run adds to a foe's death. */
export interface FoeHooks {
  /** The points a kill worth `base` scores, once the combo has counted it. */
  score(base: number): number;
  /** A shot killed a foe at (x, y): it may drop a pickup. */
  killed(x: number, y: number): void;
}

/**
 * The foes on a galaxy's field: they arrive, move, take hits and are destroyed. They are not asteroids: they have
 * hit points, and score by their kind. Shots and the ship find them through a spatial hash rebuilt each step. A boss
 * launches its own foes into the same pool, and counts those still alive.
 */
export class FoeField implements FoeWorld, BossFoes {
  private readonly pool = new FoePool(FOE_CAPACITY);
  private readonly hash = new SpatialHash(HASH_CELL_SIZE);
  /** The circle the running query is for; the visit function reads it, so a query allocates nothing. */
  private queryX = 0;
  private queryY = 0;
  private queryRadius = 0;
  /** The ids the running query passes over: the foes a piercing shot has already struck. */
  private querySkip: readonly number[] = NONE_STRUCK;
  private found: Foe | null = null;
  private foundIndex = -1;
  /** The blasts set off this step, as circles; the slots are kept for reuse, so a step of blasts allocates nothing new. */
  private readonly blasts: { x: number; y: number; r: number }[] = [];
  private blastCount = 0;
  private readonly visit = (index: number): void => {
    const foe = this.pool.live[index];
    if (foe !== undefined && foe.hp > 0 && index > this.foundIndex && circlesOverlap(this.queryX, this.queryY, this.queryRadius, foe.x, foe.y, foe.radius) && !this.querySkip.includes(foe.id)) {
      this.found = foe;
      this.foundIndex = index;
    }
  };

  constructor(
    readonly arena: Arena,
    /** The 'foes' stream. */
    readonly rng: Rng,
    private readonly hooks: FoeHooks,
    /** The galaxy's hostile bolts, which gunships fire; a field without them may hold no gunship. */
    readonly bolts: Bolts | null = null,
  ) {}

  /** The foes on the field; live, and mutated in place. */
  get list(): readonly Foe[] {
    return this.pool.live;
  }

  /** What the foes weigh on the threat budget. */
  get cost(): number {
    return this.pool.cost;
  }

  /** How many of the foes a boss launched are alive. */
  get launched(): number {
    let count = 0;
    for (const foe of this.pool.live) if (foe.fromAttack && foe.hp > 0) count++;
    return count;
  }

  acquire(kind: FoeKind): Foe | null {
    return this.pool.acquire(kind, this.arena.nextId());
  }

  commit(foe: Foe): void {
    foe.px = foe.x;
    foe.py = foe.y;
    foe.protation = foe.rotation;
    this.pool.add(foe);
    this.arena.events.push({ type: 'foeSpawned', id: foe.id, kind: foe.kind, x: foe.x, y: foe.y });
  }

  /** Brings in `count` foes of `kind`. */
  spawn(kind: FoeKind, count: number, speedMultiplier: number): void {
    BEHAVIOURS[kind].spawn(this, count, speedMultiplier);
  }

  /** A boss's foe of `kind` arrives at (x, y), heading `heading` at its kind's speed; false with the pool full. Draws from no stream. */
  launch(kind: FoeKind, x: number, y: number, heading: number): boolean {
    const foe = this.acquire(kind);
    if (foe === null) return false;
    const { speed } = FOES[kind];
    foe.x = x;
    foe.y = y;
    foe.rotation = heading;
    foe.vx = Math.cos(heading) * speed;
    foe.vy = Math.sin(heading) * speed;
    foe.fromAttack = true;
    this.commit(foe);
    return true;
  }

  detonate(foe: Foe, radius: number): void {
    const slot = this.blasts[this.blastCount] ?? { x: 0, y: 0, r: 0 };
    this.blasts[this.blastCount++] = slot;
    slot.x = foe.x;
    slot.y = foe.y;
    slot.r = radius;
    this.arena.events.push({ type: 'mineBlast', id: foe.id, x: foe.x, y: foe.y, radius });
    foe.hp = 0;
    this.destroy(foe, 0, false);
  }

  /** Moves every foe and indexes it for the collisions that follow. The last step's blasts are spent. */
  step(dt: number): void {
    const field = this.arena.field();
    this.blastCount = 0;
    this.hash.clear();
    const { live } = this.pool;
    for (let i = 0; i < live.length; i++) {
      const foe = live[i] as Foe;
      // A foe spent this step (a black hole's horizon swallowed it) is swept after the collisions: it does not act.
      if (foe.hp <= 0) continue;
      foe.px = foe.x;
      foe.py = foe.y;
      foe.protation = foe.rotation;
      BEHAVIOURS[foe.kind].step(foe, dt, field, this);
      this.hash.insert(i, foe.x, foe.y, foe.radius);
    }
  }

  /** Takes the foes the step's collisions destroyed off the field. Call it once collisions are done: until then they keep their index in the hash. */
  sweep(): void {
    this.pool.sweep();
  }

  /**
   * A shot at (x, y) has reached a foe not in `struck`, if it overlaps one: it deals 1 damage, or, if the foe's armour
   * turns it aside, is spent with `foeDeflected` (`FOE_DEFLECTED`). Returns the foe's id, or -1 for none.
   */
  hit(x: number, y: number, radius: number, struck: readonly number[] = NONE_STRUCK): number {
    const foe = this.overlapping(x, y, radius, struck);
    if (foe === null) return -1;
    if (BEHAVIOURS[foe.kind].deflects?.(foe, x, y) === true) {
      this.arena.events.push({ type: 'foeDeflected', id: foe.id, x, y });
      return FOE_DEFLECTED;
    }
    foe.hp -= 1;
    if (foe.hp > 0) {
      this.arena.events.push({ type: 'foeHit', id: foe.id, x: foe.x, y: foe.y, hp: foe.hp });
      return foe.id;
    }
    this.kill(foe);
    this.hooks.killed(foe.x, foe.y);
    return foe.id;
  }

  /** A blast of `radius` at (x, y): every foe it reaches across the wrap is destroyed for score, leaving nothing behind and dropping nothing. */
  blast(x: number, y: number, radius: number): void {
    const field = this.arena.field();
    for (const foe of this.pool.live) if (foe.hp > 0 && overlapsAcrossWrap(field, x, y, radius, foe.x, foe.y, foe.radius)) this.kill(foe, false);
    this.pool.sweep();
  }

  /** The ship at (x, y) has run into a foe, if it overlaps one; true means it did. The foe is destroyed for 0 points. */
  ram(x: number, y: number, radius: number): boolean {
    const foe = this.overlapping(x, y, radius);
    if (foe === null) return false;
    foe.hp = 0;
    this.destroy(foe, 0);
    return true;
  }

  /**
   * True when the ship at (x, y) has run into a foe, which is destroyed for 0 points (`ram`), or is caught in a blast set
   * off this step, measured across the wrap.
   */
  strikes(x: number, y: number, radius: number): boolean {
    if (this.ram(x, y, radius)) return true;
    const field = this.arena.field();
    for (let i = 0; i < this.blastCount; i++) {
      const blast = this.blasts[i] as { x: number; y: number; r: number };
      if (overlapsAcrossWrap(field, blast.x, blast.y, blast.r, x, y, radius)) return true;
    }
    return false;
  }

  /** A black hole's horizon has taken `foe`: it is destroyed for 0 points, leaving nothing behind. */
  swallow(foe: Foe): void {
    foe.hp = 0;
    this.destroy(foe, 0, false);
  }

  /** Clears every foe for 0 points, with no fragments: the galaxy is over. */
  clear(): void {
    for (const foe of this.pool.live) this.arena.events.push({ type: 'foeDestroyed', id: foe.id, kind: foe.kind, x: foe.x, y: foe.y, points: 0 });
    this.pool.clear();
  }

  /** Stretches every foe's place to the new field, like the World's other entities. */
  resize(old: Field, field: Field): void {
    for (const foe of this.pool.live) rescalePose(foe, old, field);
  }

  /** Destroys `foe` for its points through the combo, with its remains (a splitter's fragments) unless `remains` is false. */
  private kill(foe: Foe, remains = true): void {
    foe.hp = 0;
    const points = this.hooks.score(FOES[foe.kind].points);
    this.arena.award(points);
    this.destroy(foe, points, remains);
  }

  private destroy(foe: Foe, points: number, remains = true): void {
    this.arena.events.push({ type: 'foeDestroyed', id: foe.id, kind: foe.kind, x: foe.x, y: foe.y, points });
    if (remains) BEHAVIOURS[foe.kind].destroyed?.(foe, this);
  }

  /** The last-arrived live foe overlapping the circle and not in `skip`, or null. */
  private overlapping(x: number, y: number, radius: number, skip: readonly number[] = NONE_STRUCK): Foe | null {
    this.queryX = x;
    this.queryY = y;
    this.queryRadius = radius;
    this.querySkip = skip;
    this.found = null;
    this.foundIndex = -1;
    this.hash.forEachCandidate(x, y, radius, this.visit);
    return this.found;
  }
}
