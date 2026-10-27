import type { BossView } from '../sim/boss/behaviour';
import { bossTarget } from '../sim/boss/bossRunner';
import { PLAYER, STEP_SECONDS } from '../sim/config';
import type { Field } from '../sim/field';
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

/** Extra effective distance, by kind, when choosing what to shoot: drones and the boss first, then splitters, then rocks. */
const PRIORITY = { drone: 0, boss: 0, splitter: 150, rock: 350 } as const;

/** An offset `delta` along a side `size` long: across the wrap if that is shorter and `wraps`, else across the field. */
const across = (delta: number, size: number, wraps: boolean): number => (wraps ? wrapDelta(delta, size) : delta);

/** The distance from `from` to `to` across the wrap. */
export const wrappedDistance = (from: Body, to: Body, field: Field): number =>
  Math.hypot(wrapDelta(to.x - from.x, field.width), wrapDelta(to.y - from.y, field.height));

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
  return score;
}

/** Offers `point` of the boss, moving as `body` did over the latest step, to be shot at across the field. */
const offerBossPoint = (view: Readonly<BotView>, out: Target, best: number, point: Body, body: Posed): number =>
  offer(view, out, best, point, (body.x - body.px) / STEP_SECONDS, (body.y - body.py) / STEP_SECONDS, PRIORITY.boss, false);

/**
 * Offers the boss where a shot hurts it now: the point its behaviour names while its core can be hurt, moving with the
 * core; else the nearest of its live parts, which a shot always strikes; nothing outside the fight.
 */
function offerBoss(view: Readonly<BotView>, out: Target, best: number, boss: Readonly<BossView>): number {
  if (boss.state !== 'fighting') return best;
  const weakPoint = bossTarget(boss);
  if (boss.vulnerable && weakPoint !== null) return offerBossPoint(view, out, best, weakPoint, boss);
  for (const part of boss.parts) if (part.hp > 0) best = offerBossPoint(view, out, best, part, part);
  return best;
}

/**
 * What to shoot at, written into `out`: the foe, boss weak point or rock with the least distance plus its kind's
 * `PRIORITY`. False when there is nothing to shoot.
 */
export function chooseTarget(view: Readonly<BotView>, out: Target): boolean {
  let best = Infinity;
  for (const foe of view.foes) if (foe.hp > 0) best = offer(view, out, best, foe, foe.vx, foe.vy, PRIORITY[foe.kind], true);
  if (view.boss !== null) best = offerBoss(view, out, best, view.boss);
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
