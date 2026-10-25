import type { Field } from '../sim/field';
import { TAU } from '../sim/math';
import { createRng } from '../sim/rng';

export interface StarLayers {
  /** Advances parallax and ambient drift by `dt` seconds for the ship's current velocity. */
  step(dt: number, shipVx: number, shipVy: number): void;
  /** Draws the twinkling stars in field units; `time` is in seconds. */
  draw(ctx: CanvasRenderingContext2D, time: number): void;
  /** Reseeds the layers for a field of a new size so stars fill it and keep their on-screen density; the same size keeps them. */
  resize(field: Field): void;
  /** Sets `scale` times the usual star count: each layer keeps its stars where they are, dropping or adding some. */
  setCountScale(scale: number): void;
}

export interface Star {
  x: number;
  y: number;
  /** Depth from far (small) to near (1): scales drift, size and brightness. */
  readonly z: number;
  readonly phase: number;
  readonly radius: number;
}

/** Fraction of the ship's velocity (scaled by depth) that the stars slide against it. */
export const PARALLAX_FACTOR = 0.04;
/** Slow sideways drift in field units per second for the nearest layer; scaled by depth. */
export const AMBIENT_DRIFT_X = -12;

const STAR_COLOR = '#fff4ff';
const TWINKLE_RATE = 2.5;
/** Stars per layer on the mockup's 480x300 panel: far, mid, near. */
const LAYERS = [
  { z: 0.25, count: 55 },
  { z: 0.55, count: 30 },
  { z: 1, count: 16 },
] as const;
const MOCKUP_ASPECT = 480 / 300;
const MOCKUP_HEIGHT = 300;
const MOCKUP_STAR_RADIUS = 1.3;

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Moves every star by `dt` seconds of parallax plus ambient drift, wrapping inside `field`. */
export function stepStars(stars: readonly Star[], dt: number, shipVx: number, shipVy: number, field: Field): void {
  const dx = -shipVx * PARALLAX_FACTOR + AMBIENT_DRIFT_X;
  const dy = -shipVy * PARALLAX_FACTOR;
  for (const star of stars) {
    star.x = wrap(star.x + dx * star.z * dt, field.width);
    star.y = wrap(star.y + dy * star.z * dt, field.height);
  }
}

/**
 * Seeds the three depth layers. Counts follow the mockup's density for the field's aspect,
 * times `countScale`; sizes follow its look scaled to the field's height.
 */
export function seedStars(seed: number, countScale: number, field: Field): Star[] {
  const rng = createRng(seed);
  const density = (field.width / field.height / MOCKUP_ASPECT) * countScale;
  const unit = (field.height / MOCKUP_HEIGHT) * MOCKUP_STAR_RADIUS;
  const stars: Star[] = [];
  for (const { z, count } of LAYERS) {
    const total = Math.max(1, Math.round(count * density));
    for (let i = 0; i < total; i++) {
      stars.push({
        x: rng.range(0, field.width),
        y: rng.range(0, field.height),
        z,
        phase: rng.range(0, TAU),
        radius: z * unit,
      });
    }
  }
  return stars;
}

/** `next`'s stars, except that each layer keeps as many of `current`'s as it has room for, where they are. */
function keepStars(current: readonly Star[], next: readonly Star[]): Star[] {
  return LAYERS.flatMap(({ z }) => {
    const kept = current.filter((star) => star.z === z);
    return next.filter((star) => star.z === z).map((star, i) => kept[i] ?? star);
  });
}

export function createStarLayers(seed: number, initialScale: number): StarLayers {
  let countScale = initialScale;
  let field: Field | null = null;
  let stars: Star[] = [];
  return {
    step(dt, shipVx, shipVy) {
      if (field !== null) stepStars(stars, dt, shipVx, shipVy, field);
    },
    draw(ctx, time) {
      ctx.fillStyle = STAR_COLOR;
      for (const star of stars) {
        ctx.globalAlpha = (0.4 + 0.6 * star.z) * (0.6 + 0.4 * Math.sin(time * TWINKLE_RATE + star.phase));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    resize(next) {
      const sameSize = field !== null && field.width === next.width && field.height === next.height;
      field = next;
      if (!sameSize) stars = seedStars(seed, countScale, next);
    },
    setCountScale(scale) {
      if (scale === countScale) return;
      countScale = scale;
      if (field !== null) stars = keepStars(stars, seedStars(seed, countScale, field));
    },
  };
}
