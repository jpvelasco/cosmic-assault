import { clamp } from '../../content/curves';
import type { AsteroidSize } from '../asteroid';
import { TAU } from '../math';
import { rockRing } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossPhase, BossSetup, BossView } from './behaviour';
import { bossHome } from './bossRunner';

/** How many shards it starts with, least and most. */
export const SHARD_COUNTS = [8, 12] as const;
export const SHARD_HP = 2;
export const SHARD_RADIUS = 15;
/** How far the shards orbit from the core's centre. */
export const ORBIT_RADIUS = 118;
/** Radians per second. */
export const ORBIT_SPEED = 0.6;
/** The core is bare, and can be hurt, with this many shards or fewer. */
export const EXPOSED_AT = 3;
/** Seconds a bare core takes to grow a shard back. */
export const REGROW_SECONDS = 6;
/** It never grows back past this many shards. Regrowth stops once the core is shielded, at four, well short of it. */
export const REGROW_CAP = 6;
const DRIFT_SPEED = 12;

/** Shards a volley throws, at most. */
const VOLLEY_SHARDS = 3;
/** Seconds a volley's shards take out to their turning point and back. */
const VOLLEY_SECONDS = 1.8;
/** How far apart the volley's lanes are, across its line of flight. */
const VOLLEY_SPREAD = 46;
/** How far past the aim the shards fly before they turn back. */
const VOLLEY_OVERSHOOT = 70;

/** Rocks in a quake's ring, by phase (it quakes only from phase 2). */
const QUAKE_ROCKS: Readonly<Record<BossPhase, number>> = { 1: 8, 2: 8, 3: 10 };
const QUAKE_SIZE: AsteroidSize = 2;
const QUAKE_SPEED = 1.2;

/** How long the pulse's shockwave is on show; the shove itself lands on its first step. */
const PULSE_SECONDS = 0.3;
/** The shove on a ship at the core's rim, in units per second, fading to none `PULSE_REACH` beyond it. */
const PULSE_SPEED = 260;
const PULSE_REACH = 320;

export type MonolithAttack = 'shardVolley' | 'quake' | 'pulse';

/** The Monolith's windups, in seconds. */
const MONOLITH_WINDUPS: Readonly<Record<MonolithAttack, number>> = { shardVolley: 0.6, quake: 0.8, pulse: 0.5 };

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** How far round from bearing `aim` a part sits about the core, in radians from -π to π. */
function offsetFrom(aim: number, part: Readonly<BossPart>, boss: Readonly<BossView>): number {
  const d = Math.atan2(part.y - boss.y, part.x - boss.x) - aim;
  return d - Math.round(d / TAU) * TAU;
}

/**
 * The Monolith, Dimension 1's boss: a heavy core wrapped in 8 to 12 orbiting shards of 2 HP each. While four or more
 * remain the core deflects every shot; at three or fewer it is bare, and grows one back every 6 s. It throws its shards
 * at the ship and calls them back, quakes rings of small rocks out of itself, and pulses the ship away.
 */
class Monolith implements BossBehaviour {
  readonly driftSpeed = DRIFT_SPEED;
  readonly reach = ORBIT_RADIUS + SHARD_RADIUS;
  readonly parts: readonly BossPart[];
  readonly attacks: Readonly<Record<MonolithAttack, AttackSpec>> = {
    shardVolley: { windup: MONOLITH_WINDUPS.shardVolley, active: VOLLEY_SECONDS, run: (ctx) => { this.volley(ctx); } },
    quake: { windup: MONOLITH_WINDUPS.quake, active: 0, run: (ctx) => { rockRing(ctx, QUAKE_ROCKS[ctx.boss.phase], QUAKE_SIZE, QUAKE_SPEED); } },
    pulse: { windup: MONOLITH_WINDUPS.pulse, active: PULSE_SECONDS, run: pulse },
  };

  /** The bearing of shard 0 from the core; shard i sits i shares of a turn on from it. */
  private spin: number;
  private regrowClock = 0;
  /** How far through the volley under way, 0 to 1. */
  private flight = 0;
  /** Each shard's lane in the volley under way, -1 to 1 across the line of flight; NaN for a shard on its orbit. */
  private readonly lanes: number[];
  /** The shards the volley under way throws, left to right. */
  private readonly thrown: number[] = [];

  constructor(setup: BossSetup) {
    const count = setup.rng.int(SHARD_COUNTS[0], SHARD_COUNTS[1] + 1);
    this.spin = setup.rng.range(0, TAU);
    this.parts = Array.from({ length: count }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: SHARD_RADIUS, hp: SHARD_HP, maxHp: SHARD_HP }));
    this.lanes = this.parts.map(() => Number.NaN);
    const home = bossHome(setup.field);
    this.placeAll(home.x, home.y);
    for (const part of this.parts) {
      part.px = part.x;
      part.py = part.y;
    }
  }

  vulnerable(): boolean {
    return this.live() <= EXPOSED_AT;
  }

  /** Turns the orbit, grows a shard back on a bare core, and puts every shard where it is: on its orbit or in flight. */
  step(ctx: AttackContext): void {
    const { boss, dt } = ctx;
    this.spin = (this.spin + ORBIT_SPEED * dt) % TAU;
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
      part.x = x + Math.cos(bearing) * ORBIT_RADIUS;
      part.y = y + Math.sin(bearing) * ORBIT_RADIUS;
    }
  }

  /** While the core is bare, a broken shard grows back on its orbit every 6 s; the wait starts afresh each time it is laid bare. */
  private regrow(boss: Readonly<BossView>, dt: number): void {
    if (boss.state !== 'fighting' || !boss.vulnerable) {
      this.regrowClock = 0;
      return;
    }
    this.regrowClock += dt;
    if (this.regrowClock < REGROW_SECONDS || this.live() >= REGROW_CAP) return;
    this.regrowClock = 0;
    const i = this.parts.findIndex((part) => part.hp <= 0);
    const part = this.parts[i];
    if (part === undefined) return;
    part.hp = part.maxHp;
    // A shard broken in flight grows back on its orbit, out of the volley that threw it.
    this.lanes[i] = Number.NaN;
  }

  /** Throws up to three shards out past where the ship was and back, each in its own lane. */
  private volley(ctx: AttackContext): void {
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
    const s = out ? smooth(this.flight * 2) : 1 - smooth(this.flight * 2 - 1);
    part.x += (tx - part.x) * s;
    part.y += (ty - part.y) * s;
  }
}

/** Shoves the ship straight away from the core once, hardest at its rim and fading to nothing 320 units beyond it. */
function pulse(ctx: AttackContext): void {
  if (ctx.age !== 0) return;
  const { boss } = ctx;
  const { ship } = ctx.arena;
  const dx = ship.x - boss.x;
  const dy = ship.y - boss.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const speed = PULSE_SPEED * clamp(1 - (distance - boss.radius) / PULSE_REACH, 0, 1);
  ctx.shoveX = (dx / distance) * speed;
  ctx.shoveY = (dy / distance) * speed;
}

/** The Monolith's behaviour, with its attacks spelled out. */
export type MonolithBehaviour = BossBehaviour & { readonly attacks: Readonly<Record<MonolithAttack, AttackSpec>> };

/** Makes the Monolith for one fight: its shard count and their bearings are drawn from the fight's stream. */
export const createMonolith = (setup: BossSetup): MonolithBehaviour => new Monolith(setup);
