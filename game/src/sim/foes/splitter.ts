import { FOES, FRAGMENT_SPEED_MULTIPLIER, SPLITTER_FRAGMENTS } from '../../content/foes';
import { aimFromEdge, headInward } from '../asteroid';
import { ASTEROID } from '../config';
import { TAU } from '../math';
import { wrapPosition } from '../wrap';
import type { FoeBehaviour } from './foe';
import { breakInto } from './shatter';

const TINY = 3;

/**
 * A rock that takes two hits and breaks into three fast, tiny fragments. It drifts and wraps like a rock, enters the way
 * a rock does and is pulled by gravity wells like one. Its fragments are made by the rock path, `transient` like a
 * meteor's: they pass through the field and never split.
 */
export const SPLITTER: FoeBehaviour = {
  spawn(world, count, speedMultiplier) {
    const { arena, rng } = world;
    for (let i = 0; i < count; i++) {
      const foe = world.acquire('splitter');
      if (foe === null) return;
      const aim = aimFromEdge(rng, arena.field(), null, arena.ship);
      const [low, high] = ASTEROID.speedJitter;
      const speed = FOES.splitter.speed * speedMultiplier * rng.range(low, high);
      foe.x = aim.x;
      foe.y = aim.y;
      foe.vx = Math.cos(aim.angle) * speed;
      foe.vy = Math.sin(aim.angle) * speed;
      headInward(foe, aim.edge);
      foe.rotation = rng.range(0, TAU);
      foe.spin = rng.range(-ASTEROID.spinMax, ASTEROID.spinMax);
      world.commit(foe);
    }
  },

  step(foe, dt, field) {
    foe.x += foe.vx * dt;
    foe.y += foe.vy * dt;
    foe.rotation += foe.spin * dt;
    wrapPosition(foe, field);
  },

  destroyed(foe, world) {
    breakInto(foe, world, SPLITTER_FRAGMENTS, TINY, FRAGMENT_SPEED_MULTIPLIER, true);
  },
};
