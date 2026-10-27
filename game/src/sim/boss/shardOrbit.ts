import { smoothstep, TAU } from '../math';
import type { AttackContext, AttackSpec, BossPart, BossSetup, BossView } from './behaviour';
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
}

/** Shards a volley throws, at most. */
const VOLLEY_SHARDS = 3;
/** Seconds a volley's shards take out to their turning point and back. */
const VOLLEY_SECONDS = 1.8;
/** How far apart the volley's lanes are, across its line of flight. */
const VOLLEY_SPREAD = 46;
/** How far past the aim the shards fly before they turn back. */
const VOLLEY_OVERSHOOT = 70;

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
  private flight = 0;
  /** Each shard's lane in the volley under way, -1 to 1 across the line of flight; NaN for a shard on its orbit. */
  private readonly lanes: number[];
  /** The shards the volley under way throws, left to right. */
  private readonly thrown: number[] = [];

  constructor(
    private readonly options: ShardOrbitOptions,
    setup: BossSetup,
  ) {
    const count = setup.rng.int(options.counts[0], options.counts[1] + 1);
    this.spin = setup.rng.range(0, TAU);
    this.parts = Array.from({ length: count }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: options.radius, hp: options.hp, maxHp: options.hp }));
    this.reach = options.orbit + options.radius;
    this.lanes = this.parts.map(() => Number.NaN);
    const home = bossHome(setup.field);
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
    return { windup, active: VOLLEY_SECONDS, run: (ctx) => { this.throwVolley(ctx); }, threat: { kind: 'lane', reach: VOLLEY_SPREAD + this.options.radius } };
  }

  /** Turns the orbit, grows a shard back on a bare core, and puts every shard where it is: on its orbit or in flight. */
  step(ctx: AttackContext): void {
    const { boss, dt } = ctx;
    this.spin = (this.spin + this.options.speed * dt) % TAU;
    if (boss.active !== 'shardVolley') this.lanes.fill(Number.NaN);
    this.regrow(boss, dt);
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
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as BossPart;
      const bearing = this.spin + (i / parts.length) * TAU;
      part.x = x + Math.cos(bearing) * this.options.orbit;
      part.y = y + Math.sin(bearing) * this.options.orbit;
    }
  }

  /** While the core is bare, a broken shard grows back on its orbit every `regrowSeconds`; the wait starts afresh each time it is laid bare. */
  private regrow(boss: Readonly<BossView>, dt: number): void {
    if (boss.state !== 'fighting' || !boss.vulnerable) {
      this.regrowClock = 0;
      return;
    }
    this.regrowClock += dt;
    if (this.regrowClock < this.options.regrowSeconds || this.live() >= this.options.regrowCap) return;
    this.regrowClock = 0;
    const i = this.parts.findIndex((part) => part.hp <= 0);
    const part = this.parts[i];
    if (part === undefined) return;
    part.hp = part.maxHp;
    // A shard broken in flight grows back on its orbit, out of the volley that threw it.
    this.lanes[i] = Number.NaN;
  }

  /** Throws up to three shards out past where the ship was and back, each in its own lane. */
  private throwVolley(ctx: AttackContext): void {
    if (ctx.age === 0) this.pickVolley(ctx);
    this.flight = Math.min(1, (ctx.age + ctx.dt) / VOLLEY_SECONDS);
  }

  /** Lanes the live shards nearest the aim by bearing from the core, left to right across the line of flight. */
  private pickVolley(ctx: AttackContext): void {
    const { boss } = ctx;
    const { parts, thrown } = this;
    const aim = Math.atan2(ctx.aimY - boss.y, ctx.aimX - boss.x);
    thrown.length = 0;
    for (let n = 0; n < VOLLEY_SHARDS; n++) {
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
    const dx = ctx.aimX - ctx.fromX;
    const dy = ctx.aimY - ctx.fromY;
    const length = Math.hypot(dx, dy);
    const ux = length > 0 ? dx / length : 0;
    const uy = length > 0 ? dy / length : 1;
    const tx = ctx.aimX + ux * VOLLEY_OVERSHOOT - uy * lane * VOLLEY_SPREAD;
    const ty = ctx.aimY + uy * VOLLEY_OVERSHOOT + ux * lane * VOLLEY_SPREAD;
    // Out to the turning point over the first half, then back to its orbit, wherever that has turned to.
    const out = this.flight < 0.5;
    const s = out ? smoothstep(this.flight * 2) : 1 - smoothstep(this.flight * 2 - 1);
    part.x += (tx - part.x) * s;
    part.y += (ty - part.y) * s;
  }
}
