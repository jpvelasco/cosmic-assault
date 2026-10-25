import { ASTEROID } from './config';
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

/** Picks a point `edgeMargin` outside a random edge; returns the edge so it can be flipped. */
function pickEdgePoint(rng: Rng, field: Field): { edge: number; x: number; y: number } {
  const margin = ASTEROID.spawnEdgeMargin;
  const edge = rng.int(0, 4);
  switch (edge) {
    case 0:
      return { edge, x: rng.range(0, field.width), y: -margin };
    case 1:
      return { edge, x: field.width + margin, y: rng.range(0, field.height) };
    case 2:
      return { edge, x: rng.range(0, field.width), y: field.height + margin };
    default:
      return { edge, x: -margin, y: rng.range(0, field.height) };
  }
}

function flipToOppositeEdge(point: { edge: number; x: number; y: number }, field: Field): void {
  const margin = ASTEROID.spawnEdgeMargin;
  switch (point.edge) {
    case 0:
      point.y = field.height + margin;
      break;
    case 1:
      point.x = -margin;
      break;
    case 2:
      point.y = -margin;
      break;
    default:
      point.x = field.width + margin;
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
  const point = pickEdgePoint(rng, field);
  if (awayFromShip && ship !== null) {
    const reach = SPAWN_POINT_RADIUS + ASTEROID.safeRadius;
    if (Math.hypot(point.x - ship.x, point.y - ship.y) < reach) {
      flipToOppositeEdge(point, field);
    }
  }
  const targetX = field.width * rng.range(TARGET_BAND[0], TARGET_BAND[1]);
  const targetY = field.height * rng.range(TARGET_BAND[0], TARGET_BAND[1]);
  const angle = Math.atan2(targetY - point.y, targetX - point.x) + rng.range(-AIM_JITTER, AIM_JITTER);
  const size = sizeForLevel(rng, level);
  return createAsteroid(rng, point.x, point.y, size, angle, practiceSettings(level).speedMultiplier, shapeRng);
}
