import type { App, E2eHooks } from './app/game';
import type { World } from './sim/world';

/** The message e2e specs allow in the console; the bridge is the only place it exists. */
const DELIBERATE_CRASH = 'e2e: deliberate crash';

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
    visualScale: app.visualScale,
    quality: { index: app.quality.index, name: app.quality.level.name },
    frameStats: app.frameStats,
    muted: app.muted,
    audioState: app.audioState,
    logSize: app.log.size,
  };
}

/** Exposes read-only game state to Playwright; main.ts imports this only in `--mode e2e` builds. */
export function exposeTestBridge(app: App, hooks: E2eHooks): void {
  window.__COSMIC_ASSAULT_TEST_API__ = {
    version: 3,
    getState: () => snapshot(app),
    crash() {
      hooks.e2eBeforeFrame = () => {
        hooks.e2eBeforeFrame = undefined;
        throw new Error(DELIBERATE_CRASH);
      };
    },
  };
}
