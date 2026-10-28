import { DRONE_SEPARATION, DRONE_TURN_RATE, FOES } from '../../content/foes';
import { edgePoint } from '../asteroid';
import type { FoeBehaviour } from './foe';
import { edgeLine, enterAt, steer, type Flight } from './steer';

const { radius: RADIUS, speed: SPEED } = FOES.drone;
/** Centre to centre along the edge: a clear gap of a radius between neighbours. */
const SPACING = RADIUS * 3;
const FLIGHT: Flight = { speed: SPEED, turnRate: DRONE_TURN_RATE, separation: DRONE_SEPARATION };

/**
 * A small craft that hunts the ship at a constant speed, turning toward it at a limited rate, so a wide circle or a
 * sharp turn of your own sheds it. It steers clear of the drones beside it as it seeks (`DRONE_SEPARATION`), so a
 * swarm stays a swarm of separate drones rather than stacking into one. It arrives in a line along one edge. Gravity wells do not pull it: its
 * speed is its own, and a nudge would break both that and the turn limit that makes it fair.
 */
export const DRONE: FoeBehaviour = {
  spawn(world, count) {
    const { arena, rng } = world;
    const field = arena.field();
    const [edge, start] = edgeLine(rng, count, SPACING, field, arena.ship);
    for (let i = 0; i < count; i++) {
      const foe = world.acquire('drone');
      if (foe === null) return;
      enterAt(foe, edgePoint(edge, start + i * SPACING, field), arena.ship, SPEED);
      world.commit(foe);
    }
  },

  step(foe, dt, field, { arena, list }) {
    steer(foe, arena.ship.x - foe.x, arena.ship.y - foe.y, dt, FLIGHT, field, list);
  },
};
