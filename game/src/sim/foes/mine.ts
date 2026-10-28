import { FOES, MINE } from '../../content/foes';
import { ASTEROID, PLAYER } from '../config';
import type { Field } from '../field';
import { TAU, TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Ship } from '../ship';
import { wrappedDistance } from '../wrap';
import { drift, driftSpeed } from './drift';
import type { Foe, FoeBehaviour } from './foe';

/** How near the ship a mine may arrive: its arm ring stays clear of the safe radius. */
const SPAWN_CLEARANCE = ASTEROID.safeRadius + MINE.armRadius;
/** A ship this near a mine's centre touches its arm ring. */
const ARM_REACH = MINE.armRadius + PLAYER.radius;
/** How far inside the field's edges a mine arrives, and how many random spots it tries before the sure one. */
const INSET = FOES.mine.radius * 2;
const TRIES = 16;
/** How fast a mine turns, at most, in radians a second: a slow tumble. */
const SPIN = 0.8;

/**
 * Puts `foe` somewhere inside the field at least `SPAWN_CLEARANCE` from the ship, across the wrap: a random spot,
 * tried up to `TRIES` times, else the farthest of a grid of nine, one of which is always far enough on any field the
 * game plays at.
 */
function place(foe: Foe, rng: Rng, field: Field, ship: Readonly<Ship>): void {
  for (let i = 0; i < TRIES; i++) {
    foe.x = rng.range(INSET, field.width - INSET);
    foe.y = rng.range(INSET, field.height - INSET);
    if (wrappedDistance(ship, foe, field) >= SPAWN_CLEARANCE) return;
  }
  let best = -1;
  for (const sx of [INSET, field.width / 2, field.width - INSET]) {
    for (const sy of [INSET, field.height / 2, field.height - INSET]) {
      const away = wrappedDistance(ship, { x: sx, y: sy }, field);
      if (away <= best) continue;
      best = away;
      foe.x = sx;
      foe.y = sy;
    }
  }
}

/**
 * A spiked mine drifting slowly through the field, wrapping as rocks do, with gravity wells pulling it. Its arm ring is
 * always on show: a ship that touches it arms the mine (`mineArmed`), and 0.6 s later it blasts (`mineBlast`),
 * striking a ship within 80 and destroying itself. It never arms against an invulnerable ship, and a shot destroys it,
 * armed or not, with no blast. It arrives inside the field, its ring clear of the ship's safe radius.
 */
export const MINE_BEHAVIOUR: FoeBehaviour = {
  spawn(world, count, speedMultiplier) {
    const { arena, rng } = world;
    const field = arena.field();
    for (let i = 0; i < count; i++) {
      const foe = world.acquire('mine');
      if (foe === null) return;
      place(foe, rng, field, arena.ship);
      const heading = rng.range(0, TAU);
      const speed = driftSpeed('mine', speedMultiplier, rng);
      foe.vx = Math.cos(heading) * speed;
      foe.vy = Math.sin(heading) * speed;
      foe.rotation = rng.range(0, TAU);
      foe.spin = rng.range(-SPIN, SPIN);
      world.commit(foe);
    }
  },

  step(foe, dt, field, world) {
    drift(foe, dt, field);
    const { ship, events } = world.arena;
    if (!foe.charging) {
      if (ship.invulnerable || wrappedDistance(ship, foe, field) >= ARM_REACH) return;
      foe.charging = true;
      foe.timer = MINE.fuse;
      events.push({ type: 'mineArmed', id: foe.id, x: foe.x, y: foe.y });
      return;
    }
    foe.timer -= dt;
    if (foe.timer <= TIME_EPSILON) world.detonate(foe, MINE.blastRadius);
  },
};
