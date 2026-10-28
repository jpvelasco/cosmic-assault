import type { GalaxyId, PickupId } from '../content/types';
import { bossTarget } from '../sim/boss/bossRules';
import { PICKUP, STEP_SECONDS } from '../sim/config';
import type { Controls } from '../sim/controls';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import type { Attract } from './attract';
import type { Screen } from './flow';
import type { RunController } from './runController';

/** How many events of each type the run in play has produced. */
export type EventCounts = Partial<Record<SimEvent['type'], number>>;

/** Attract mode as plain data: whether it is on, the demo galaxy, the demo frames drawn, and whether a demo crash stopped it. */
export interface AttractState {
  readonly active: boolean;
  readonly demo: GalaxyId | null;
  readonly frames: number;
  readonly halted: boolean;
}

/**
 * Hooks an e2e build hands to `createApp`; `main.ts` passes them only under `import.meta.env.MODE === 'e2e'`, so
 * release builds carry no trace of them. The long property names are deliberate: unlike a local name they survive
 * minification, which lets `check:no-bridge` find them.
 */
export interface E2eHooks {
  /** Runs at the start of every guarded frame. */
  e2eBeforeFrame?: (() => void) | undefined;
  /** Set by `installE2eHooks`: steps the run in play by fixed steps for `seconds`, or until it leaves play. */
  e2eFastForward?: ((seconds: number) => void) | undefined;
  /** Set by `installE2eHooks`: lands `damage` shots on a boss that is fighting, each where it does harm; throws if none is. */
  e2eDamageBoss?: ((damage: number) => void) | undefined;
  /** Set by `installE2eHooks`: drops a pickup of `kind` onto the ship at the next step, announced and collected like any drop; throws outside a galaxy run. */
  e2eGrantPickup?: ((kind: PickupId) => void) | undefined;
  /** Set by `installE2eHooks`; the app calls it with every step's events, which it tallies into `e2eEventCounts`. */
  e2eEvents?: ((events: readonly SimEvent[], world: World) => void) | undefined;
  /** The events of the run in play by type, from its first step; a new run starts a new count. Undefined before any step. */
  e2eEventCounts?: EventCounts | undefined;
  /** Set by `installE2eHooks`: restarts the run's frame stats, warm-up included, so a measure can skip a settling stretch. */
  e2eRestartFrameStats?: (() => void) | undefined;
  /** Set by `installE2eHooks`: the sprite cache's use, the sprites it holds now and how many it has evicted. */
  e2eSpriteCache?: (() => Readonly<{ size: number; evictions: number }>) | undefined;
  /** Set by `installE2eHooks`: counts the title's idle stretch as over, so the next frame on the bare title starts the attract demo. */
  e2eAttractNow?: (() => void) | undefined;
  /** Set by `installE2eHooks`: attract mode's state now. */
  e2eAttractState?: (() => AttractState) | undefined;
}

export interface E2eHookDeps {
  readonly run: Pick<RunController, 'world' | 'step'>;
  mode(): Screen;
  /** The controls held now. */
  controls(): Controls;
  /** Asks for the canvas to be drawn on the next frame. */
  redraw(): void;
  /** Forgets the frame times measured so far, warm-up included. */
  restartFrameStats(): void;
  /** The sprite cache's use now. */
  spriteCache(): Readonly<{ size: number; evictions: number }>;
  readonly attract: Pick<Attract, 'active' | 'demo' | 'frames' | 'halted' | 'dueNow'>;
}

/**
 * Sets the e2e hooks (fast-forward, boss damage, pickup grant, event tally, frame-stats restart, sprite-cache use, attract
 * now and attract state), in an e2e build only:
 * a release build compiles this to nothing, which `check:no-bridge` proves by finding no hook name in `dist/`.
 */
export function installE2eHooks(e2e: E2eHooks | undefined, deps: E2eHookDeps): void {
  if (import.meta.env.MODE !== 'e2e' || e2e === undefined) return;
  const { run } = deps;
  e2e.e2eFastForward = (seconds) => {
    const controls = deps.controls();
    for (let t = 0; t < seconds && deps.mode() === 'playing'; t += STEP_SECONDS) run.step(STEP_SECONDS, controls);
    deps.redraw();
  };
  /**
   * One shot through the galaxy rules (private on World, reached by name here) where it does harm (`bossTarget`). False
   * if the boss is not fighting, or no shot can hurt it now.
   */
  const strikeBoss = (): boolean => {
    const { world } = run;
    const target = bossTarget(world?.boss ?? null);
    if (world === null || target === null) return false;
    return world['run']?.bosses.hitBoss(target.x, target.y, 1) === true;
  };
  e2e.e2eDamageBoss = (damage) => {
    let struck = 0;
    while (struck < damage && strikeBoss()) struck++;
    if (struck === 0) throw new Error('No boss is fighting where a shot can hurt it: fast-forward through the approach and the 2 s intro (for the Hive Carrier, on to a launch, which opens its hangar), and pass a damage of at least 1');
    deps.redraw();
  };
  e2e.e2eGrantPickup = (kind) => {
    const galaxy = run.world?.['run'] ?? null;
    if (galaxy === null) throw new Error('No galaxy run is in play to grant a pickup in: start a galaxy first (the title\'s Play, or open the e2e build with ?galaxy=)');
    const begin = galaxy.beginStep.bind(galaxy);
    // Inside the next step, so the drop's event reaches the app with that step's events instead of being cleared before it.
    galaxy.beginStep = () => {
      Reflect.deleteProperty(galaxy, 'beginStep');
      begin();
      const { x, y } = galaxy['arena'].ship;
      const field = galaxy['pickupField'];
      const id = ++field['lastId'];
      field.list.push({ id, kind, x, y, px: x, py: y, vx: 0, vy: 0, expiresIn: PICKUP.lifespan });
      galaxy['arena'].events.push({ type: 'pickupDropped', id, kind, x, y });
    };
  };
  e2e.e2eRestartFrameStats = () => {
    deps.restartFrameStats();
  };
  e2e.e2eSpriteCache = () => deps.spriteCache();
  const { attract } = deps;
  e2e.e2eAttractNow = () => {
    attract.dueNow();
  };
  e2e.e2eAttractState = () => ({ active: attract.active, demo: attract.demo?.galaxy ?? null, frames: attract.frames, halted: attract.halted });
  let counted: World | null = null;
  e2e.e2eEvents = (events, world) => {
    if (world !== counted) {
      counted = world;
      e2e.e2eEventCounts = {};
    }
    const counts: EventCounts = (e2e.e2eEventCounts ??= {});
    for (const { type } of events) counts[type] = (counts[type] ?? 0) + 1;
  };
}
