import { ASTEROID, WRAP_MARGIN } from './config';
import type { Field } from './field';
import { TAU } from './math';
import type { Rng } from './rng';
import type { Ship } from './ship';
import { wrapPosition } from './wrap';

/** 0 = large … 3 = tiny. */
export type AsteroidSize = 0 | 1 | 2 | 3;

export interface Asteroid {
  /** Assigned by `World` from one counter shared with projectiles; 0 outside a World. */
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Position and rotation before the latest `World.step`, for interpolated drawing. `px`/`py` are the
   * raw position before the latest step; not wrap-adjusted — a renderer must not interpolate across a wrap.
   */
  px: number;
  py: number;
  rotation: number;
  protation: number;
  spin: number;
  size: AsteroidSize;
  radius: number;
  vertices: readonly { readonly x: number; readonly y: number }[];
  /** A pass-through rock (a meteor or a boss's shard): it never wraps, and leaves once past the field. Set when it is made and inherited by its fragments; absent on every other rock. */
  transient?: true;
  /**
   * Made by a boss's telegraphed attack (a quake's ring, a broadside, a shard ring), so a bot can tell it from rocks
   * that came unannounced. Set where the attack makes it, and never inherited: its fragments come unannounced.
   */
  fromAttack?: true;
}

export interface PracticeSettings {
  spawnInterval: number;
  minAsteroids: number;
  speedMultiplier: number;
}

const TINY: AsteroidSize = 3;
/** Live `circleCollision(x, y, 80, ship.x, ship.y, 150)`: the spawn point counts as an 80-radius circle. */
const SPAWN_POINT_RADIUS = 80;
const TARGET_BAND = [0.3, 0.7] as const;
const AIM_JITTER = 0.4;

/** Id source for asteroids made outside a `World`. */
const noId = (): number => 0;

function createVertices(rng: Rng, radius: number): { x: number; y: number }[] {
  const [minCount, maxCount] = ASTEROID.vertexCount;
  const count = rng.int(minCount, maxCount + 1);
  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU;
    const distance = radius * (1 + rng.range(-ASTEROID.jaggedness, ASTEROID.jaggedness));
    vertices.push({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });
  }
  return vertices;
}

export function createAsteroid(
  rng: Rng,
  x: number,
  y: number,
  size: AsteroidSize,
  angle: number,
  speedMultiplier: number,
  /** Draws only the vertex count and radii, so outline changes never shift gameplay draws. */
  shapeRng: Rng = rng,
  id = 0,
): Asteroid {
  const rotation = rng.range(0, TAU);
  const spin = rng.range(-ASTEROID.spinMax, ASTEROID.spinMax);
  const radius = ASTEROID.radii[size];
  const [jitterMin, jitterMax] = ASTEROID.speedJitter;
  const speed = ASTEROID.baseSpeeds[size] * speedMultiplier * rng.range(jitterMin, jitterMax);
  return {
    id,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    px: x,
    py: y,
    rotation,
    protation: rotation,
    spin,
    size,
    radius,
    vertices: createVertices(shapeRng, radius),
  };
}

export function stepAsteroid(a: Asteroid, dt: number, field: Field): void {
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.rotation += a.spin * dt;
  if (a.transient !== true) wrapPosition(a, field);
}

/** True once a rock lies wholly outside the field and is still heading away from it. */
export function hasLeftField(a: Readonly<Pick<Asteroid, 'x' | 'y' | 'vx' | 'vy' | 'radius'>>, field: Field): boolean {
  const r = a.radius;
  return (a.x < -r && a.vx < 0) || (a.x > field.width + r && a.vx > 0) || (a.y < -r && a.vy < 0) || (a.y > field.height + r && a.vy > 0);
}

export function splitAsteroid(
  rng: Rng,
  a: Asteroid,
  shapeRng: Rng = rng,
  nextId: () => number = noId,
): readonly Asteroid[] {
  if (a.size === TINY) {
    return [];
  }
  const childSize = (a.size + 1) as AsteroidSize;
  const spread = ASTEROID.childAngleSpread / 2;
  const children: Asteroid[] = [];
  for (let i = 0; i < 2; i++) {
    const angle = a.rotation + rng.range(-spread, spread);
    const boost = 1 + rng.range(0, ASTEROID.childSpeedBoostMax);
    const child = createAsteroid(rng, a.x, a.y, childSize, angle, boost, shapeRng, nextId());
    if (a.transient === true) child.transient = true;
    children.push(child);
  }
  return children;
}

export function practiceSettings(level: number): PracticeSettings {
  return {
    spawnInterval: Math.max(0.5, 3.5 - (level - 1) * 0.3),
    minAsteroids: 2 + Math.floor(level * 1.2),
    speedMultiplier: 1 + (level - 1) * 0.1,
  };
}

