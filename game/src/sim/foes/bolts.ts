import { BOLT } from '../../content/foes';
import type { FoeKind } from '../../content/types';
import { hasLeftField } from '../asteroid';
import { circlesOverlap } from '../collision';
import type { Field } from '../field';
import type { Arena } from '../rules';
import { overlapsAcrossWrap, rescalePose } from '../wrap';

/** What fired a bolt: a boss, or a foe of that kind. */
export type BoltSource = 'boss' | FoeKind;

/** A hostile bolt on the field. Pooled: a spent bolt's object is reused for a later one, so never hold one across steps. */
export interface Bolt {
  /** Shared with every other entity, from `Arena.nextId`. */
  id: number;
  x: number;
  y: number;
  /** Position before the latest step, for interpolated drawing. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  /** Seconds it has flown, in the enemies' time. */
  age: number;
  source: BoltSource;
  /** The id of the foe that fired it, or 0 for a boss's. */
  owner: number;
  /** True for a bolt a boss's attack fired, marked as it is made: the bots judge it on that attack's telegraph. */
  fromAttack: boolean;
}

/**
 * The hostile bolts on a galaxy's field, from a pool made once, so firing and spending them allocates nothing. A bolt
 * flies straight, passes out of the field instead of wrapping, and is gone after `BOLT.life` seconds of its own time.
 */
export class Bolts {
  private readonly live: Bolt[] = [];
  private readonly spare: Bolt[];

  constructor(
    private readonly arena: Pick<Arena, 'events' | 'field' | 'nextId'>,
    capacity: number = BOLT.capacity,
  ) {
    this.spare = Array.from({ length: capacity }, () => ({ id: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, radius: BOLT.radius, age: 0, source: 'boss', owner: 0, fromAttack: false }));
  }

  /** The bolts on the field, in the order they were fired; live, and mutated in place. */
  get list(): readonly Bolt[] {
    return this.live;
  }

  /**
   * Fires a bolt from (x, y) along `angle` at `speed`, announced with `boltFired`; null, and nothing fired, with the
   * pool full. `owner` is the id of the foe firing it, 0 for a boss.
   */
  fire(x: number, y: number, angle: number, speed: number, source: BoltSource, owner = 0): Bolt | null {
    const bolt = this.spare.pop();
    if (bolt === undefined) return null;
    bolt.id = this.arena.nextId();
    bolt.x = bolt.px = x;
    bolt.y = bolt.py = y;
    bolt.vx = Math.cos(angle) * speed;
    bolt.vy = Math.sin(angle) * speed;
    bolt.age = 0;
    bolt.source = source;
    bolt.owner = owner;
    bolt.fromAttack = false;
    this.live.push(bolt);
    this.arena.events.push({ type: 'boltFired', id: bolt.id, source, owner, x, y, angle });
    return bolt;
  }

  /** Moves every bolt `dt` seconds on, taking off those out of their life or out of the field. */
  step(dt: number): void {
    const field = this.arena.field();
    let kept = 0;
    for (const bolt of this.live) {
      bolt.px = bolt.x;
      bolt.py = bolt.y;
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
      bolt.age += dt;
      if (bolt.age < BOLT.life && !hasLeftField(bolt, field)) this.live[kept++] = bolt;
      else this.spare.push(bolt);
    }
    this.live.length = kept;
  }

  /** True when a bolt overlaps the circle at (x, y): the first that does is spent. */
  strikes(x: number, y: number, radius: number): boolean {
    const { live } = this;
    for (let i = 0; i < live.length; i++) {
      const bolt = live[i] as Bolt;
      if (!circlesOverlap(x, y, radius, bolt.x, bolt.y, bolt.radius)) continue;
      this.spare.push(bolt);
      live.copyWithin(i, i + 1);
      live.length--;
      return true;
    }
    return false;
  }

  /** Takes off every bolt the circle at (x, y) reaches across the wrap, as a blast measures it. */
  clearWithin(x: number, y: number, radius: number): void {
    const field = this.arena.field();
    let kept = 0;
    for (const bolt of this.live) {
      if (overlapsAcrossWrap(field, x, y, radius, bolt.x, bolt.y, bolt.radius)) this.spare.push(bolt);
      else this.live[kept++] = bolt;
    }
    this.live.length = kept;
  }

  /** Takes every bolt off the field. */
  clear(): void {
    this.spare.push(...this.live);
    this.live.length = 0;
  }

  /** Stretches every bolt's place to the new field, like the World's other entities. */
  resize(old: Field, field: Field): void {
    for (const bolt of this.live) rescalePose(bolt, old, field);
  }
}
