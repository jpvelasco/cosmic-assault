import { ARMOURED, FOES } from '../../content/foes';
import { aimFromEdge, createAsteroid, headInward } from '../asteroid';
import { ASTEROID } from '../config';
import { TAU, turnBetween } from '../math';
import { wrapPosition } from '../wrap';
import type { FoeBehaviour } from './foe';

/** A shard of an armoured rock is a small rock, the size a rock of its weight breaks down to. */
const SHARD_SIZE = 2;

/**
 * An armoured rock: a plated rock that drifts and wraps like a rock, is pulled by gravity like one, and turns aside any
 * shot that strikes outside its soft arc, `ARMOURED.softArc` either side of its facing. It breaks into `ARMOURED.shards`
 * small rocks, which are rocks: they wrap, split and are shot like any other.
 */
export const ARMOURED_BEHAVIOUR: FoeBehaviour = {
  spawn(world, count, speedMultiplier) {
    const { arena, rng } = world;
    for (let i = 0; i < count; i++) {
      const foe = world.acquire('armoured');
      if (foe === null) return;
      const aim = aimFromEdge(rng, arena.field(), null, arena.ship);
      const [low, high] = ASTEROID.speedJitter;
      const speed = FOES.armoured.speed * speedMultiplier * rng.range(low, high);
      foe.x = aim.x;
      foe.y = aim.y;
      foe.vx = Math.cos(aim.angle) * speed;
      foe.vy = Math.sin(aim.angle) * speed;
      headInward(foe, aim.edge);
      foe.rotation = rng.range(0, TAU);
      foe.spin = rng.range(-ARMOURED.spin, ARMOURED.spin);
      world.commit(foe);
    }
  },

  step(foe, dt, field) {
    foe.x += foe.vx * dt;
    foe.y += foe.vy * dt;
    foe.rotation += foe.spin * dt;
    wrapPosition(foe, field);
  },

  deflects(foe, x, y) {
    return Math.abs(turnBetween(foe.rotation, Math.atan2(y - foe.y, x - foe.x))) > ARMOURED.softArc;
  },

  destroyed(foe, { arena, rng }) {
    const first = rng.range(0, TAU);
    for (let i = 0; i < ARMOURED.shards; i++) {
      const angle = first + (i * TAU) / ARMOURED.shards;
      arena.asteroids.push(createAsteroid(rng, foe.x, foe.y, SHARD_SIZE, angle, 1, arena.shapeRng, arena.nextId()));
    }
  },
};
