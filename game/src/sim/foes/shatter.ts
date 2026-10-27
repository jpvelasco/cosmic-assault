import { createAsteroid, type AsteroidSize } from '../asteroid';
import { TAU } from '../math';
import type { Foe, FoeWorld } from './foe';

/**
 * Breaks `foe` into `count` rocks of `size`, spread evenly round it from a random first bearing, each at `speedMultiplier`.
 * A `transient` rock passes through the field as a meteor does, never wrapping or splitting. The rocks are the foe's
 * remains: its only owner of the arithmetic, so a splitter's fragments and an armoured rock's shards draw alike.
 */
export function breakInto(foe: Readonly<Foe>, { arena, rng }: FoeWorld, count: number, size: AsteroidSize, speedMultiplier: number, transient: boolean): void {
  const first = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const angle = first + (i * TAU) / count;
    const rock = createAsteroid(rng, foe.x, foe.y, size, angle, speedMultiplier, arena.shapeRng, arena.nextId());
    if (transient) rock.transient = true;
    arena.asteroids.push(rock);
  }
}
