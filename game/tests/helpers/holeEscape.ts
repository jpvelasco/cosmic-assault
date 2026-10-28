import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import type { HazardState } from '../../src/sim/hazards/hazard';
import type { GalaxyEvent } from '../../src/content/types';
import { shipPullAt, type ShipPull } from '../../src/sim/hazards/shipPull';
import { nudge, turnBetween } from '../../src/sim/math';
import { createShip, stepShip, type Ship } from '../../src/sim/ship';
import { BLACK_HOLE, WELL_SPEED_CAP } from '../../src/content/hazards';

/** The contact radius: a ship whose centre comes within it of the hole's centre is lost. */
export const CONTACT = BLACK_HOLE.horizon + PLAYER.radius;
/** A ship at this distance from the hole is out of its pull for good. */
export const ESCAPE_RADIUS = 240;
/** The bound an escape is measured against: a worst start escapes in about 6.1 s. */
export const ESCAPE_SECONDS = 7;
const DT = STEP_SECONDS;

/** The outcome of one flight: whether it touched the hole, and when it reached `ESCAPE_RADIUS` if it did. */
export interface Flight {
  readonly contact: boolean;
  readonly escapedAt: number | null;
}

/** `angle` turned toward `target` by at most `maxStep` radians, the short way round. */
export function turnTowards(angle: number, target: number, maxStep: number): number {
  const diff = turnBetween(angle, target);
  return angle + Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
}

/** A ship at (x, y) moving at (vx, vy) with its nose at `angle`, with no invulnerability to spare it. */
export function shipAt(x: number, y: number, vx = 0, vy = 0, angle = 0): Ship {
  const ship = createShip(x, y);
  ship.invulnerable = false;
  ship.invulnerableFor = 0;
  ship.vx = vx;
  ship.vy = vy;
  ship.angle = angle;
  return ship;
}

/**
 * Flies a ship out of a hole of `intensity` at the centre of `field`, from (x, y) with velocity (vx, vy). It turns away
 * at the keyboard's rate from the first step, and holds full thrust once `reaction` seconds have passed, the way out. The
 * reaction is a thrustless turn, not a coast: a ship that neither turns nor thrusts through it needs to start about 8 units
 * further out (292 against 284 at top speed, heading straight in). `pulls` adds more
 * hazard states to the hole's pull, each stepped with the ship (the strongest other pull that can coexist).
 */
export function flyOut(
  start: { x: number; y: number; vx?: number; vy?: number; angle?: number },
  intensity: GalaxyEvent['intensity'],
  field: Field,
  { reaction = 0, adversary = false, turnFirst = false }: { reaction?: number; adversary?: boolean; turnFirst?: boolean } = {},
): Flight {
  const cx = field.width / 2;
  const cy = field.height / 2;
  const ship = shipAt(start.x, start.y, start.vx ?? 0, start.vy ?? 0, start.angle ?? Math.atan2(cy - start.y, cx - start.x));
  const pull: ShipPull = { x: 0, y: 0 };
  const states: HazardState[] = [{ id: 1, type: 'blackHole', stage: 'active', x: cx, y: cy, intensity, remaining: 60 }];
  if (adversary) states.push({ id: 2, type: 'repulsionField', stage: 'active', x: 0, y: 0, intensity: 3, remaining: 60 });
  const reactionSteps = Math.round(reaction / DT);
  for (let step = 0; step < ESCAPE_SECONDS / DT; step++) {
    const outward = Math.atan2(ship.y - cy, ship.x - cx);
    // Thrust held from the reaction on, or, turning first, only once the nose is nearly out.
    ship.angle = turnTowards(ship.angle, outward, PLAYER.turnSpeed * DT);
    const thrust = step >= reactionSteps && (!turnFirst || Math.abs(turnBetween(ship.angle, outward)) < 0.3);
    stepShip(ship, { ...NO_CONTROLS, thrust }, DT, field);
    if (adversary) states[1] = { id: 2, type: 'repulsionField', stage: 'active', x: ship.x + Math.cos(outward) * 60, y: ship.y + Math.sin(outward) * 60, intensity: 3, remaining: 60 };
    shipPullAt(states, ship.x, ship.y, DT, pull);
    nudge(ship, pull.x, pull.y, WELL_SPEED_CAP);
    const dx = ship.x - cx;
    const dy = ship.y - cy;
    const r = Math.hypot(dx, dy);
    if (r < CONTACT) return { contact: true, escapedAt: null };
    // Out of the pull once it is far off and flying away from the hole, not merely passing through the distance.
    if (r >= ESCAPE_RADIUS && ship.vx * dx + ship.vy * dy > 0) return { contact: false, escapedAt: step * DT };
  }
  return { contact: false, escapedAt: null };
}

/**
 * Whether a ship can get out from (x, y) with velocity (vx, vy) and heading `angle`, by the better of the two plans the
 * keyboard allows: thrust held through the turn, or the turn first. Both turn without thrust through the reaction.
 */
export function canEscape(start: { x: number; y: number; vx?: number; vy?: number; angle?: number }, intensity: GalaxyEvent['intensity'], field: Field, reaction: number, adversary = false): boolean {
  return [false, true].some((turnFirst) => !flyOut(start, intensity, field, { reaction, adversary, turnFirst }).contact);
}

/** Seconds a ship at rest at (x, y), with no pull, needs to fly out of `ring` (a radius about the centre), turning away with thrust held. */
export function clearTime(x: number, y: number, ring: number, field: Field): number {
  const cx = field.width / 2;
  const cy = field.height / 2;
  const ship: Ship = shipAt(x, y, 0, 0, Math.atan2(cy - y, cx - x));
  for (let step = 0; step < ESCAPE_SECONDS / DT; step++) {
    const outward = Math.atan2(ship.y - cy, ship.x - cx);
    ship.angle = turnTowards(ship.angle, outward, PLAYER.turnSpeed * DT);
    stepShip(ship, { ...NO_CONTROLS, thrust: true }, DT, field);
    if (Math.hypot(cx - ship.x, cy - ship.y) >= ring) return step * DT;
  }
  return Infinity;
}
