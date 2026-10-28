import { clamp } from '../../content/curves';
import type { AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { type Point, smoothstep, TIME_EPSILON, turnBetween } from '../math';
import { clearSlot, hullPoint, lane, launchDrones, transientRock, turnToward } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossFoes, BossPhase, BossSetup, BossView, Exposure } from './behaviour';

/** Seconds the hangar stays open after each launch. */
export const HANGAR_OPEN_SECONDS = 4;
/** The most of its drones alive at once; a launch at the cap launches none, but still opens the hangar. */
export const DRONE_CAP = 3;
/** Drones a launch sends out, by phase. */
export const LAUNCH_WAVES: Readonly<Record<BossPhase, number>> = { 1: 1, 2: 2, 3: 2 };
/** How far either side of where it faces the hangar reaches round the hull, in radians: the weak point's half-width. */
export const HANGAR_HALF_ARC = 0.5;
/** How fast it turns its hangar toward the ship, radians per second. */
export const TURN_RATE = 0.9;

/** How fast it cruises across the field between retreats, units per second. */
export const CRUISE_SPEED = 40;
/**
 * Its row, as a share of the field height from the top: 108 on the 720-high field, so its hull stays more than the safe
 * radius from a ship at the field's centre, where a ship starts and respawns.
 */
export const HIVE_HOME_SHARE = 0.15;
/** A retreat ends this far inside the far wall, past the hull's own radius. */
const RETREAT_INSET = 40;
const RETREAT_SECONDS = 3;
/** Rocks in a broadside line, by phase, and how far apart along it. */
const BROADSIDE_ROCKS: Readonly<Record<BossPhase, number>> = { 1: 3, 2: 4, 3: 5 };
const BROADSIDE_SPACING = 90;
const BROADSIDE_SIZE: AsteroidSize = 2;
const BROADSIDE_SPEED = 0.8;
/** No broadside rock forms nearer the ship than this. */
const BROADSIDE_CLEARANCE = 70;
/** Where a shot is aimed into the open hangar, as a share of the hull radius out from the centre. */
const TARGET_DEPTH = 0.85;

/** The Hive Carrier's windups, in seconds. */
const WINDUPS = { launch: 0.7, broadside: 1.0, retreat: 1.0 } as const;
export type HiveCarrierAttack = keyof typeof WINDUPS;

const HANGAR: Exposure = { opened: 'hangarOpen', closed: 'hangarClose' };

/** Where the next broadside rock forms; one point, reused. */
const spot: Point = { x: 0, y: 0 };

/**
 * The Hive Carrier, Dimension 2's boss: a carrier hull cruising along a row high in the field, turning its hangar
 * toward the ship. Each launch sends a wave of drones out of the hangar and leaves its doors open for
 * `HANGAR_OPEN_SECONDS`, the only time and the only arc of hull where a shot hurts it; anywhere else the hull deflects
 * the shot. It also fires broadsides of rocks and retreats to the far side of the field.
 */
class HiveCarrier implements BossBehaviour {
  readonly driftSpeed = 0;
  readonly exposure = HANGAR;
  readonly attacks: Readonly<Record<HiveCarrierAttack, AttackSpec>> = {
    launch: { windup: WINDUPS.launch, active: 0, run: (ctx) => { this.launch(ctx); } },
    broadside: { windup: WINDUPS.broadside, active: 0, run: broadside },
    retreat: { windup: WINDUPS.retreat, active: RETREAT_SECONDS, run: retreat },
  };

  /** The sim time the hangar closes at. */
  private closesAt = Number.NEGATIVE_INFINITY;
  private open = false;
  /** Which way it cruises: 1 to the right, -1 to the left. */
  private direction: 1 | -1;
  /** Where a shot is aimed while the hangar is open: one point, moved in place. */
  private readonly aim: Point = { x: 0, y: 0 };

  constructor(
    setup: BossSetup,
    private readonly foes: BossFoes,
  ) {
    this.direction = setup.rng.chance(0.5) ? 1 : -1;
  }

