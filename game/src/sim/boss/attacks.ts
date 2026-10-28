import { clamp } from '../../content/curves';
import { BOLT, FOES } from '../../content/foes';
import { createAsteroid, type AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { type Point, TAU, TIME_EPSILON, turnBetween } from '../math';
import type { AttackContext, AttackSpec, BossFoes, BossPart, BossPhase, BossView } from './behaviour';

// The moves bosses share: each boss's attacks call them with its own numbers, so a later boss remixes an earlier one's
// moves instead of copying them.

/**
 * Sends a pass-through rock of `size` from (x, y) along `angle`, at `speed` times the galaxy's rock speed, marked as
 * the attack's. Its shape comes from the arena's shape stream, everything else from the boss's.
 */
export function transientRock(ctx: AttackContext, x: number, y: number, size: AsteroidSize, angle: number, speed: number): void {
  const { arena } = ctx;
  const rock = createAsteroid(ctx.rng, x, y, size, angle, ctx.rockSpeed * speed, arena.shapeRng, arena.nextId());
  rock.transient = true;
  rock.fromAttack = true;
  arena.asteroids.push(rock);
}

/** Sends `count` pass-through rocks of `size` out from the core's rim, evenly spaced and turned by a random offset, at `speed` times the galaxy's rock speed. */
export function rockRing(ctx: AttackContext, count: number, size: AsteroidSize, speed: number): void {
  const { boss, rng } = ctx;
  const spacing = TAU / count;
  const offset = rng.range(0, spacing);
  const reach = boss.radius + ASTEROID.radii[size];
  for (let i = 0; i < count; i++) {
    const angle = offset + i * spacing;
    transientRock(ctx, boss.x + Math.cos(angle) * reach, boss.y + Math.sin(angle) * reach, size, angle, speed);
  }
}

/**
 * Writes into `out`, and returns, a radial shove on a ship at (x, y): straight away from the core, `speed` at its rim
 * and fading to nothing `reach` beyond it; none on a ship at its very centre. The bots predict a declared shove with it.
 */
export function radialShove(boss: Readonly<Pick<BossView, 'x' | 'y' | 'radius'>>, speed: number, reach: number, x: number, y: number, out: Point): Point {
  const dx = x - boss.x;
  const dy = y - boss.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const push = speed * clamp(1 - (distance - boss.radius) / reach, 0, 1);
  out.x = (dx / distance) * push;
  out.y = (dy / distance) * push;
  return out;
}

/** Turns `boss` toward `target` by at most `rate` radians per second over `dt`: how a boss that faces the ship keeps its facing. */
export function turnToward(boss: BossView, target: Readonly<Point>, rate: number, dt: number): void {
  const limit = rate * dt;
  boss.facing += clamp(turnBetween(boss.facing, Math.atan2(target.y - boss.y, target.x - boss.x)), -limit, limit);
}

/** The shove a pulse asks for; one point, reused. */
const shove: Point = { x: 0, y: 0 };

/** Shoves the ship away from the core once, as it goes active, as `radialShove` says. */
export function pulse(ctx: AttackContext, speed: number, reach: number): void {
  if (ctx.age !== 0) return;
  const { ship } = ctx.arena;
  radialShove(ctx.boss, speed, reach, ship.x, ship.y, shove);
  ctx.shoveX = shove.x;
  ctx.shoveY = shove.y;
}

/** A pulse telegraphed for `windup` s and on show for `active` s, declaring the shove it lands as its threat. */
export const pulseAttack = (windup: number, active: number, speed: number, reach: number): AttackSpec => ({
  windup,
  active,
  run: (ctx) => { pulse(ctx, speed, reach); },
  threat: { kind: 'shove', speed, reach },
});

/** Dashes the core in a straight line, over `seconds`, to the windup's aim. */
export function dash(ctx: AttackContext, seconds: number): void {
  const { boss } = ctx;
  const progress = Math.min(1, (ctx.age + ctx.dt) / seconds);
  boss.x = ctx.fromX + (boss.aim.x - ctx.fromX) * progress;
  boss.y = ctx.fromY + (boss.aim.y - ctx.fromY) * progress;
}

/** Writes into `out`, and returns, where a core of `radius` dashing at `at` stops: there, kept `radius` inside the field. */
export function dashAim(at: Readonly<Point>, field: Field, radius: number, out: Point): Point {
  out.x = clamp(at.x, radius, field.width - radius);
  out.y = clamp(at.y, radius, field.height - radius);
  return out;
}

/**
 * A dash, by a core of `radius`, telegraphed for `windup` s and lasting `seconds`: aimed where the ship is as the windup
 * begins, short of the field's edge (`dashAim`), and declaring the core's lane to that aim as its threat.
 */
export const dashAttack = (windup: number, seconds: number, radius: number): AttackSpec => ({
  windup,
  active: seconds,
  aim: (ship, field, out) => { dashAim(ship, field, radius, out); },
  run: (ctx) => { dash(ctx, seconds); },
  threat: { kind: 'lane', reach: 'core' },
});

/** Fires a bolt from (x, y) along `angle` at `speed`, marked as the boss's attack's; none with the galaxy's bolts all in flight. */
export function fireBolt(ctx: AttackContext, x: number, y: number, angle: number, speed: number = BOLT.speed): void {
  if (ctx.bolts === null) throw new RangeError("this boss fires bolts, so its setup needs the galaxy's bolts: pass them as setup.bolts (GalaxyRun passes its own)");
  const bolt = ctx.bolts.fire(x, y, angle, speed, 'boss');
  if (bolt !== null) bolt.fromAttack = true;
}

/** Drones leave the launch mouth this far past the core's rim, this far apart across it, fanning out by this much each. */
const LAUNCH_GAP = 6;
const LAUNCH_SPACING = 36;
const LAUNCH_FAN = 0.3;
/** Launch slots along each side of the core past its rim, at the least: room for a wave a ship tucked at a corner leaves short. */
const END_SLOTS_A_SIDE = 5;

/** Where along a line of `count` things, `spacing` apart and centred, the `i`th sits. */
export const lane = (i: number, count: number, spacing: number): number => (i - (count - 1) / 2) * spacing;

/** Writes into `out` the point `ahead` out from the boss's centre the way it faces and `across` to its side, and returns it. */
export function hullPoint(boss: Readonly<BossView>, ahead: number, across: number, out: Point): Readonly<Point> {
  const ux = Math.cos(boss.facing);
  const uy = Math.sin(boss.facing);
  out.x = boss.x + ux * ahead - uy * across;
  out.y = boss.y + uy * ahead + ux * across;
  return out;
}

/** Whether something may form at `at`: inside `field`, and at least `clearance` from `ship`. */
export const clearSlot = ({ x, y }: Readonly<Point>, field: Field, ship: Readonly<Point>, clearance: number): boolean =>
  x >= 0 && x <= field.width && y >= 0 && y <= field.height && Math.hypot(x - ship.x, y - ship.y) >= clearance;

/**
 * Writes into `out` where launch slot `slot` of a `count`-drone wave is, and returns the heading its drone leaves on.
 * The first `count` slots fan out across the mouth the boss faces with; the rest line its cross axis out from its rim,
 * alternating sides, and send their drones straight ahead. `launchDrones` gives each side `max(count, END_SLOTS_A_SIDE)`,
 * so either side alone has room for a whole wave, and a ship tucked at a corner cannot leave a small wave short.
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

/** Where the next drone forms; one point, reused. */
const slotSpot: Point = { x: 0, y: 0 };
/** The mouth slots the drones of a launch form in; reused. */
const formed: number[] = [];

/**
 * Writes into `out`, and returns, the slots `count` drones of a launch form in: the first `count` slots, laid out for
 * `layout` drones (`launchSlot`), that lie clear of the ship. A slot outside the field or within the safe radius of the
 * ship stays empty, and its drone forms in the next clear slot instead: the wave's other mouth slots, then the sides, so a
 * ship parked in front of the mouth still meets a full wave. The drawer marks this same list, so a drone never forms on
 * a slot it does not show.
 */
export function launchSlotsFor(boss: Readonly<BossView>, field: Field, ship: Readonly<Point>, count: number, layout: number, out: number[]): number[] {
  out.length = 0;
  const slots = layout + 2 * Math.max(layout, END_SLOTS_A_SIDE);
  for (let slot = 0; out.length < count && slot < slots; slot++) {
    launchSlot(boss, slot, layout, slotSpot);
    if (clearSlot(slotSpot, field, ship, ASTEROID.safeRadius)) out.push(slot);
  }
  return out;
}

/**
 * Sends out a wave of up to `wave` drones, as many as `cap` of the boss's own alive at once leaves room for, from the
 * slots `launchSlotsFor` gives. The mouth is laid out for the drones sent, unless `layout` says a wave's mouth, so that a
 * launch cut short by the cap still leaves from the slots the wave's mouth shows.
 */
export function launchDrones(ctx: AttackContext, foes: BossFoes, wave: number, cap: number, layout?: number): void {
  const { boss, arena } = ctx;
  const count = Math.min(wave, cap - foes.launched);
  if (count <= 0) return;
  const laid = layout ?? count;
  for (const slot of launchSlotsFor(boss, arena.field(), arena.ship, count, laid, formed)) {
    const heading = launchSlot(boss, slot, laid, slotSpot);
    if (!foes.launch('drone', slotSpot.x, slotSpot.y, heading)) return;
  }
}

/** Fires one bolt from each live part in `parts`, outward along the bearing from the core through it, at `speed`. */
export function radialBolts(ctx: AttackContext, parts: readonly Readonly<BossPart>[], speed: number = BOLT.speed): void {
  const { boss } = ctx;
  for (const part of parts) if (part.hp > 0) fireBolt(ctx, part.x, part.y, Math.atan2(part.y - boss.y, part.x - boss.x), speed);
}

/**
 * Fires `count` bolts from `from` at `speed`, fanned evenly across `spread` radians about the bearing to where the ship
 * was as the windup began; one bolt flies straight at it.
 */
export function aimedBolts(ctx: AttackContext, from: Readonly<Point>, count: number, spread: number, speed: number = BOLT.speed): void {
  for (let i = 0; i < count; i++) fireBolt(ctx, from.x, from.y, fanBearing(from, ctx.boss.aim.x, ctx.boss.aim.y, i, count, spread), speed);
}

/**
 * The bearing of bolt `i` of `count` fired from `from`, fanned evenly across `spread` radians about the bearing to
 * (aimX, aimY); a lone bolt flies straight at it. Shared by the bosses' aimed bolts and the gunships.
 */
export const fanBearing = (from: Readonly<Point>, aimX: number, aimY: number, i: number, count: number, spread: number): number =>
  Math.atan2(aimY - from.y, aimX - from.x) + (count > 1 ? lane(i, count, spread / (count - 1)) : 0);

/**
 * Whether an attack's active time reaches `t` seconds during this step: true on exactly one step for each `t` inside its
 * active window, its first step for 0, so a move made at set times into the attack (a second volley, say) is made once.
 */
export const crosses = (ctx: Readonly<Pick<AttackContext, 'age' | 'dt'>>, t: number): boolean => ctx.age - TIME_EPSILON <= t && t < ctx.age + ctx.dt - TIME_EPSILON;

/**
 * A turret volley, telegraphed for `windup` s and running `active` s: every live part of `parts` fires one bolt outward
 * as it goes active, and once more `repeat.at` s later if the boss is in `repeat.phase`.
 */
export const turretVolleyAttack = (windup: number, active: number, parts: readonly Readonly<BossPart>[], repeat?: Readonly<{ at: number; phase: BossPhase }>): AttackSpec => ({
  windup,
  active,
  run: (ctx) => {
    if (crosses(ctx, 0) || (repeat !== undefined && ctx.boss.phase === repeat.phase && crosses(ctx, repeat.at))) radialBolts(ctx, parts);
  },
});

/** A quake, telegraphed for `windup` s: a ring of `counts[phase]` pass-through rocks of `size` from the core's rim, at `speed`, as it goes active. */
export const rockRingAttack = (windup: number, counts: Readonly<Record<BossPhase, number>>, size: AsteroidSize, speed: number): AttackSpec => ({
  windup,
  active: 0,
  run: (ctx) => { rockRing(ctx, counts[ctx.boss.phase], size, speed); },
});
