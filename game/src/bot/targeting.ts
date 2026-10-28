import type { BossPart, BossView, Point } from '../sim/boss/behaviour';
import { bossTarget } from '../sim/boss/bossRules';
import { PLAYER, PROJECTILE, STEP_SECONDS } from '../sim/config';
import { wrapDelta } from '../sim/wrap';
import type { BotView } from './view';

/** A point to shoot at, how it moves, and whether a shot may reach it across the wrap. */
export interface Target {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * False for a boss: a weak point faces the ship across the field, so a shot that came round the wrap would strike the
   * far side of its hull.
   */
  wraps: boolean;
  /**
   * True for a boss's weak point offered through a clear line of fire. The next choice reads it back: a blocking part
   * must stand `LINE_HOLD` farther off the line to let the bot switch to the weak point than to keep it, so the choice
   * does not flicker as a part grazes the line.
   */
  weakPoint: boolean;
}

interface Body {
  readonly x: number;
  readonly y: number;
}

/** A boss body with its pose before the latest step, from which its velocity is read; a boss never wraps. */
interface Posed extends Body {
  readonly px: number;
  readonly py: number;
}

/** How much farther off the line of fire a blocking part must stand for the bot to switch to a weak point than to keep it. */
const LINE_HOLD = 4;

/**
 * Extra effective distance, by kind, when choosing what to shoot: drones, gunships, mines (shot from range, before the
 * ship comes near their arm rings) and the boss first, then splitters, then rocks.
 */
const PRIORITY = { drone: 0, gunship: 0, mine: 0, boss: 0, splitter: 150, rock: 350 } as const;

/** An offset `delta` along a side `size` long: across the wrap if that is shorter and `wraps`, else across the field. */
const across = (delta: number, size: number, wraps: boolean): number => (wraps ? wrapDelta(delta, size) : delta);

/** Writes `body`, moving at (vx, vy), into `out` if its score beats `best`; returns the better score. */
function offer(view: Readonly<BotView>, out: Target, best: number, body: Body, vx: number, vy: number, penalty: number, wraps: boolean): number {
  const { ship, field } = view;
  const score = Math.hypot(across(body.x - ship.x, field.width, wraps), across(body.y - ship.y, field.height, wraps)) + penalty;
  if (score >= best) return best;
  out.x = body.x;
  out.y = body.y;
  out.vx = vx;
  out.vy = vy;
  out.wraps = wraps;
  out.weakPoint = false;
  return score;
}

/** Offers `point` of the boss, moving as `body` did over the latest step, to be shot at across the field. */
const offerBossPoint = (view: Readonly<BotView>, out: Target, best: number, point: Body, body: Posed): number =>
  offer(view, out, best, point, (body.x - body.px) / STEP_SECONDS, (body.y - body.py) / STEP_SECONDS, PRIORITY.boss, false);

/** The live part `point` is, or null for a point that is no part (the core, or a spot on its hull). */
function partAt(boss: Readonly<BossView>, point: Readonly<Point>): Readonly<BossPart> | null {
  for (const part of boss.parts) if (part === point) return part;
  return null;
}

/**
 * Whether a part in the line of fire blocks it: one a shot is spent on without clearing it, armoured or with HP to
 * spare. A part one shot breaks does not, since the shot that breaks it clears the way for the next.
 */
const blocks = (part: Readonly<BossPart>): boolean => part.armoured === true || part.hp > 1;

/** How far (x, y) lies from the line of fire, the segment from `ship` along (dx, dy); infinite off either end of it. */
function offLine(ship: Readonly<Point>, dx: number, dy: number, length2: number, x: number, y: number): number {
  const along = length2 > 0 ? ((x - ship.x) * dx + (y - ship.y) * dy) / length2 : 0;
  if (along <= 0 || along >= 1) return Infinity;
  return Math.hypot(ship.x + dx * along - x, ship.y + dy * along - y);
}

/**
 * Whether a straight shot from the ship reaches `to` without striking a blocking part other than `to` on the way, with
 * `margin` to spare: a shot strikes the first part it touches, so one in the way spends it. A part counts where it is
 * and where it will be as a shot fired now reaches it, moving as it did over the latest step, so a turning ring that
 * would swing a part into the shot's path blocks it.
 */
