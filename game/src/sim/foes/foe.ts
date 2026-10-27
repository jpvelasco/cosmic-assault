import { FOES } from '../../content/foes';
import type { FoeKind } from '../../content/types';
import type { Field } from '../field';
import type { Rng } from '../rng';
import type { Arena } from '../rules';
import type { Bolts } from './bolts';

/** A foe on the field. Pooled: a spent foe's object is reused for a later one, so never hold one across steps. */
export interface Foe {
  /** Shared with asteroids and projectiles, from `Arena.nextId`. */
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position and rotation before the latest step, for interpolated drawing; not wrap-adjusted. */
  px: number;
  py: number;
  rotation: number;
  protation: number;
  spin: number;
  radius: number;
  /** Hit points left; a foe at 0 or less is spent and is swept out of the pool. */
  hp: number;
  /** True for a foe a boss's attack launched, marked as it is made: the bots judge it on that attack's telegraph. */
  fromAttack: boolean;
  /** Seconds until its next move: a gunship's next windup or shot, an armed mine's blast; unused by the others. */
  timer: number;
  /** True while its telegraphed attack winds up: a gunship aiming, or a mine armed and counting down. */
  charging: boolean;
  /** Where a winding-up gunship will fire (where the ship was as its windup began), or where a phaser will blink to. */
  aimX: number;
  aimY: number;
  /** Which way round the ship a gunship circles: 1 or -1. */
  orbit: 1 | -1;
}

/** What a foe's behaviour sees of the field it is in. */
export interface FoeWorld {
  readonly arena: Arena;
  /** The foes on the field, the one stepping included; live. */
  readonly list: readonly Foe[];
  /** The 'foes' stream. */
  readonly rng: Rng;
  /** A foe of `kind` with its HP and radius set, or null with the pool full; set its motion, then `commit` it. */
  acquire(kind: FoeKind): Foe | null;
  /** Puts an acquired foe on the field where it stands and announces it. */
  commit(foe: Foe): void;
  /** The galaxy's hostile bolts, which a gunship fires; null where none are given. */
  readonly bolts: Bolts | null;
  /** Sets `foe` off: it is destroyed for 0 points, and its blast of `radius` strikes a ship it reaches this step. */
  detonate(foe: Foe, radius: number): void;
}

/** One kind of foe: how it arrives, how it moves, and what it leaves behind. */
export interface FoeBehaviour {
  /** Brings in `count` foes (`speedMultiplier` is the galaxy's rock speed-up). */
  spawn(world: FoeWorld, count: number, speedMultiplier: number): void;
  /** Moves the foe one step. */
  step(foe: Foe, dt: number, field: Field, world: FoeWorld): void;
  /** The foe was destroyed in play (not cleared by the warp): leave anything behind. */
  destroyed?(foe: Readonly<Foe>, world: FoeWorld): void;
  /** Whether a shot at (x, y) is turned aside by the foe rather than striking it: its armour. Judged before any harm is done. */
  deflects?(foe: Readonly<Foe>, x: number, y: number): boolean;
}

/** Foes made once and reused, so a galaxy of spawns and kills allocates none. */
export class FoePool {
  /** The foes on the field, in the order they arrived; live, and mutated in place. */
  readonly live: Foe[] = [];
  private readonly spare: Foe[];

  constructor(capacity: number) {
    this.spare = Array.from({ length: capacity }, () => ({
      id: 0, kind: 'splitter', x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, rotation: 0, protation: 0, spin: 0, radius: 0, hp: 0, fromAttack: false,
      timer: 0, charging: false, aimX: 0, aimY: 0, orbit: 1,
    }));
  }

  /** A fresh foe of `kind` with its HP and radius, not yet on the field; null with every foe in use. */
  acquire(kind: FoeKind, id: number): Foe | null {
    const foe = this.spare.pop();
    if (foe === undefined) return null;
    const { radius, hp } = FOES[kind];
    foe.id = id;
    foe.kind = kind;
    foe.radius = radius;
    foe.hp = hp;
    foe.vx = foe.vy = foe.spin = foe.timer = foe.aimX = foe.aimY = 0;
    foe.fromAttack = foe.charging = false;
    foe.orbit = 1;
    return foe;
  }

  /** Puts an acquired foe on the field. */
  add(foe: Foe): void {
    this.live.push(foe);
  }

  /** Takes the spent foes (HP 0 or less) off the field, keeping the rest in order. */
  sweep(): void {
    let kept = 0;
    for (const foe of this.live) {
      if (foe.hp > 0) this.live[kept++] = foe;
      else this.spare.push(foe);
    }
    this.live.length = kept;
  }

  /** Takes every foe off the field. */
  clear(): void {
    this.spare.push(...this.live);
    this.live.length = 0;
  }

  /** What the foes on the field weigh on the threat budget. */
  get cost(): number {
    let cost = 0;
    for (const foe of this.live) cost += FOES[foe.kind].cost;
    return cost;
  }
}
