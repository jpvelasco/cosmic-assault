import { clamp } from '../../content/curves';
import { createAsteroid, type AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import { TAU } from '../math';
import type { AttackContext, BossView, Point } from './behaviour';

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