function clearLine(ship: Readonly<Point>, to: Readonly<Point>, parts: readonly Readonly<BossPart>[], margin: number): boolean {
  const dx = to.x - ship.x;
  const dy = to.y - ship.y;
  const length2 = dx * dx + dy * dy;
  const length = Math.sqrt(length2);
  for (const part of parts) {
    if (part.hp <= 0 || part === to || !blocks(part)) continue;
    const reach = part.radius + PROJECTILE.radius + margin;
    if (offLine(ship, dx, dy, length2, part.x, part.y) < reach) return false;
    const flight = length > 0 ? ((part.x - ship.x) * dx + (part.y - ship.y) * dy) / length / PLAYER.projectileSpeed : 0;
    if (flight <= 0) continue;
    const steps = flight / STEP_SECONDS;
    if (offLine(ship, dx, dy, length2, part.x + (part.x - part.px) * steps, part.y + (part.y - part.py) * steps) < reach) return false;
  }
  return true;
}

/**
 * Offers the boss where a shot hurts it now: the point its behaviour names while its core can be hurt, led by its own
 * motion if it is a part and by the core's otherwise, as long as no blocking part stands in the line of fire (by
 * `LINE_HOLD` to spare unless the weak point was `held`, the last choice); else the nearest of its live parts that are
 * not armoured; nothing outside the fight.
 */
function offerBoss(view: Readonly<BotView>, out: Target, best: number, boss: Readonly<BossView>, held: boolean): number {
  if (boss.state !== 'fighting') return best;
  const weakPoint = bossTarget(boss);
  if (boss.vulnerable && weakPoint !== null && clearLine(view.ship, weakPoint, boss.parts, held ? 0 : LINE_HOLD)) {
    const score = offerBossPoint(view, out, best, weakPoint, partAt(boss, weakPoint) ?? boss);
    if (score < best) out.weakPoint = true;
    return score;
  }
  for (const part of boss.parts) if (part.hp > 0 && part.armoured !== true) best = offerBossPoint(view, out, best, part, part);
  return best;
}

/**
 * What to shoot at, written into `out`: the foe, boss weak point or rock with the least distance plus its kind's
 * `PRIORITY`. False when there is nothing to shoot.
 */
export function chooseTarget(view: Readonly<BotView>, out: Target): boolean {
  const held = out.weakPoint;
  let best = Infinity;
  for (const foe of view.foes) if (foe.hp > 0) best = offer(view, out, best, foe, foe.vx, foe.vy, PRIORITY[foe.kind], true);
  if (view.boss !== null) best = offerBoss(view, out, best, view.boss, held);
  for (const rock of view.asteroids) best = offer(view, out, best, rock, rock.vx, rock.vy, PRIORITY.rock, true);
  return best < Infinity;
}

/** The least positive root of a·t² + b·t + c, or 0 when there is none. */
function interceptTime(a: number, b: number, c: number): number {
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : 0;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const low = Math.min(t1, t2);
  const high = Math.max(t1, t2);
  if (low > 0) return low;
  return high > 0 ? high : 0;
}

/** The heading that leads `target` so a shot fired now meets it, or points straight at it if no shot can. */
export function leadHeading(view: Readonly<BotView>, target: Readonly<Target>): number {
  const { ship, field } = view;
  const dx = across(target.x - ship.x, field.width, target.wraps);
  const dy = across(target.y - ship.y, field.height, target.wraps);
  // A shot carries half the ship's velocity, so lead the target's motion relative to that.
  const wx = target.vx - ship.vx * PLAYER.inheritVelocity;
  const wy = target.vy - ship.vy * PLAYER.inheritVelocity;
  const t = interceptTime(wx * wx + wy * wy - PLAYER.projectileSpeed * PLAYER.projectileSpeed, 2 * (dx * wx + dy * wy), dx * dx + dy * dy);
  return Math.atan2(dy + wy * t, dx + wx * t);
}
