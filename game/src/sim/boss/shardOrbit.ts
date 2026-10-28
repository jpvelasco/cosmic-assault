import { clamp } from '../../content/curves';
import { outAndBack, type Point, TAU } from '../math';
import type { AttackContext, AttackSpec, BossPart, BossSetup, BossView } from './behaviour';
import { clearSlot } from './attacks';
import { bossHome } from './bossRules';

/** A ring of shards orbiting a boss's core, as a boss's definition of it sets it up. */
export interface ShardOrbitOptions {
  /** How many shards it starts with, least and most. */
  readonly counts: readonly [number, number];
  readonly hp: number;
  readonly radius: number;
  /** How far the shards orbit from the core's centre. */
  readonly orbit: number;
  /** Radians per second. */
  readonly speed: number;
  /** The core is bare, and can be hurt, with this many shards or fewer. */
  readonly exposedAt: number;
  /** Seconds a bare core takes to grow a shard back. */
  readonly regrowSeconds: number;
  /** It never grows back past this many shards. */
  readonly regrowCap: number;
  /** How its shard volley flies; the Monolith's if absent. */
  readonly volley?: VolleyShape;
  /** Whether a shard's turning point is held inside the field, so a shard thrown past a wall stays where the ship can strike it. */
  readonly keepInField?: boolean;
  /** How far from the ship a regrowing shard's slot must lie, so a shard never grows in on it; any slot if absent. */
  readonly growClearance?: number;
}

/** How a shard volley flies. */
export interface VolleyShape {
  /** Shards a volley throws, at most. */
  readonly shards: number;
  /** Seconds the shards take out to their turning point and back. */
  readonly seconds: number;
  /** How far apart the lanes are, across the line of flight. */
  readonly spread: number;
  /** How far past the aim the shards fly before they turn back. */
  readonly overshoot: number;
}

/** The Monolith's volley: three shards, out and back in 1.8 s, in lanes 46 apart, turning 70 past the aim. */
export const MONOLITH_VOLLEY: VolleyShape = { shards: 3, seconds: 1.8, spread: 46, overshoot: 70 };

/** How far round from bearing `aim` a part sits about the core, in radians from -π to π. */
function offsetFrom(aim: number, part: Readonly<BossPart>, boss: Readonly<BossView>): number {
  const d = Math.atan2(part.y - boss.y, part.x - boss.x) - aim;
  return d - Math.round(d / TAU) * TAU;
}

/**
 * Everything a boss does with orbiting shards: their orbit, the threshold at which they lay its core bare, regrowing
 * them while it is bare, and throwing them at the ship in a volley (the boss's `shardVolley`). The shards are the
 * boss's parts, the same objects for the whole fight; their count and bearings are drawn from the fight's stream.
 */
export class ShardOrbit {
  readonly parts: readonly BossPart[];
  /** How far from the core's centre the shards reach. */
  readonly reach: number;
  /** The bearing of shard 0 from the core; shard i sits i shares of a turn on from it. */
  private spin: number;
  private regrowClock = 0;
  /** How far through the volley under way, 0 to 1. */
  private progress = 0;
  /** Each shard's lane in the volley under way, -1 to 1 across the line of flight; NaN for a shard on its orbit. */
  private readonly lanes: number[];
  /** The shards the volley under way throws, left to right. */
  private readonly thrown: number[] = [];
  /** Where a regrowing shard's slot is; one point, reused. */
  private readonly slot: Point = { x: 0, y: 0 };

  /** How its volley flies. */
  private readonly shape: VolleyShape;

