import type { E2eHooks } from './app/e2eHooks';
import type { App } from './app/game';
import type { HazardState } from './sim/hazards/hazard';
import type { World } from './sim/world';

/** The error `crash()` throws, which the specs that call it allow in the console. Declared here only. */
export const DELIBERATE_CRASH = 'e2e: deliberate crash';
/** The bridge's shape version, raised whenever its state changes shape; the specs wait for this one. */
export const BRIDGE_VERSION = 10;

function shipState({ ship }: World): CosmicAssaultTestShip {
  const { x, y, vx, vy, angle, thrusting, invulnerable } = ship;
  return { x, y, vx, vy, angle, thrusting, invulnerable };
}

/** The timed effects running, kind to seconds left; none that are off. */
function runningEffects({ effects }: World): CosmicAssaultTestState['effects'] {
  return Object.fromEntries(Object.entries(effects).filter(([, seconds]) => seconds > 0));
}

/** The boss of the galaxy in play as plain data, or null before it arrives. */
function bossOf(world: World | null): CosmicAssaultTestState['boss'] {
  const boss = world?.boss;
  if (boss === null || boss === undefined) return null;
  const { id, state, hp, maxHp, phase, windup, active, vulnerable, parts, target } = boss;
  return { id, state, hp, maxHp, phase, windup, active, vulnerable, liveParts: parts.filter((part) => part.hp > 0).length, target: target === null ? null : { x: target.x, y: target.y } };
}

/** The sky in force as plain data: the seed it is drawn with, its set-piece and whether it is a boss galaxy's. */
function backdropOf({ seed, piece, boss }: App['backdrop']): CosmicAssaultTestState['backdrop'] {
  return { seed, piece, boss };
}

/** A hazard as plain data: a zone's size and a rift's second mouth with the rest. */
function hazardOf(hazard: Readonly<HazardState>): CosmicAssaultTestState['hazards'][number] {
  const { id, type, stage, x, y, intensity, remaining } = hazard;
  const base = { id, type, stage, x, y, intensity, remaining };
  if (hazard.type === 'dangerZone') return { ...base, w: hazard.w, h: hazard.h };
  if (hazard.type === 'warpRift') return { ...base, toX: hazard.toX, toY: hazard.toY };
  return base;
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

/** The Daily in play as plain data, or null outside one. */
function dailyOf({ daily }: App['run']): CosmicAssaultTestState['daily'] {
  return daily === null ? null : Object.freeze({ date: daily.date, twist: daily.twist, target: daily.target });
}

function snapshot(app: App, hooks: E2eHooks): CosmicAssaultTestState {
  const { world, flow, save } = app.run;
  return {
    mode: app.mode,
    screen: app.mode,
    galaxy: flow.galaxy,
    save: frozenCopy(save),
    rankRun: flow.rankRun === null ? null : frozenCopy(flow.rankRun),
    daily: dailyOf(app.run),
    score: world?.score ?? 0,
    lives: world?.lives ?? 0,
    ship: world === null ? null : shipState(world),
    asteroidCount: world?.asteroids.length ?? 0,
    projectileCount: world?.projectiles.length ?? 0,
    pickups: world?.pickups.map(({ id, kind, x, y, expiresIn }) => ({ id, kind, x, y, expiresIn })) ?? [],
    field: world === null ? null : { width: world.field.width, height: world.field.height },
    foes: world?.foes.map(({ id, kind, x, y, charging }) => ({ id, kind, x, y, charging })) ?? [],
    bolts: world?.bolts.map(({ id, source, owner, x, y, radius }) => ({ id, source, owner, x, y, radius })) ?? [],
    hazards: world?.hazards.map(hazardOf) ?? [],
    boss: bossOf(world),
    events: { ...hooks.e2eEventCounts },
    effects: world === null ? {} : runningEffects(world),
    weaponTier: world?.weaponTier ?? 0,
    shield: world?.shield ?? false,
    hudRects: app.hudRects.map(({ x, y, width, height }) => ({ x, y, width, height })),
    drawCount: app.drawCount,
    visualScale: app.visualScale,
    quality: { index: app.quality.index, name: app.quality.level.name, displayMs: app.quality.displayMs },
    frameStats: app.frameStats,
    muted: app.muted,
    palette: app.palette,
    backdrop: backdropOf(app.backdrop),
    musicTheme: app.musicTheme,
    settings: Object.freeze({ ...app.settings }),
    look: Object.freeze({ ...app.look }),
    motion: app.motion,
    audioState: app.audioState,
    logSize: app.log.size,
    fullscreen: app.fullscreen,
    spriteCache: hooks.e2eSpriteCache?.() ?? null,
    attract: hooks.e2eAttractState?.() ?? null,
  };
}

/** Exposes read-only game state to Playwright; main.ts imports this only in `--mode e2e` builds. */
export function exposeTestBridge(app: App, hooks: E2eHooks): void {
  window.__COSMIC_ASSAULT_TEST_API__ = {
    version: BRIDGE_VERSION,
    getState: () => snapshot(app, hooks),
    fastForward(seconds) {
      hooks.e2eFastForward?.(seconds);
    },
    damageBoss(damage) {
      hooks.e2eDamageBoss?.(damage);
    },
    grantPickup(kind) {
      hooks.e2eGrantPickup?.(kind);
    },
    restartFrameStats() {
      hooks.e2eRestartFrameStats?.();
    },
    attractNow() {
      hooks.e2eAttractNow?.();
    },
    crash() {
      hooks.e2eBeforeFrame = () => {
        hooks.e2eBeforeFrame = undefined;
        throw new Error(DELIBERATE_CRASH);
      };
    },
  };
}
