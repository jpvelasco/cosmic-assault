import type { AsteroidSize } from '../asteroid';
import { pulseAttack, rockRing } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossPhase, BossSetup } from './behaviour';
import { ShardOrbit, type ShardOrbitOptions } from './shardOrbit';

/** How many shards it starts with, least and most. */
export const SHARD_COUNTS = [8, 12] as const;
export const SHARD_HP = 1;
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

/** The Monolith's shards, as a `ShardOrbit` sets them up. */
export const MONOLITH_SHARDS: ShardOrbitOptions = {
  counts: SHARD_COUNTS,
  hp: SHARD_HP,
  radius: SHARD_RADIUS,
  orbit: ORBIT_RADIUS,
  speed: ORBIT_SPEED,
  exposedAt: EXPOSED_AT,
  regrowSeconds: REGROW_SECONDS,
  regrowCap: REGROW_CAP,
};

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
const WINDUPS: Readonly<Record<MonolithAttack, number>> = { shardVolley: 1.2, quake: 0.8, pulse: 0.5 };

/**
 * The Monolith, Dimension 1's boss: a heavy core wrapped in `SHARD_COUNTS` orbiting shards of `SHARD_HP` each, a
 * `ShardOrbit`. While more than `EXPOSED_AT` remain the core deflects every shot; at `EXPOSED_AT` or fewer it is bare,
 * and grows one back every `REGROW_SECONDS`. It throws its shards at the ship and calls them back, quakes rings of small
 * rocks out of itself, and pulses the ship away.
 */
class Monolith implements BossBehaviour {
  readonly driftSpeed = DRIFT_SPEED;
  readonly reach: number;
  readonly parts: readonly BossPart[];
  readonly attacks: Readonly<Record<MonolithAttack, AttackSpec>>;
  private readonly shards: ShardOrbit;

  constructor(setup: BossSetup) {
    const shards = new ShardOrbit(MONOLITH_SHARDS, setup);
    this.shards = shards;
    this.parts = shards.parts;
    this.reach = shards.reach;
    this.attacks = {
      shardVolley: shards.volley(WINDUPS.shardVolley),
      quake: { windup: WINDUPS.quake, active: 0, run: quake },
      pulse: pulseAttack(WINDUPS.pulse, PULSE_SECONDS, PULSE_SPEED, PULSE_REACH),
    };
  }

  vulnerable(): boolean {
    return this.shards.exposed;
  }

  step(ctx: AttackContext): void {
    this.shards.step(ctx);
  }
}

/** Sends a ring of small pass-through rocks out of the core, more in phase 3. */
function quake(ctx: AttackContext): void {
  rockRing(ctx, QUAKE_ROCKS[ctx.boss.phase], QUAKE_SIZE, QUAKE_SPEED);
}

/** The Monolith's behaviour, with its attacks spelled out. */
export type MonolithBehaviour = BossBehaviour & { readonly attacks: Readonly<Record<MonolithAttack, AttackSpec>> };

/** Makes the Monolith for one fight: its shard count and their bearings are drawn from the fight's stream. */
export const createMonolith = (setup: BossSetup): MonolithBehaviour => new Monolith(setup);
