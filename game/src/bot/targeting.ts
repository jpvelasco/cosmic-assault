import { bossTarget } from '../sim/boss/bossRunner';
import { PLAYER } from '../sim/config';
import type { Field } from '../sim/field';
import { wrapDelta } from '../sim/wrap';
import type { BotView } from './view';

/** A point to shoot at and how it moves. */
export interface Target {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Body {
  readonly x: number;
  readonly y: number;
}

/** Extra effective distance, by kind, when choosing what to shoot: drones and the boss first, then splitters, then rocks. */
const PRIORITY = { drone: 0, boss: 0, splitter: 150, rock: 350 } as const;

/** The distance from `from` to `to` across the wrap. */
export const wrappedDistance = (from: Body, to: Body, field: Field): number =>
  Math.hypot(wrapDelta(to.x - from.x, field.width), wrapDelta(to.y - from.y, field.height));

/** Writes `body` into `out` if its score beats `best`; returns the better score. */
function offer(view: Readonly<BotView>, out: Target, best: number, body: Body, vx: number, vy: number, penalty: number): number {
  const score = wrappedDistance(view.ship, body, view.field) + penalty;
  if (score >= best) return best;
  out.x = body.x;
  out.y = body.y;
  out.vx = vx;
  out.vy = vy;
  return score;
}

/**
 * What to shoot at, written into `out`: the foe, boss weak point or rock with the least distance plus its kind's
 * `PRIORITY`. The boss counts only where a shot hurts it now (`bossTarget`): its core when vulnerable, else a live part.
 * False when there is nothing to shoot.
 */
export function chooseTarget(view: Readonly<BotView>, out: Target): boolean {
  let best = Infinity;
  for (const foe of view.foes) if (foe.hp > 0) best = offer(view, out, best, foe, foe.vx, foe.vy, PRIORITY[foe.kind]);
  const boss = view.boss === null ? null : bossTarget(view.boss);
  if (boss !== null) best = offer(view, out, best, boss, 0, 0, PRIORITY.boss);
  for (const rock of view.asteroids) best = offer(view, out, best, rock, rock.vx, rock.vy, PRIORITY.rock);
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
  const dx = wrapDelta(target.x - ship.x, field.width);
  const dy = wrapDelta(target.y - ship.y, field.height);
  // A shot carries half the ship's velocity, so lead the target's motion relative to that.
  const wx = target.vx - ship.vx * PLAYER.inheritVelocity;
  const wy = target.vy - ship.vy * PLAYER.inheritVelocity;
  const t = interceptTime(wx * wx + wy * wy - PLAYER.projectileSpeed * PLAYER.projectileSpeed, 2 * (dx * wx + dy * wy), dx * dx + dy * dy);
  return Math.atan2(dy + wy * t, dx + wx * t);
}
