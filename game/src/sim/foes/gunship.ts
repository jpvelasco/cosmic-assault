import { clamp } from '../../content/curves';
import { BOLT, FOES, GUNSHIP } from '../../content/foes';
import { edgePoint } from '../asteroid';
import { fanBearing } from '../boss/attacks';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Foe, FoeBehaviour, FoeWorld } from './foe';
import { edgeLine, enterAt, steer, type Flight } from './steer';

const FLIGHT: Flight = { speed: FOES.gunship.speed, turnRate: GUNSHIP.turnRate, separation: GUNSHIP.separation };
/**
 * How far ahead round the ship it heads, and the circle the point it heads for lies on: wide enough that, chasing it,
 * the gunship settles on the circle midway through its orbit band (a point `lead` ahead on a circle of r is square to
 * the radius at r·cos(lead)).
 */
const ORBIT_LEAD = 0.6;
const ORBIT_RADIUS = (GUNSHIP.orbit[0] + GUNSHIP.orbit[1]) / 2 / Math.cos(ORBIT_LEAD);
/** How far inside the field's edges the point it heads for stays, so it circles a ship by a wall on screen. */
const ORBIT_INSET = FOES.gunship.radius * 2;

/** Seconds from one windup's start to the next: 2.6 ± 0.4, from the 'foes' stream. */
const cadence = (rng: Rng): number => rng.range(GUNSHIP.cadence - GUNSHIP.cadenceJitter, GUNSHIP.cadence + GUNSHIP.cadenceJitter);

const inField = (foe: Readonly<Foe>, field: Field): boolean => foe.x >= 0 && foe.x <= field.width && foe.y >= 0 && foe.y <= field.height;

const liveGunships = (list: readonly Readonly<Foe>[]): number => {
  let count = 0;
  for (const foe of list) if (foe.kind === 'gunship' && foe.hp > 0) count++;
  return count;
};

/** Heads for a point a little way round its circle about the ship, kept inside the field, clear of the gunships beside it. */
function circle(foe: Foe, dt: number, field: Field, { arena, list }: FoeWorld): void {
  const { ship } = arena;
  const bearing = foe.x === ship.x && foe.y === ship.y ? foe.rotation : Math.atan2(foe.y - ship.y, foe.x - ship.x);
  const ahead = bearing + foe.orbit * ORBIT_LEAD;
  const toX = clamp(ship.x + Math.cos(ahead) * ORBIT_RADIUS, ORBIT_INSET, field.width - ORBIT_INSET);
  const toY = clamp(ship.y + Math.sin(ahead) * ORBIT_RADIUS, ORBIT_INSET, field.height - ORBIT_INSET);
  steer(foe, toX - foe.x, toY - foe.y, dt, FLIGHT, field, list);
}

/** Starts a windup, aiming where the ship is now, if it may: inside the field, at a ship that can be hurt. */
function windUp(foe: Foe, field: Field, { arena }: FoeWorld): void {
  const { ship } = arena;
  // It waits, ready, for a ship it may fire at.
  if (ship.invulnerable || !inField(foe, field)) return;
  foe.charging = true;
  foe.timer = GUNSHIP.windup;
  foe.aimX = ship.x;
  foe.aimY = ship.y;
  arena.events.push({ type: 'foeWindup', id: foe.id, x: foe.x, y: foe.y, angle: Math.atan2(ship.y - foe.y, ship.x - foe.x) });
}

/** Ends a windup: one bolt at where the ship was as it began, unless the ship cannot be hurt now. Then it waits for the next. */
function fire(foe: Foe, { arena, bolts, rng }: FoeWorld): void {
  if (bolts === null) throw new RangeError("a gunship fires bolts, so its foe field needs the galaxy's bolts: pass them to FoeField (GalaxyRun passes its own)");
  foe.charging = false;
  foe.timer += cadence(rng) - GUNSHIP.windup;
  if (!arena.ship.invulnerable) bolts.fire(foe.x, foe.y, fanBearing(foe, foe.aimX, foe.aimY, 0, 1, 0), BOLT.speed, 'gunship', foe.id);
}

/**
 * A wedge gunship that circles the ship 240 to 300 units out and fires telegraphed bolts. Every 2.6 ± 0.4 s it winds
 * up for 0.5 s, its aim line on show and no bolt yet, then fires one bolt at where the ship was as the windup began.
 * It never fires at an invulnerable ship, nor from outside the field. It enters from an edge, outside the safe radius;
 * no more than 4 fly at once, and gravity wells do not pull it.
 */
export const GUNSHIP_BEHAVIOUR: FoeBehaviour = {
  spawn(world, count) {
    const { arena, rng } = world;
    const field = arena.field();
    for (let i = 0; i < count && liveGunships(world.list) < GUNSHIP.maxLive; i++) {
      const foe = world.acquire('gunship');
      if (foe === null) return;
      const [edge, along] = edgeLine(rng, 1, 0, field, arena.ship);
      enterAt(foe, edgePoint(edge, along, field), arena.ship, FLIGHT.speed);
      foe.orbit = rng.chance(0.5) ? 1 : -1;
      foe.timer = cadence(rng);
      world.commit(foe);
    }
  },

  step(foe, dt, field, world) {
    circle(foe, dt, field, world);
    foe.timer -= dt;
    if (foe.timer > TIME_EPSILON) return;
    if (foe.charging) fire(foe, world);
    else windUp(foe, field, world);
  },
};
