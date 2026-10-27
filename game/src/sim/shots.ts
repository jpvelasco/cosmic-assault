import { clamp } from '../content/curves';
import type { Point } from './boss/behaviour';
import { HOMING, PROJECTILE } from './config';
import type { SimEvent } from './events';
import type { Field } from './field';
import { removeFlagged, resetFlags } from './flagged';
import { turnBetween } from './math';
import { wingmanShot } from './pickups/wingman';
import { FOE_DEFLECTED } from './foes/foeField';
import { projectileFromShot, stepProjectile, type Projectile } from './projectile';
import type { Ship, Shot } from './ship';
import { wrapDelta } from './wrap';

/** What the player's shots carry while effects run. */
export interface ShotRules {
  /** How many rocks and foes each shot passes through before the next one stops it; 0 for none. */
  readonly pierce: number;
  /** Every this-many-th player projectile homes, the Wingman's included; 0 while none does. */
  readonly homingEvery: number;
  /** Whether the Wingman fires a shot of its own with each volley. */
  readonly wingman: boolean;
}

/** What the player's shots can seek and strike: the World's rocks, and its ruleset's foes and boss. */
export interface ShotTargets {
  readonly rocks: readonly Readonly<Point & { readonly id: number }>[];
  foes(): readonly Readonly<Point & { readonly id: number; readonly hp: number }>[];
  /** Where a shot harms the boss now (`bossTarget`), or null. */
  aim(): Readonly<Point> | null;
  /** A shot at (x, y) has reached the boss, core or part, if true: it is spent, however much it pierces. */
  hitBoss(x: number, y: number, radius: number): boolean;
  /** The id of the foe a shot at (x, y) struck, never one in `struck`; -1 for none, or `FOE_DEFLECTED` when a foe's armour spent it. */
  hitFoe(x: number, y: number, radius: number, struck: readonly number[]): number;
  /** The id of the rock a shot at (x, y) broke, or -1. */
  hitRock(x: number, y: number, radius: number): number;
}

/**
 * The player's projectiles: fired from the ship's volley (and the Wingman's shot beside it), moved, steered if they
 * home, and struck against the boss, the foes and the rocks. A plain shot is spent on the first thing it strikes; a
 * piercing one passes through rocks and foes, each at most once, until its pierces run out.
 */
export class PlayerShots {
  /** Live; mutated in place. */
  readonly list: Projectile[] = [];
  private readonly spent: boolean[] = [];
  /** Projectiles fired since Homing Missiles started; every `homingEvery`-th homes. */
  private sinceHoming = 0;
  /** The nearest target the running `steer` has found, as an offset from the shot. */
  private seekX = 0;
  private seekY = 0;
  private seekD2 = 0;

  constructor(
    private readonly events: SimEvent[],
    private readonly nextId: () => number,
  ) {}

  /** Turns this step's volley into projectiles under `rules`, the Wingman's shot after the ship's. Call it every step, volley or not. */
  fire(shots: readonly Shot[], ship: Readonly<Ship>, rules: ShotRules | null): void {
    if (rules === null || rules.homingEvery === 0) this.sinceHoming = 0;
    if (shots.length === 0) return;
    for (const shot of shots) this.add(shot, rules);
    if (rules?.wingman === true) this.add(wingmanShot(ship), rules);
  }

  /** Stores every projectile's position before it moves, for interpolated drawing. */
  remember(): void {
    for (const p of this.list) {
      p.px = p.x;
      p.py = p.y;
    }
  }

  /** Steers the homing projectiles, then moves, ages and wraps every one, dropping the expired. */
  move(dt: number, field: Field, targets: ShotTargets): void {
    const { list, spent } = this;
    resetFlags(spent, list.length);
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Projectile;
      if (p.homing) this.steer(p, dt, field, targets);
      spent[i] = !stepProjectile(p, dt, field);
    }
    removeFlagged(list, spent);
  }

  /** Each projectile, newest first, strikes at most one thing this step: the boss, else a foe, else a rock. */
  collide(targets: ShotTargets): void {
    const { list, spent } = this;
    resetFlags(spent, list.length);
    const r = PROJECTILE.radius;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Projectile;
      if (targets.hitBoss(p.x, p.y, r)) {
        spent[i] = true;
        continue;
      }
      let id = targets.hitFoe(p.x, p.y, r, p.struck);
      if (id === FOE_DEFLECTED) {
        spent[i] = true;
        continue;
      }
      if (id < 0) id = targets.hitRock(p.x, p.y, r);
      if (id < 0) continue;
      if (p.pierce > 0) {
        p.pierce--;
        p.struck.push(id);
      } else {
        spent[i] = true;
      }
    }
    removeFlagged(list, spent);
  }

  private add(shot: Shot, rules: ShotRules | null): void {
    let homing = false;
    if (rules !== null && rules.homingEvery > 0 && ++this.sinceHoming >= rules.homingEvery) {
      this.sinceHoming = 0;
      homing = true;
    }
    this.list.push(projectileFromShot(shot, this.nextId(), rules?.pierce ?? 0, homing));
    this.events.push({ type: 'shot', x: shot.x, y: shot.y });
  }

  /**
   * Turns `p` toward the nearest target within `HOMING.range` and `HOMING.cone` of its heading, keeping its speed. A
   * piercing shot passes over what it has already struck, which it can no longer hurt.
   */
  private steer(p: Projectile, dt: number, field: Field, targets: ShotTargets): void {
    const heading = Math.atan2(p.vy, p.vx);
    this.seekD2 = HOMING.range * HOMING.range;
    let found = false;
    for (const rock of targets.rocks) if (!p.struck.includes(rock.id)) found = this.consider(p, heading, field, rock) || found;
    for (const foe of targets.foes()) if (foe.hp > 0 && !p.struck.includes(foe.id)) found = this.consider(p, heading, field, foe) || found;
    const aim = targets.aim();
    if (aim !== null) found = this.consider(p, heading, field, aim) || found;
    if (!found) return;
    const most = HOMING.turnRate * dt;
    const turn = clamp(turnBetween(heading, Math.atan2(this.seekY, this.seekX)), -most, most);
    const speed = Math.hypot(p.vx, p.vy);
    p.vx = Math.cos(heading + turn) * speed;
    p.vy = Math.sin(heading + turn) * speed;
  }

  /** Keeps `at` as the target if it is nearer than the best so far, across the wrap, and inside the cone; true if it did. */
  private consider(p: Projectile, heading: number, field: Field, at: Readonly<Point>): boolean {
    const dx = wrapDelta(at.x - p.x, field.width);
    const dy = wrapDelta(at.y - p.y, field.height);
    const d2 = dx * dx + dy * dy;
    if (d2 >= this.seekD2 || Math.abs(turnBetween(heading, Math.atan2(dy, dx))) > HOMING.cone) return false;
    this.seekD2 = d2;
    this.seekX = dx;
    this.seekY = dy;
    return true;
  }
}
