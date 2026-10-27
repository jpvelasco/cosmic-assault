import { edgeLength, edgePoint, oppositeEdge, EDGE_COUNT, type Edge } from '../asteroid';
import { ASTEROID } from '../config';
import type { Field } from '../field';
import { turnBetween } from '../math';
import type { Rng } from '../rng';
import type { Ship } from '../ship';
import { wrapDelta, wrapPosition } from '../wrap';
import type { Foe } from './foe';

// How the foes that fly themselves (drones, gunships) enter, seek and keep apart.

/** How a kind of foe keeps apart from its own: a neighbour within `radius` pushes it away, up to `weight` times its seek. */
export interface Separation {
  readonly radius: number;
  readonly weight: number;
}

/** How a foe flies: its constant speed, the most it turns a second, and how it keeps apart from its own kind. */
export interface Flight {
  readonly speed: number;
  readonly turnRate: number;
  readonly separation: Separation;
}

/**
 * The push away from the foes of its own kind crowding `foe`, in seek units: each neighbour within `radius` adds a
 * unit vector away from it, scaled by `weight` and by how deep inside that radius it is. Distances are taken across
 * the wrap, so a foe just over an edge counts as near (Ruling R14). Written into `out`, so a step allocates nothing.
 */
function separation(foe: Readonly<Foe>, foes: readonly Readonly<Foe>[], field: Field, { radius, weight }: Separation, out: { x: number; y: number }): void {
  out.x = out.y = 0;
  for (const other of foes) {
    if (other === foe || other.kind !== foe.kind || other.hp <= 0) continue;
    const dx = wrapDelta(foe.x - other.x, field.width);
    const dy = wrapDelta(foe.y - other.y, field.height);
    const gap = Math.hypot(dx, dy);
    // Two foes on one point have no "away"; the turn cap would spread them a step later anyway.
    if (gap === 0 || gap >= radius) continue;
    const push = (weight * (1 - gap / radius)) / gap;
    out.x += dx * push;
    out.y += dy * push;
  }
}

const away = { x: 0, y: 0 };

/**
 * Flies `foe` one step toward the offset (dx, dy) it seeks, kept clear of its own kind: it turns toward that heading by
 * at most its turn rate, then moves at its constant speed and wraps. The seek is the unit vector along (dx, dy);
 * scaling the push by its length instead keeps a lone foe's heading exactly atan2(dy, dx).
 */
export function steer(foe: Foe, dx: number, dy: number, dt: number, flight: Flight, field: Field, foes: readonly Readonly<Foe>[]): void {
  separation(foe, foes, field, flight.separation, away);
  const distance = Math.hypot(dx, dy);
  const wanted = Math.atan2(dy + away.y * distance, dx + away.x * distance);
  const limit = flight.turnRate * dt;
  foe.rotation += Math.max(-limit, Math.min(limit, turnBetween(foe.rotation, wanted)));
  foe.vx = Math.cos(foe.rotation) * flight.speed;
  foe.vy = Math.sin(foe.rotation) * flight.speed;
  foe.x += foe.vx * dt;
  foe.y += foe.vy * dt;
  wrapPosition(foe, field);
}

/** Puts `foe` at `at`, heading straight at the ship at `speed`: how a foe that flies itself enters. */
export function enterAt(foe: Foe, at: Readonly<{ x: number; y: number }>, ship: Readonly<Ship>, speed: number): void {
  foe.x = at.x;
  foe.y = at.y;
  foe.rotation = Math.atan2(ship.y - at.y, ship.x - at.x);
  foe.vx = Math.cos(foe.rotation) * speed;
  foe.vy = Math.sin(foe.rotation) * speed;
}

/** True when any of `count` foes `spacing` apart along `edge` from `start` would sit within the safe radius of the ship. */
function nearShip(edge: Edge, start: number, count: number, spacing: number, field: Field, ship: Readonly<Ship>): boolean {
  for (let i = 0; i < count; i++) {
    const at = edgePoint(edge, start + i * spacing, field);
    if (Math.hypot(at.x - ship.x, at.y - ship.y) < ASTEROID.safeRadius) return true;
  }
  return false;
}

/**
 * A random edge and where along it a line of `count` foes `spacing` apart starts, drawn as `[edge, start]`. A line that
 * would come within the safe radius of the ship goes to the opposite edge instead; that edge is always farther than the
 * safe radius, since the field is far deeper than twice it.
 */
export function edgeLine(rng: Rng, count: number, spacing: number, field: Field, ship: Readonly<Ship>): readonly [Edge, number] {
  const edge = rng.int(0, EDGE_COUNT) as Edge;
  const start = rng.range(0, Math.max(1, edgeLength(edge, field) - (count - 1) * spacing));
  return nearShip(edge, start, count, spacing, field, ship) ? [oppositeEdge(edge), start] : [edge, start];
}
