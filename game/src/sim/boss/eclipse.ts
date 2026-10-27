import type { AsteroidSize } from '../asteroid';
import { dashAttack, launchDrones, pulseAttack, rockRingAttack, turnToward, turretVolleyAttack } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossPhase, BossSetup } from './behaviour';
import { ShardOrbit, type ShardOrbitOptions, type VolleyShape } from './shardOrbit';

/** Its corona: shards of this radius and HP, on an orbit of `CORONA_ORBIT` about its core. */
const CORONA_SHARDS = 10;
const CORONA_RADIUS = 14;
const CORONA_HP = 2;
const CORONA_ORBIT = 112;
/** The core is bare, and can be hurt, with this many shards or fewer; it grows one back every `REGROW_SECONDS` while bare. */
const EXPOSED_AT = 4;
const REGROW_SECONDS = 7;
/** It never grows back past this many shards: one more than `EXPOSED_AT`, so a bare core shields itself again. */
const REGROW_CAP = 6;
/** How far the corona reaches from the core's centre: the orbit and a shard's radius. */
export const ECLIPSE_REACH = CORONA_ORBIT + CORONA_RADIUS;

/** Its shard volley: four shards out past the aim and back in 1.6 s, in lanes 40 apart, turning 90 past it. */
export const ECLIPSE_VOLLEY: VolleyShape = { shards: 4, seconds: 1.6, spread: 40, overshoot: 90 };

/** The corona, as a `ShardOrbit` sets it up. Its shards hold inside the field when a volley throws them. */
export const ECLIPSE_CORONA: ShardOrbitOptions = {
  counts: [CORONA_SHARDS, CORONA_SHARDS],
  hp: CORONA_HP,
  radius: CORONA_RADIUS,
  orbit: CORONA_ORBIT,
  speed: 0.5,
  exposedAt: EXPOSED_AT,
  regrowSeconds: REGROW_SECONDS,
  regrowCap: REGROW_CAP,
  volley: ECLIPSE_VOLLEY,
  keepInField: true,
};

/** Rocks in a quake's ring, by phase. */
export const QUAKE_ROCKS: Readonly<Record<BossPhase, number>> = { 1: 6, 2: 8, 3: 10 };
const QUAKE_SIZE: AsteroidSize = 2;
const QUAKE_SPEED = 1.2;

/** Drones a launch sends out, by phase, and the most of its drones alive at once. */
export const ECLIPSE_WAVES: Readonly<Record<BossPhase, number>> = { 1: 2, 2: 2, 3: 3 };
export const ECLIPSE_CAP = 8;

/** How long a turret volley runs, and how long a dive's dash takes. */
const TURRET_SECONDS = 0.4;
export const DIVE_SECONDS = 1;
/** The pulse's shockwave is on show this long; the shove lands on its first step. */
const PULSE_SECONDS = 0.3;
const PULSE_SPEED = 280;
const PULSE_REACH = 340;
/** How fast the core turns to face the ship, radians per second. */
const TURN_RATE = 0.6;
const DRIFT_SPEED = 12;

/** The Eclipse's windups, in seconds. */
const WINDUPS = { shardVolley: 1.2, quake: 0.8, pulse: 0.6, launch: 0.7, turretVolley: 0.6, dive: 0.8 } as const;

export type EclipseAttack = keyof typeof WINDUPS;

/**
 * The Eclipse, Dimension 5's boss: a dark core inside a corona of `CORONA_SHARDS` shards that orbit it, lit and lethal.
 * It is shielded while more than `EXPOSED_AT` shards remain, and bare at that many or fewer. Every move is a shared one
 * with the Eclipse's own numbers: the Monolith's shard volley, quake and pulse; the Hive Carrier's launch, without its
 * doors; the Warden's turret volley, fired radially from the live shards; and the Leviathan's dive, whose lane it
 * declares at the corona's full reach.
 */
class Eclipse implements BossBehaviour {
  readonly driftSpeed = DRIFT_SPEED;
  /** Its corona moves with its core, so the drift keeps all of it inside the field. */
  readonly rigidParts = true;
  readonly reach: number;
  readonly parts: readonly BossPart[];
  readonly attacks: Readonly<Record<EclipseAttack, AttackSpec>>;
  private readonly corona: ShardOrbit;

  constructor(setup: BossSetup) {
    const { foes } = setup;
    if (foes === undefined) throw new RangeError('The Eclipse launches drones, so its setup needs the galaxy\'s foes: pass them as setup.foes (GalaxyRun passes its FoeField)');
    const corona = new ShardOrbit(ECLIPSE_CORONA, setup);
    this.corona = corona;
    this.parts = corona.parts;
    this.reach = corona.reach;
    this.attacks = {
      shardVolley: corona.volley(WINDUPS.shardVolley),
      quake: rockRingAttack(WINDUPS.quake, QUAKE_ROCKS, QUAKE_SIZE, QUAKE_SPEED),
      pulse: pulseAttack(WINDUPS.pulse, PULSE_SECONDS, PULSE_SPEED, PULSE_REACH),
      launch: { windup: WINDUPS.launch, active: 0, run: (ctx) => { launchDrones(ctx, foes, ECLIPSE_WAVES[ctx.boss.phase], ECLIPSE_CAP); } },
      turretVolley: { ...turretVolleyAttack(WINDUPS.turretVolley, TURRET_SECONDS, corona.parts), threat: { kind: 'ring', radius: CORONA_ORBIT, reach: CORONA_RADIUS, around: 'core' } },
      dive: { ...dashAttack(WINDUPS.dive, DIVE_SECONDS, ECLIPSE_REACH), threat: { kind: 'lane', reach: ECLIPSE_REACH } },
    };
  }

  /** Bare once its corona is down to `EXPOSED_AT` shards or fewer. */
  vulnerable(): boolean {
    return this.corona.exposed;
  }

  step(ctx: AttackContext): void {
    this.corona.step(ctx);
    if (ctx.boss.state === 'fighting') turnToward(ctx.boss, ctx.arena.ship, TURN_RATE, ctx.dt);
  }
}

/** The Eclipse's behaviour, with its attacks spelled out. */
export type EclipseBehaviour = BossBehaviour & { readonly attacks: Readonly<Record<EclipseAttack, AttackSpec>> };

/** Makes the Eclipse for one fight: its corona's count and bearings are drawn from the fight's stream. */
export const createEclipse = (setup: BossSetup): EclipseBehaviour => new Eclipse(setup);