  home(field: Field): Readonly<Point> {
    return { x: field.width / 2, y: field.height * HIVE_HOME_SHARE };
  }

  vulnerable(): boolean {
    return this.open;
  }

  /** Through the hangar: within its arc of the bearing it faces. */
  hurtsAt(boss: Readonly<BossView>, x: number, y: number): boolean {
    return Math.abs(turnBetween(boss.facing, Math.atan2(y - boss.y, x - boss.x))) <= HANGAR_HALF_ARC;
  }

  target(boss: Readonly<BossView>): Readonly<Point> | null {
    return boss.vulnerable ? hullPoint(boss, boss.radius * TARGET_DEPTH, 0, this.aim) : null;
  }

  /** While it fights: turns toward the ship, cruises unless retreating, and opens or shuts the hangar on time. */
  step(ctx: AttackContext): void {
    const { boss, arena, dt } = ctx;
    this.open = boss.state === 'fighting' && arena.elapsed() + TIME_EPSILON < this.closesAt;
    if (boss.state !== 'fighting') return;
    turnToward(boss, arena.ship, TURN_RATE, dt);
    if (boss.active !== 'retreat') this.cruise(boss, dt, arena.field());
  }

  /** Moves along its row, turning back at either wall. */
  private cruise(boss: BossView, dt: number, field: Field): void {
    const min = boss.radius;
    const max = field.width - boss.radius;
    boss.x = clamp(boss.x + this.direction * CRUISE_SPEED * dt, min, max);
    if (boss.x === min) this.direction = 1;
    else if (boss.x === max) this.direction = -1;
  }

  /** Opens the hangar, and sends out the phase's wave of drones through it, as many as the cap leaves room for (`launchDrones`). */
  private launch(ctx: AttackContext): void {
    this.closesAt = ctx.arena.elapsed() + HANGAR_OPEN_SECONDS;
    launchDrones(ctx, this.foes, LAUNCH_WAVES[ctx.boss.phase], DRONE_CAP);
  }
}

/** Fires a line of pass-through rocks across its hangar, all flying the way it faces, none formed off the field or on top of the ship. */
function broadside(ctx: AttackContext): void {
  const { boss, arena } = ctx;
  const { ship } = arena;
  const field = arena.field();
  const count = BROADSIDE_ROCKS[boss.phase];
  const ahead = boss.radius + ASTEROID.radii[BROADSIDE_SIZE];
  for (let i = 0; i < count; i++) {
    const at = hullPoint(boss, ahead, lane(i, count, BROADSIDE_SPACING), spot);
    if (clearSlot(at, field, ship, BROADSIDE_CLEARANCE)) transientRock(ctx, at.x, at.y, BROADSIDE_SIZE, boss.facing, BROADSIDE_SPEED);
  }
}

/** Sweeps across its row to just inside the wall on the far side of the field's middle from where it started, easing in and out. */
function retreat(ctx: AttackContext): void {
  const { boss } = ctx;
  const { width } = ctx.arena.field();
  const inset = boss.radius + RETREAT_INSET;
  const toX = ctx.fromX < width / 2 ? width - inset : inset;
  const t = Math.min(1, (ctx.age + ctx.dt) / RETREAT_SECONDS);
  boss.x = ctx.fromX + smoothstep(t, toX - ctx.fromX);
}

/** The Hive Carrier's behaviour, with its attacks spelled out. */
export type HiveCarrierBehaviour = BossBehaviour & { readonly attacks: Readonly<Record<HiveCarrierAttack, AttackSpec>> };

/** Makes the Hive Carrier for one fight: which way it first cruises is drawn from the fight's stream. */
export function createHiveCarrier(setup: BossSetup): HiveCarrierBehaviour {
  if (setup.foes === undefined) throw new RangeError('The Hive Carrier launches drones, so its setup needs the galaxy\'s foes: pass them as setup.foes (GalaxyRun passes its FoeField)');
  return new HiveCarrier(setup, setup.foes);
}
