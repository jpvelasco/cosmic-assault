import { FOES } from '../../content/foes';
import type { FoeKind } from '../../content/types';
import { aimFromEdge, headInward } from '../asteroid';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { TAU } from '../math';
import type { Rng } from '../rng';
import { wrapPosition } from '../wrap';
import type { Foe, FoeWorld } from './foe';

// What the foes that move like rocks share: the splitter, the armoured rock and the mine drift, spin and wrap.

/** A drifting foe of `kind`'s speed: its own, times the galaxy's rock speed-up and a rock's jitter. */
export function driftSpeed(kind: FoeKind, speedMultiplier: number, rng: Rng): number {
  const [low, high] = ASTEROID.speedJitter;
  return FOES[kind].speed * speedMultiplier * rng.range(low, high);
}

/**
 * Brings in `count` foes of `kind` the way a rock enters, from an edge toward the field and clear of the ship, at
 * `driftSpeed`, turned at random and spinning up to `spin` radians a second either way.
 */
export function spawnDrifting(world: FoeWorld, kind: FoeKind, count: number, speedMultiplier: number, spin: number): void {
  const { arena, rng } = world;
  for (let i = 0; i < count; i++) {
    const foe = world.acquire(kind);
    if (foe === null) return;
    const aim = aimFromEdge(rng, arena.field(), null, arena.ship);
    const speed = driftSpeed(kind, speedMultiplier, rng);
    foe.x = aim.x;
    foe.y = aim.y;
    foe.vx = Math.cos(aim.angle) * speed;
    foe.vy = Math.sin(aim.angle) * speed;
    headInward(foe, aim.edge);
    foe.rotation = rng.range(0, TAU);
    foe.spin = rng.range(-spin, spin);
    world.commit(foe);
  }
}

/** Moves `foe` along its velocity for `dt` seconds and turns it by its spin, wrapping as a rock does. */
export function drift(foe: Foe, dt: number, field: Field): void {
  foe.x += foe.vx * dt;
  foe.y += foe.vy * dt;
  foe.rotation += foe.spin * dt;
  wrapPosition(foe, field);
}
