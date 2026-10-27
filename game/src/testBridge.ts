import type { E2eHooks } from './app/e2eHooks';
import type { App } from './app/game';
import type { World } from './sim/world';

/** The error `crash()` throws, which the specs that call it allow in the console. Declared here only. */
export const DELIBERATE_CRASH = 'e2e: deliberate crash';

function shipState({ ship }: World): CosmicAssaultTestShip {
  const { x, y, vx, vy, angle, thrusting, invulnerable } = ship;
  return { x, y, vx, vy, angle, thrusting, invulnerable };
}

/** The timed effects running, kind to seconds left; none that are off. */
function runningEffects({ effects }: World): CosmicAssaultTestState['effects'] {
  return Object.fromEntries(Object.entries(effects).filter(([, seconds]) => seconds > 0));
}

/** The gravity well being telegraphed or pulling, as a list of zero or one. */
function wellsOf(world: World | null): CosmicAssaultTestState['wells'] {
  const well = world?.well;
  return well === null || well === undefined ? [] : [{ id: well.id, stage: well.stage, x: well.x, y: well.y, intensity: well.intensity, remaining: well.remaining }];
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
  const { world, flow, save } = app.run;
  return {
    mode: app.mode,
    screen: app.mode,
    galaxy: flow.galaxy,
    save: frozenCopy(save),
    rankRun: flow.rankRun === null ? null : frozenCopy(flow.rankRun),
    score: world?.score ?? 0,
    lives: world?.lives ?? 0,
    ship: world === null ? null : shipState(world),
    asteroidCount: world?.asteroids.length ?? 0,
    projectileCount: world?.projectiles.length ?? 0,
    pickups: world?.pickups.map(({ id, kind, x, y, expiresIn }) => ({ id, kind, x, y, expiresIn })) ?? [],
    foes: world?.foes.map(({ id, kind, x, y }) => ({ id, kind, x, y })) ?? [],
    wells: wellsOf(world),
    effects: world === null ? {} : runningEffects(world),
    weaponTier: world?.weaponTier ?? 0,
    shield: world?.shield ?? false,
    hudRects: app.hudRects.map(({ x, y, width, height }) => ({ x, y, width, height })),
    drawCount: app.drawCount,
    visualScale: app.visualScale,
    quality: { index: app.quality.index, name: app.quality.level.name },
    frameStats: app.frameStats,
    muted: app.muted,
    palette: app.palette,
    musicTheme: app.musicTheme,
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
    damageBoss(damage) {
      hooks.e2eDamageBoss?.(damage);
    },
    crash() {
      hooks.e2eBeforeFrame = () => {
        hooks.e2eBeforeFrame = undefined;
        throw new Error(DELIBERATE_CRASH);
      };
    },
  };
}
