import { ASTEROID } from '../config';
import type { Field } from '../field';
import { type Point, TAU } from '../math';
import { clearSlot } from './attacks';
import type { AttackContext, BossPart, BossPhase, BossSetup, BossView } from './behaviour';
import { bossHome } from './bossRules';

/** A ring of turrets about a boss's core, as a boss's definition of it sets it up. */
export interface TurretRingOptions {
  /** Evenly spaced places round the ring. */
  readonly slots: number;
  /** The slots that never hold a turret: the ring's gaps, which a ship can fly and shoot through. */
  readonly gaps: readonly number[];
  /** How far the slots sit from the core's centre. */
  readonly radius: number;
  readonly turretRadius: number;
  readonly hp: number;
  /** How fast the ring turns in each phase, in radians per second. */
  readonly speeds: Readonly<Record<BossPhase, number>>;
  /** Seconds it takes to grow one broken turret back. */
  readonly regrowSeconds: number;
}

/** Writes into `out` the indices of the `count` live parts nearest (x, y), nearest first, and returns it; fewer if fewer are live. */
export function nearestParts(parts: readonly Readonly<BossPart>[], x: number, y: number, count: number, out: number[]): number[] {
  out.length = 0;
  for (let n = 0; n < count; n++) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as Readonly<BossPart>;
      if (part.hp <= 0 || out.includes(i)) continue;
      const distance = Math.hypot(part.x - x, part.y - y);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    if (best < 0) break;
    out.push(best);
  }
  return out;
}

/**
 * The farthest out a ring of turrets of `turretRadius` about `core` may stretch and stay inside `field`, but never less
 * than its own `radius`: an attack stretching it toward a wall stops short of the wall.
 */
export function stretchRoom(core: Readonly<Point>, field: Field, radius: number, turretRadius: number): number {
  return Math.max(radius, Math.min(core.x, core.y, field.width - core.x, field.height - core.y) - turretRadius);
}

/**
 * A ring of turrets about a boss's core: a turret in every slot but the gaps, each a part of the boss. It turns at its
 * phase's speed and grows a broken turret back every `regrowSeconds`, never in a gap and never near the ship. An attack
 * may turn it at a multiple of that speed (`turn`) or stretch it to another radius (`stretch`, kept inside the field by
 * `stretchRoom`) for the step it runs.
 * Its bearing is drawn from the fight's stream; nothing else is.
 */
export class TurretRing {
  readonly parts: readonly BossPart[];
  /** How far from the core's centre the turrets reach, the ring at its own radius. */
  readonly reach: number;
  /** The bearing of slot 0 from the core; slot k sits k shares of a turn on from it. */
  private spin: number;
  /** The slot each turret sits in, by part index. */
  private readonly slotOf: readonly number[];
  private regrowClock = 0;
  /** What an attack asks of this step, set by its run and spent by `step`: the speed's multiple, and the ring's radius. */
  private speedFactor = 1;
  private radius: number;
  /** Where a regrowing turret would form; one point, reused. */
  private readonly spot: Point = { x: 0, y: 0 };

  /** Draws the ring's bearing from `setup`'s stream, and puts its turrets in their slots about the boss's home. */
  constructor(
    private readonly options: TurretRingOptions,
    setup: BossSetup,
  ) {
    const home = bossHome(setup.field);
    this.spin = setup.rng.range(0, TAU);
    this.radius = options.radius;
    this.slotOf = Array.from({ length: options.slots }, (_, slot) => slot).filter((slot) => !options.gaps.includes(slot));
    this.parts = this.slotOf.map(() => ({ x: 0, y: 0, px: 0, py: 0, radius: options.turretRadius, hp: options.hp, maxHp: options.hp }));
    this.reach = options.radius + options.turretRadius;
    this.placeAll(home.x, home.y);
    for (const part of this.parts) {
      part.px = part.x;
      part.py = part.y;
    }
  }

  /** Turns the ring at `factor` times its phase's speed this step, backward for a negative factor. Called from an attack's run. */
  turn(factor: number): void {
    this.speedFactor = factor;
  }

  /** Holds the ring at `radius` this step. Called from an attack's run. */
  stretch(radius: number): void {
    this.radius = radius;
  }

  /** Turns the ring, grows a turret back in the fight, and puts every turret in its slot; then forgets what the attack asked. */
  step(ctx: AttackContext): void {
    const { boss, dt } = ctx;
    const { radius, turretRadius } = this.options;
    this.spin = (this.spin + this.options.speeds[boss.phase] * this.speedFactor * dt) % TAU;
    this.radius = Math.min(this.radius, stretchRoom(boss, ctx.arena.field(), radius, turretRadius));
    this.regrow(ctx);
    this.placeAll(boss.x, boss.y);
    this.speedFactor = 1;
    this.radius = this.options.radius;
  }

  /** Puts every turret in its slot about (x, y), at the radius in force. */
  private placeAll(x: number, y: number): void {
    const { parts } = this;
    for (let i = 0; i < parts.length; i++) this.place(i, x, y, parts[i] as BossPart);
  }

  /** Writes into `at` where turret `i`'s slot is about (x, y), at the radius in force. */
  private place(i: number, x: number, y: number, at: Point): void {
    const bearing = this.spin + ((this.slotOf[i] ?? 0) * TAU) / this.options.slots;
    at.x = x + Math.cos(bearing) * this.radius;
    at.y = y + Math.sin(bearing) * this.radius;
  }

  /**
   * While it fights with a turret broken, grows the first broken turret back every `regrowSeconds`: the first whose slot
   * lies in the field and outside the ship's safe radius, so none forms on the ship. It waits on, with the clock run
   * down, while none does.
   */
  private regrow(ctx: AttackContext): void {
    const { boss, arena } = ctx;
    if (boss.state !== 'fighting' || !this.anyBroken()) {
      this.regrowClock = 0;
      return;
    }
    this.regrowClock += ctx.dt;
    if (this.regrowClock < this.options.regrowSeconds) return;
    const i = this.growable(boss, arena.ship, arena.field());
    if (i < 0) return;
    const part = this.parts[i] as BossPart;
    part.hp = part.maxHp;
    this.regrowClock = 0;
  }

  private anyBroken(): boolean {
    for (const part of this.parts) if (part.hp <= 0) return true;
    return false;
  }

  /** The first broken turret whose slot is clear to grow in, or -1. */
  private growable(boss: Readonly<BossView>, ship: Readonly<Point>, field: Field): number {
    const { parts, spot } = this;
    for (let i = 0; i < parts.length; i++) {
      if ((parts[i] as BossPart).hp > 0) continue;
      this.place(i, boss.x, boss.y, spot);
      if (clearSlot(spot, field, ship, ASTEROID.safeRadius)) return i;
    }
    return -1;
  }
}
