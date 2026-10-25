import type { App } from './app/game';
import type { World } from './sim/world';

function shipState({ ship }: World): CosmicAssaultTestShip {
  const { x, y, vx, vy, angle, thrusting, invulnerable } = ship;
  return { x, y, vx, vy, angle, thrusting, invulnerable };
}

function snapshot(app: App): CosmicAssaultTestState {
  const { world } = app;
  return {
    mode: app.mode,
    practiceLevel: app.practiceLevel,
    score: world?.score ?? 0,
    lives: world?.lives ?? 0,
    ship: world === null ? null : shipState(world),
    asteroidCount: world?.asteroids.length ?? 0,
    projectileCount: world?.projectiles.length ?? 0,
    hudRects: app.hudRects.map(({ x, y, width, height }) => ({ x, y, width, height })),
    drawCount: app.drawCount,
  };
}

/** Exposes read-only game state to Playwright; main.ts imports this only in `--mode e2e` builds. */
export function exposeTestBridge(app: App): void {
  window.__COSMIC_ASSAULT_TEST_API__ = { version: 3, getState: () => snapshot(app) };
}
