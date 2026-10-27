import { createAsteroid, type AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import { TAU } from '../math';
import type { AttackContext } from './behaviour';

/**
 * Sends `count` pass-through rocks of `size` out from the core's rim, evenly spaced and turned by a random offset, at
 * `speed` times the galaxy's rock speed. Their shapes come from the arena's shape stream, everything else from the boss's.
 */
export function rockRing(ctx: AttackContext, count: number, size: AsteroidSize, speed: number): void {
  const { arena, boss, rng } = ctx;
  const spacing = TAU / count;
  const offset = rng.range(0, spacing);
  const reach = boss.radius + ASTEROID.radii[size];
  for (let i = 0; i < count; i++) {
    const angle = offset + i * spacing;
    const rock = createAsteroid(rng, boss.x + Math.cos(angle) * reach, boss.y + Math.sin(angle) * reach, size, angle, ctx.rockSpeed * speed, arena.shapeRng, arena.nextId());
    rock.transient = true;
    arena.asteroids.push(rock);
  }
}
