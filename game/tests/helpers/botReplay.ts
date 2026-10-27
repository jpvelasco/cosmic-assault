import { runGalaxy, type RunOptions, type RunResult } from '../../src/bot/run';
import type { GalaxyDef } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import type { Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { World } from '../../src/sim/world';

/** The field `runGalaxy` plays on by default: the 16:9 reference. */
export const REFERENCE_FIELD = { width: 1280, height: 720 };

export const copyControls = (c: Controls): Controls => ({ ...c, stick: c.stick === null ? null : { ...c.stick } });

export interface RecordedRun {
  readonly result: RunResult;
  /** The controls the bot sent, step by step. */
  readonly controls: readonly Controls[];
  /** Every event of the run, in order. */
  readonly events: readonly SimEvent[];
}

/** Runs a bot as `runGalaxy` does, keeping copies of every step's controls and events. */
export function recordRun(options: Omit<RunOptions, 'onStep'>): RecordedRun {
  const controls: Controls[] = [];
  const events: SimEvent[] = [];
  const result = runGalaxy({
    ...options,
    onStep: (_world, sent, stepEvents) => {
      controls.push(copyControls(sent));
      events.push(...stepEvents.map((e) => ({ ...e })));
    },
  });
  return { result, controls, events };
}

/** Steps a fresh free-play World of `galaxy` with `controls`, as recorded, and returns its events and final score. */
export function replayControls(galaxy: GalaxyDef, seed: number, controls: readonly Controls[]): { events: SimEvent[]; score: number } {
  const world = new World({ seed, field: REFERENCE_FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' } });
  const events: SimEvent[] = [];
  for (const sent of controls) events.push(...world.step(STEP_SECONDS, sent).map((e) => ({ ...e })));
  return { events, score: world.score };
}
