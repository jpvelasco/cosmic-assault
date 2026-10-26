import type { App, E2eHooks } from './app/game';
import type { World } from './sim/world';

/** The error `crash()` throws, which the specs that call it allow in the console. Declared here only. */
export const DELIBERATE_CRASH = 'e2e: deliberate crash';

function shipState({ ship }: World): CosmicAssaultTestShip {
  const { x, y, vx, vy, angle, thrusting, invulnerable } = ship;
  return { x, y, vx, vy, angle, thrusting, invulnerable };
}

/** A copy of `value` frozen all the way down, so a spec cannot change the game's state through it. */
function frozenCopy<T>(value: T): T {
  const freeze = (v: unknown): unknown => {
    if (typeof v === 'object' && v !== null) {
      for (const child of Object.values(v)) freeze(child);
      Object.freeze(v);
    }
    return v;
  };
  return freeze(structuredClone(value)) as T;
}

function snapshot(app: App): CosmicAssaultTestState {
  const { world, flow } = app;
  return {
    mode: app.mode,
    screen: app.mode,
    galaxy: flow.galaxy,
    save: frozenCopy(app.save),
    rankRun: flow.rankRun === null ? null : frozenCopy(flow.rankRun),
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
    settings: Object.freeze({ ...app.settings }),
    motion: app.motion,
    audioState: app.audioState,
    logSize: app.log.size,
    fullscreen: app.fullscreen,
  };
}

/** Exposes read-only game state to Playwright; main.ts imports this only in `--mode e2e` builds. */
export function exposeTestBridge(app: App, hooks: E2eHooks): void {
  window.__COSMIC_ASSAULT_TEST_API__ = {
    version: 3,
    getState: () => snapshot(app),
    fastForward(seconds) {
      hooks.e2eFastForward?.(seconds);
    },
    crash() {
      hooks.e2eBeforeFrame = () => {
        hooks.e2eBeforeFrame = undefined;
        throw new Error(DELIBERATE_CRASH);
      };
    },
  };
}