function sizeForLevel(rng: Rng, level: number): AsteroidSize {
  if (level >= 6 && rng.chance(0.15)) return 0;
  if (level >= 4 && rng.chance(0.25)) return 1;
  if (level >= 2 && rng.chance(0.35)) return 2;
  return TINY;
}

/** 0 top, 1 right, 2 bottom, 3 left. */
export type Edge = 0 | 1 | 2 | 3;

export const EDGE_COUNT = 4;

export function oppositeEdge(edge: Edge): Edge {
  return ((edge + 2) % EDGE_COUNT) as Edge;
}

/** Where an edge spawn enters, on the edge's wrap line, and the heading it is launched on. */
export interface EdgeAim {
  readonly edge: Edge;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** An `EdgeAim` before its heading is drawn. */
export interface SpawnPoint {
  readonly edge: Edge;
  readonly x: number;
  readonly y: number;
  angle: number;
}

/**
 * The point on `edge`'s wrap line at `along` (x on the top and bottom edges, y on the sides).
 * The live game spawns 100 out, wraps there on the first frame and back on the next, entering
 * at the wrap line; spawning on it gives the same entry without the jump across the field.
 */
export function edgePoint(edge: Edge, along: number, field: Field): SpawnPoint {
  switch (edge) {
    case 0:
      return { edge, x: along, y: -WRAP_MARGIN, angle: 0 };
    case 1:
      return { edge, x: field.width + WRAP_MARGIN, y: along, angle: 0 };
    case 2:
      return { edge, x: along, y: field.height + WRAP_MARGIN, angle: 0 };
    case 3:
      return { edge, x: -WRAP_MARGIN, y: along, angle: 0 };
  }
}

/** How far a point can lie along `edge`: the width on the top and bottom, the height on the sides. */
export function edgeLength(edge: Edge, field: Field): number {
  return edge % 2 === 0 ? field.width : field.height;
}

/** Picks a random edge and a point on its wrap line, flipped to the opposite edge when it lands near the ship. */
function pickSpawnPoint(rng: Rng, field: Field, ship: Readonly<Ship> | null): SpawnPoint {
  const edge = rng.int(0, EDGE_COUNT) as Edge;
  const along = rng.range(0, edgeLength(edge, field));
  const point = edgePoint(edge, along, field);
  const reach = SPAWN_POINT_RADIUS + ASTEROID.safeRadius;
  if (ship !== null && Math.hypot(point.x - ship.x, point.y - ship.y) < reach) {
    return edgePoint(oppositeEdge(edge), along, field);
  }
  return point;
}

/**
 * On wide fields the aim jitter can point a top or bottom spawn slightly back out (about 0.2% of
 * spawns at 21:9), which would wrap it across the field on its first step; mirror it inward instead.
 */
export function headInward(a: Pick<Asteroid, 'vx' | 'vy'>, edge: Edge): void {
  switch (edge) {
    case 0:
      a.vy = Math.abs(a.vy);
      break;
    case 1:
      a.vx = -Math.abs(a.vx);
      break;
    case 2:
      a.vy = -Math.abs(a.vy);
      break;
    case 3:
      a.vx = Math.abs(a.vx);
  }
}

/**
 * Picks where a rock enters, on `edge` or else a random edge flipped away from `avoid`, and aims it
 * at the centre of the field.
 */
export function aimFromEdge(rng: Rng, field: Field, edge: Edge | null, avoid: Readonly<Ship> | null): EdgeAim {
  const point = edge === null ? pickSpawnPoint(rng, field, avoid) : edgePoint(edge, rng.range(0, edgeLength(edge, field)), field);
  const targetX = field.width * rng.range(TARGET_BAND[0], TARGET_BAND[1]);
  const targetY = field.height * rng.range(TARGET_BAND[0], TARGET_BAND[1]);
  point.angle = Math.atan2(targetY - point.y, targetX - point.x) + rng.range(-AIM_JITTER, AIM_JITTER);
  return point;
}

/** A rock launched from `aim`, heading into the field. */
export function launchFromEdge(rng: Rng, aim: EdgeAim, size: AsteroidSize, speedMultiplier: number, shapeRng: Rng = rng, id = 0): Asteroid {
  const asteroid = createAsteroid(rng, aim.x, aim.y, size, aim.angle, speedMultiplier, shapeRng, id);
  headInward(asteroid, aim.edge);
  return asteroid;
}

export function spawnPracticeAsteroid(
  rng: Rng,
  level: number,
  field: Field,
  ship: Readonly<Ship> | null,
  awayFromShip: boolean,
  shapeRng: Rng = rng,
  id = 0,
): Asteroid {
  // The size is drawn after the aim: the practice draw order.
  const aim = aimFromEdge(rng, field, null, awayFromShip ? ship : null);
  return launchFromEdge(rng, aim, sizeForLevel(rng, level), practiceSettings(level).speedMultiplier, shapeRng, id);
}
