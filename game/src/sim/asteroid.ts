import { ASTEROID, WRAP_MARGIN } from './config';
import type { Field } from './field';
import type { Rng } from './rng';
import type { Ship } from './ship';
import { wrapPosition } from './wrap';

/** 0 = large … 3 = tiny. */
export type AsteroidSize = 0 | 1 | 2 | 3;

export interface Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  size: AsteroidSize;
  radius: number;
  vertices: readonly { readonly x: number; readonly y: number }[];
}

export interface PracticeSettings {
  spawnInterval: number;
  minAsteroids: number;
  speedMultiplier: number;
}

const TINY: AsteroidSize = 3;
const TWO_PI = Math.PI * 2;
/** Live `circleCollision(x, y, 80, ship.x, ship.y, 150)`: the spawn point counts as an 80-radius circle. */
const SPAWN_POINT_RADIUS = 80;
const TARGET_BAND = [0.3, 0.7] as const;
const AIM_JITTER = 0.4;

function createVertices(rng: Rng, radius: number): { x: number; y: number }[] {
  const [minCount, maxCount] = ASTEROID.vertexCount;
  const count = rng.int(minCount, maxCount + 1);
  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TWO_PI;
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
): Asteroid {
  const rotation = rng.range(0, TWO_PI);
  const spin = rng.range(-ASTEROID.spinMax, ASTEROID.spinMax);
  const radius = ASTEROID.radii[size];
  const [jitterMin, jitterMax] = ASTEROID.speedJitter;
  const speed = ASTEROID.baseSpeeds[size] * speedMultiplier * rng.range(jitterMin, jitterMax);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation,
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
  wrapPosition(a, field);
}

export function splitAsteroid(rng: Rng, a: Asteroid, shapeRng: Rng = rng): readonly Asteroid[] {
  if (a.size === TINY) {
    return [];
  }
  const childSize = (a.size + 1) as AsteroidSize;
  const spread = ASTEROID.childAngleSpread / 2;
  const children: Asteroid[] = [];
  for (let i = 0; i < 2; i++) {
    const angle = a.rotation + rng.range(-spread, spread);
    const boost = 1 + rng.range(0, ASTEROID.childSpeedBoostMax);
    children.push(createAsteroid(rng, a.x, a.y, childSize, angle, boost, shapeRng));
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
type Edge = 0 | 1 | 2 | 3;

const EDGE_COUNT = 4;

function oppositeEdge(edge: Edge): Edge {
  return ((edge + 2) % EDGE_COUNT) as Edge;
}

interface SpawnPoint {
  readonly edge: Edge;
  readonly x: number;
  readonly y: number;
}

/**
 * The point on `edge`'s wrap line at `along` (x on the top and bottom edges, y on the sides).
 * The live game spawns 100 out, wraps there on the first frame and back on the next, entering
 * at the wrap line; spawning on it gives the same entry without the jump across the field.
 */
function edgePoint(edge: Edge, along: number, field: Field): SpawnPoint {
  switch (edge) {
    case 0:
      return { edge, x: along, y: -WRAP_MARGIN };
    case 1:
      return { edge, x: field.width + WRAP_MARGIN, y: along };
    case 2:
      return { edge, x: along, y: field.height + WRAP_MARGIN };
    case 3:
      return { edge, x: -WRAP_MARGIN, y: along };
  }
}

/** Picks a random edge and a point on its wrap line, flipped to the opposite edge when it lands near the ship. */
function pickSpawnPoint(rng: Rng, field: Field, ship: Ship | null): SpawnPoint {
  const edge = rng.int(0, EDGE_COUNT) as Edge;
  const along = rng.range(0, edge % 2 === 0 ? field.width : field.height);
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
function headInward(a: Asteroid, edge: Edge): void {
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

export function spawnPracticeAsteroid(
  rng: Rng,
  level: number,
  field: Field,
  ship: Ship | null,
  awayFromShip: boolean,
  shapeRng: Rng = rng,
): Asteroid {
  const point = pickSpawnPoint(rng, field, awayFromShip ? ship : null);
  const targetX = field.width * rng.range(TARGET_BAND[0], TARGET_BAND[1]);
  const targetY = field.height * rng.range(TARGET_BAND[0], TARGET_BAND[1]);
  const angle = Math.atan2(targetY - point.y, targetX - point.x) + rng.range(-AIM_JITTER, AIM_JITTER);
  const size = sizeForLevel(rng, level);
  const asteroid = createAsteroid(rng, point.x, point.y, size, angle, practiceSettings(level).speedMultiplier, shapeRng);
  headInward(asteroid, point.edge);
  return asteroid;
}