  /** Draws the shards' count and bearings from `setup`'s stream, and puts them on their orbit about `home`. */
  constructor(
    private readonly options: ShardOrbitOptions,
    setup: BossSetup,
    home: Readonly<Point> = bossHome(setup.field),
  ) {
    this.shape = options.volley ?? MONOLITH_VOLLEY;
    const count = setup.rng.int(options.counts[0], options.counts[1] + 1);
    this.spin = setup.rng.range(0, TAU);
    this.parts = Array.from({ length: count }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: options.radius, hp: options.hp, maxHp: options.hp }));
    this.reach = options.orbit + options.radius;
    this.lanes = this.parts.map(() => Number.NaN);
    this.placeAll(home.x, home.y);
    for (const part of this.parts) {
      part.px = part.x;
      part.py = part.y;
    }
  }

  /** Whether the core is bare: `exposedAt` shards or fewer are left. */
  get exposed(): boolean {
    return this.live() <= this.options.exposedAt;
  }

  /** The shard volley, telegraphed for `windup` s: lanes as wide as the spread plus a shard either side of its line. */
  volley(windup: number): AttackSpec {
    // The outermost lane sits half the lanes' span from the aim, a shard's radius beyond it.
    const outer = ((this.shape.shards - 1) / 2) * this.shape.spread + this.options.radius;
    return { windup, active: this.shape.seconds, run: (ctx) => { this.throwVolley(ctx); }, threat: { kind: 'lane', reach: outer } };
  }

  /** Turns the orbit, grows a shard back on a bare core, and puts every shard where it is: on its orbit or in flight. */
  step(ctx: AttackContext): void {
    const { boss, dt } = ctx;
    this.spin = (this.spin + this.options.speed * dt) % TAU;
    if (boss.active !== 'shardVolley') this.lanes.fill(Number.NaN);
    this.regrow(ctx);
    this.placeAll(boss.x, boss.y);
    for (let i = 0; i < this.parts.length; i++) {
      const lane = this.lanes[i] ?? Number.NaN;
      if (!Number.isNaN(lane)) this.fly(ctx, lane, this.parts[i] as BossPart);
    }
  }

  private live(): number {
    let live = 0;
    for (const part of this.parts) if (part.hp > 0) live++;
    return live;
  }

  /** Puts every shard on its orbit around (x, y). */
  private placeAll(x: number, y: number): void {
    const { parts } = this;
    for (let i = 0; i < parts.length; i++) this.slotOf(i, x, y, parts[i] as BossPart);
  }

  /**
   * While the core is bare, a broken shard grows back on its orbit every `regrowSeconds`; the wait starts afresh each time
   * it is laid bare. The shard grows in on the first broken slot clear of the ship (`growClearance`), and while every
   * broken slot lies too near it, the regrowth waits.
   */
  private regrow(ctx: AttackContext): void {
    const { boss, dt } = ctx;
    if (boss.state !== 'fighting' || !boss.vulnerable) {
      this.regrowClock = 0;
      return;
    }
    this.regrowClock += dt;
    if (this.regrowClock < this.options.regrowSeconds || this.live() >= this.options.regrowCap) return;
    const i = this.growable(ctx);
    if (i < 0) return;
    this.regrowClock = 0;
    const part = this.parts[i] as BossPart;
    part.hp = part.maxHp;
    // A shard broken in flight grows back on its orbit, out of the volley that threw it.
    this.lanes[i] = Number.NaN;
  }

  /** The first broken shard whose slot on the orbit is clear of the ship, or -1 with none. */
  private growable(ctx: AttackContext): number {
    const { boss, arena } = ctx;
    const clearance = this.options.growClearance;
    const field = arena.field();
    for (let i = 0; i < this.parts.length; i++) {
      if ((this.parts[i] as BossPart).hp > 0) continue;
      if (clearance === undefined) return i;
      this.slotOf(i, boss.x, boss.y, this.slot);
      if (clearSlot(this.slot, field, arena.ship, clearance)) return i;
    }
    return -1;
  }

  /** Writes into `out` where shard `i`'s slot on the orbit about (x, y) is, and returns it. */
  private slotOf(i: number, x: number, y: number, out: Point): Point {
    const bearing = this.spin + (i / this.parts.length) * TAU;
    out.x = x + Math.cos(bearing) * this.options.orbit;
    out.y = y + Math.sin(bearing) * this.options.orbit;
    return out;
  }

  /** Throws up to its volley's count of shards out past where the ship was and back, each in its own lane. */
  private throwVolley(ctx: AttackContext): void {
    if (ctx.age === 0) this.pickVolley(ctx);
    this.progress = Math.min(1, (ctx.age + ctx.dt) / this.shape.seconds);
  }

  /** Lanes the live shards nearest the aim by bearing from the core, left to right across the line of flight. */
  private pickVolley(ctx: AttackContext): void {
    const { boss } = ctx;
    const { parts, thrown } = this;
    const aim = Math.atan2(ctx.boss.aim.y - boss.y, ctx.boss.aim.x - boss.x);
    thrown.length = 0;
    for (let n = 0; n < this.shape.shards; n++) {
      let best = -1;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as BossPart;
        if (part.hp <= 0 || thrown.includes(i)) continue;
        if (best < 0 || Math.abs(offsetFrom(aim, part, boss)) < Math.abs(offsetFrom(aim, parts[best] as BossPart, boss))) best = i;
      }
      if (best < 0) break;
      thrown.push(best);
    }
    thrown.sort((a, b) => offsetFrom(aim, parts[a] as BossPart, boss) - offsetFrom(aim, parts[b] as BossPart, boss));
    for (let rank = 0; rank < thrown.length; rank++) this.lanes[thrown[rank] as number] = rank - (thrown.length - 1) / 2;
  }

  /** Moves a shard in flight from its orbit out to its lane's turning point and back, easing at both ends. */
  private fly(ctx: AttackContext, lane: number, part: BossPart): void {
    const dx = ctx.boss.aim.x - ctx.fromX;
    const dy = ctx.boss.aim.y - ctx.fromY;
    const length = Math.hypot(dx, dy);
    const ux = length > 0 ? dx / length : 0;
    const uy = length > 0 ? dy / length : 1;
    const { overshoot, spread } = this.shape;
    let tx = ctx.boss.aim.x + ux * overshoot - uy * lane * spread;
    let ty = ctx.boss.aim.y + uy * overshoot + ux * lane * spread;
    if (this.options.keepInField === true) {
      const field = ctx.arena.field();
      tx = clamp(tx, part.radius, field.width - part.radius);
      ty = clamp(ty, part.radius, field.height - part.radius);
    }
    // Out to the turning point over the first half, then back to its orbit, wherever that has turned to.
    const s = outAndBack(this.progress);
    part.x += (tx - part.x) * s;
    part.y += (ty - part.y) * s;
  }
}
