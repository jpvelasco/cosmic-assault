import { createAsteroid, type AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import { TAU } from '../math';
import type { AttackContext } from './behaviour';

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
