import { bossTarget } from '../sim/boss/bossRunner';
import { STEP_SECONDS } from '../sim/config';
import type { Controls } from '../sim/controls';
import type { Screen } from './flow';
import type { RunController } from './runController';

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
}

export interface E2eHookDeps {
  readonly run: Pick<RunController, 'world' | 'step'>;
  mode(): Screen;
  /** The controls held now. */
  controls(): Controls;
  /** Asks for the canvas to be drawn on the next frame. */
  redraw(): void;
}

/**
 * Sets the fast-forward and boss-damage hooks, in an e2e build only: a release build compiles this to nothing, which
 * `check:no-bridge` proves by finding neither hook name in `dist/`.
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
   * One shot through the galaxy rules (private on World, reached by name here) where it does harm: the core, or while
   * it is shielded a live part. False if the boss is not fighting.
   */
  const strikeBoss = (): boolean => {
    const { world } = run;
    const boss = world?.boss ?? null;
    const target = boss === null ? null : bossTarget(boss);
    if (world === null || target === null) return false;
    return world['run']?.hitBoss(target.x, target.y, 1) === true;
  };
  e2e.e2eDamageBoss = (damage) => {
    let struck = 0;
    while (struck < damage && strikeBoss()) struck++;
    if (struck === 0) throw new Error('No boss is fighting: fast-forward through the approach and the 2 s intro, and pass a damage of at least 1');
    deps.redraw();
  };
}
