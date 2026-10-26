import { FOES } from '../../content/foes';
import type { FoeKind } from '../../content/types';
import { circlesOverlap, SpatialHash } from '../collision';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import type { Rng } from '../rng';
import type { Arena } from '../rules';
import { rescale } from '../wrap';
import { DRONE } from './drone';
import { FoePool, type Foe, type FoeBehaviour, type FoeWorld } from './foe';
import { SPLITTER } from './splitter';

/** The most foes on the field at once; a spawn beyond it is dropped. A boss's drones share the pool. */
export const FOE_CAPACITY = 64;
const HASH_CELL_SIZE = ASTEROID.radii[0] * 2;

const BEHAVIOURS: Readonly<Record<FoeKind, FoeBehaviour>> = { splitter: SPLITTER, drone: DRONE };

/** What the galaxy run adds to a foe's death. */
export interface FoeHooks {
  /** The points a kill worth `base` scores, once the combo has counted it. */
  score(base: number): number;
  /** A shot killed a foe at (x, y): it may drop a pickup. */
  killed(x: number, y: number): void;
}

/**
 * The foes on a galaxy's field: they arrive, move, take hits and are destroyed. They are not asteroids: they have
 * hit points, and score by their kind. Shots and the ship find them through a spatial hash rebuilt each step.
 */
export class FoeField implements FoeWorld {
  private readonly pool = new FoePool(FOE_CAPACITY);
  private readonly hash = new SpatialHash(HASH_CELL_SIZE);
  /** The circle the running query is for; the visit function reads it, so a query allocates nothing. */
  private queryX = 0;
  private queryY = 0;
  private queryRadius = 0;
  private found: Foe | null = null;
  private foundIndex = -1;
  private readonly visit = (index: number): void => {
    const foe = this.pool.live[index];
    if (foe !== undefined && foe.hp > 0 && index > this.foundIndex && circlesOverlap(this.queryX, this.queryY, this.queryRadius, foe.x, foe.y, foe.radius)) {
      this.found = foe;
      this.foundIndex = index;
    }
  };

  constructor(
    readonly arena: Arena,
    /** The 'foes' stream. */
    readonly rng: Rng,
    private readonly hooks: FoeHooks,
  ) {}

  /** The foes on the field; live, and mutated in place. */
  get list(): readonly Foe[] {
    return this.pool.live;
  }

  /** What the foes weigh on the threat budget. */
  get cost(): number {
    return this.pool.cost;
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

  /** Moves every foe and indexes it for the collisions that follow. */
  step(dt: number): void {
    const field = this.arena.field();
    this.hash.clear();
    const { live } = this.pool;
    for (let i = 0; i < live.length; i++) {
      const foe = live[i] as Foe;
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

  /** A shot at (x, y) has reached a foe, if it overlaps one; true means the shot is spent. It deals 1 damage. */
  hit(x: number, y: number, radius: number): boolean {
    const foe = this.overlapping(x, y, radius);
    if (foe === null) return false;
    foe.hp -= 1;
    if (foe.hp > 0) {
      this.arena.events.push({ type: 'foeHit', id: foe.id, x: foe.x, y: foe.y, hp: foe.hp });
      return true;
    }
    const points = this.hooks.score(FOES[foe.kind].points);
    this.arena.award(points);
    this.destroy(foe, points);
    this.hooks.killed(foe.x, foe.y);
    return true;
  }

  /** The ship at (x, y) has run into a foe, if it overlaps one; true means it did. The foe is destroyed for 0 points. */
  ram(x: number, y: number, radius: number): boolean {
    const foe = this.overlapping(x, y, radius);
    if (foe === null) return false;
    foe.hp = 0;
    this.destroy(foe, 0);
    return true;
  }

  /** Clears every foe for 0 points, with no fragments: the galaxy is over. */
  clear(): void {
    for (const foe of this.pool.live) this.arena.events.push({ type: 'foeDestroyed', id: foe.id, kind: foe.kind, x: foe.x, y: foe.y, points: 0 });
    this.pool.clear();
  }

  /** Stretches every foe's place to the new field, like the World's other entities. */
  resize(old: Field, field: Field): void {
    for (const foe of this.pool.live) {
      foe.x = rescale(foe.x, old.width, field.width);
      foe.y = rescale(foe.y, old.height, field.height);
      foe.px = rescale(foe.px, old.width, field.width);
      foe.py = rescale(foe.py, old.height, field.height);
    }
  }

  private destroy(foe: Foe, points: number): void {
    this.arena.events.push({ type: 'foeDestroyed', id: foe.id, kind: foe.kind, x: foe.x, y: foe.y, points });
    BEHAVIOURS[foe.kind].destroyed?.(foe, this);
  }

  /** The last-arrived live foe overlapping the circle, or null. */
  private overlapping(x: number, y: number, radius: number): Foe | null {
    this.queryX = x;
    this.queryY = y;
    this.queryRadius = radius;
    this.found = null;
    this.foundIndex = -1;
    this.hash.forEachCandidate(x, y, radius, this.visit);
    return this.found;
  }
}
