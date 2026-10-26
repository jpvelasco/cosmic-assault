import { DRONE_TURN_RATE, FOES } from '../../content/foes';
import { edgeLength, edgePoint, oppositeEdge, EDGE_COUNT, type Edge } from '../asteroid';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { TAU } from '../math';
import { wrapPosition } from '../wrap';
import type { FoeBehaviour } from './foe';
import type { Ship } from '../ship';
import type { Rng } from '../rng';

const { radius: RADIUS, speed: SPEED } = FOES.drone;
/** Centre to centre along the edge: a clear gap of a radius between neighbours. */
const SPACING = RADIUS * 3;

/** The signed turn from heading `from` to `to`, in (-π, π]. */
function turnBetween(from: number, to: number): number {
  const turn = (to - from) % TAU;
  if (turn > Math.PI) return turn - TAU;
  return turn <= -Math.PI ? turn + TAU : turn;
}

/** True when any of `count` drones spaced along `edge` from `start` would sit within the safe radius of the ship. */
function nearShip(edge: Edge, start: number, count: number, field: Field, ship: Readonly<Ship>): boolean {
  for (let i = 0; i < count; i++) {
    const at = edgePoint(edge, start + i * SPACING, field);
    if (Math.hypot(at.x - ship.x, at.y - ship.y) < ASTEROID.safeRadius) return true;
  }
  return false;
}

/**
 * A random edge and where along it a line of `count` drones starts, drawn as `[edge, start]`. A line that would come
 * within the safe radius of the ship goes to the opposite edge instead; that edge is always farther than the safe
 * radius, since the field is far deeper than twice it.
 */
function pickLine(rng: Rng, count: number, field: Field, ship: Readonly<Ship>): readonly [Edge, number] {
  const edge = rng.int(0, EDGE_COUNT) as Edge;
  const start = rng.range(0, Math.max(1, edgeLength(edge, field) - (count - 1) * SPACING));
  return nearShip(edge, start, count, field, ship) ? [oppositeEdge(edge), start] : [edge, start];
}

/**
 * A small craft that hunts the ship at a constant speed, turning toward it at a limited rate, so a wide circle or a
 * sharp turn of your own sheds it. It arrives in a line along one edge. Gravity wells do not pull it: its speed is
 * its own, and a nudge would break both that and the turn limit that makes it fair.
 */
export const DRONE: FoeBehaviour = {
  spawn(world, count) {
    const { arena, rng } = world;
    const field = arena.field();
    const [edge, start] = pickLine(rng, count, field, arena.ship);
    for (let i = 0; i < count; i++) {
      const foe = world.acquire('drone');
      if (foe === null) return;
      const at = edgePoint(edge, start + i * SPACING, field);
      foe.x = at.x;
      foe.y = at.y;
      foe.rotation = Math.atan2(arena.ship.y - at.y, arena.ship.x - at.x);
      foe.vx = Math.cos(foe.rotation) * SPEED;
      foe.vy = Math.sin(foe.rotation) * SPEED;
      world.commit(foe);
    }
  },

  step(foe, dt, field, { arena }) {
    const wanted = Math.atan2(arena.ship.y - foe.y, arena.ship.x - foe.x);
    const limit = DRONE_TURN_RATE * dt;
    foe.rotation += Math.max(-limit, Math.min(limit, turnBetween(foe.rotation, wanted)));
    foe.vx = Math.cos(foe.rotation) * SPEED;
    foe.vy = Math.sin(foe.rotation) * SPEED;
    foe.x += foe.vx * dt;
    foe.y += foe.vy * dt;
    wrapPosition(foe, field);
  },
};
