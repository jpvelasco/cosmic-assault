import { devices } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { E2E_SEED } from '../../e2e/seed';
import { PROJECTILE, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { fieldForViewport, type Field } from '../../src/sim/field';
import { World } from '../../src/sim/world';

/** The fire assertions finish within about 1 s of a run starting; this leaves slow CI hosts headroom. */
const GUARD_SECONDS = 2.5;

interface Lane {
  readonly name: string;
  readonly field: Field;
  /** Distance from the lane's centre line, for an asteroid at (x, y) in a field whose ship starts at its centre. */
  readonly offset: (x: number, y: number, field: Field) => number;
}

const pixel5 = devices['Pixel 5 landscape'].viewport;
const LANES: readonly Lane[] = [
  // keyboard.spec.ts fires straight up from the start pose.
  { name: 'desktop, straight up', field: fieldForViewport(1280, 720), offset: (x, _y, f) => x - f.width / 2 },
  // touch.spec.ts fires while the stick holds the ship at angle 0, so its shots keep to the centre row.
  { name: 'phone, straight right', field: fieldForViewport(pixel5.width, pixel5.height), offset: (_x, y, f) => y - f.height / 2 },
];

/** Steps the e2e run with no input and reports whether any asteroid ever overlaps the lane. */
function lanesStayClear(seed: number, lane: Lane): boolean {
  const world = new World({ seed, field: lane.field, practiceLevel: 1 });
  for (let t = 0; t < GUARD_SECONDS; t += STEP_SECONDS) {
    world.step(STEP_SECONDS, NO_CONTROLS);
    const crossed = world.asteroids.some(
      (a) => Math.abs(lane.offset(a.x, a.y, lane.field)) < a.radius + PROJECTILE.radius,
    );
    if (crossed) return false;
  }
  return true;
}

describe('E2E_SEED', () => {
  it.each(LANES)('keeps asteroids out of the $name firing lane', (lane) => {
    expect(
      lanesStayClear(E2E_SEED, lane),
      `seed ${String(E2E_SEED)}'s asteroid layout now crosses the e2e firing lanes; re-pick E2E_SEED in game/e2e/seed.ts (search seeds with this test) because spawning or RNG consumption changed`,
    ).toBe(true);
  });
});
