import { clamp } from '../../content/curves';
import { FOES } from '../../content/foes';
import type { AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { smoothstep, TIME_EPSILON, turnBetween } from '../math';
import { transientRock } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossFoes, BossPhase, BossSetup, BossView, Exposure, Point } from './behaviour';

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
/** Drones leave the hangar mouth this far past the hull, this far apart across it, fanning out by this much each. */
const LAUNCH_GAP = 6;
const LAUNCH_SPACING = 36;
const LAUNCH_FAN = 0.3;
/** Launch slots along each side of the hull past its wingtips, at the least: room for a wave a ship tucked at a corner leaves short. */
const END_SLOTS_A_SIDE = 5;
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

/** Where along a line of `count` things, `spacing` apart and centred, the `i`th sits. */
const lane = (i: number, count: number, spacing: number): number => (i - (count - 1) / 2) * spacing;

/** Writes into `out` the point `ahead` out from the boss's centre the way it faces and `across` to its side, and returns it. */
function hullPoint(boss: Readonly<BossView>, ahead: number, across: number, out: Point): Readonly<Point> {
  const ux = Math.cos(boss.facing);
  const uy = Math.sin(boss.facing);
  out.x = boss.x + ux * ahead - uy * across;
  out.y = boss.y + uy * ahead + ux * across;
  return out;
}

/** Where the next drone or rock forms; one point, reused. */
const spot: Point = { x: 0, y: 0 };

/** Whether something may form at `at`: inside `field`, and at least `clearance` from `ship`. */
const clearSlot = ({ x, y }: Readonly<Point>, field: Field, ship: Readonly<Point>, clearance: number): boolean =>
  x >= 0 && x <= field.width && y >= 0 && y <= field.height && Math.hypot(x - ship.x, y - ship.y) >= clearance;

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
    const { ship } = arena;
    const limit = TURN_RATE * dt;
    boss.facing += clamp(turnBetween(boss.facing, Math.atan2(ship.y - boss.y, ship.x - boss.x)), -limit, limit);
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

  /**
   * Opens the hangar, and sends out the phase's wave of drones, as many as the cap leaves room for. A slot outside the
   * field or within the safe radius of the ship stays empty, and its drone leaves from the next clear slot instead: the
   * wave's other hangar slots, then the hull's ends, so a ship parked in front of the hangar still meets a full wave.
   */
  private launch(ctx: AttackContext): void {
    const { boss, arena } = ctx;
    this.closesAt = arena.elapsed() + HANGAR_OPEN_SECONDS;
    const count = Math.min(LAUNCH_WAVES[boss.phase], DRONE_CAP - this.foes.launched);
    let launched = 0;
    const slots = count + 2 * Math.max(count, END_SLOTS_A_SIDE);
    for (let slot = 0; launched < count && slot < slots; slot++) {
      const heading = launchSlot(boss, slot, count, spot);
      if (!clearSlot(spot, arena.field(), arena.ship, ASTEROID.safeRadius)) continue;
      if (!this.foes.launch('drone', spot.x, spot.y, heading)) return;
      launched++;
    }
  }
}

/**
 * Writes into `out` where launch slot `slot` of a `count`-drone wave is, and returns the heading its drone leaves on.
 * The first `count` slots fan out across the hangar mouth; the rest line the hull's long axis out from its wingtips,
 * alternating sides, and send their drones straight ahead. `launch` gives each side `max(count, END_SLOTS_A_SIDE)`, so either
 * side alone has room for a whole wave, and a ship tucked at a corner cannot leave a small wave short.
 */
export function launchSlot(boss: Readonly<BossView>, slot: number, count: number, out: Point): number {
  const mouth = boss.radius + FOES.drone.radius + LAUNCH_GAP;
  if (slot < count) {
    hullPoint(boss, mouth, lane(slot, count, LAUNCH_SPACING), out);
    return boss.facing + lane(slot, count, LAUNCH_FAN);
  }
  const end = slot - count;
  const side = end % 2 === 0 ? -1 : 1;
  hullPoint(boss, 0, side * (mouth + Math.floor(end / 2) * LAUNCH_SPACING), out);
  return boss.facing;
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
