import { STEP_SECONDS } from '../../src/sim/config';
import type { Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { World } from '../../src/sim/world';

export const PRACTICE_LOG_SEEDS = [1, 2, 3, 4] as const;
export const PRACTICE_LOG_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;
export const PRACTICE_LOG_SECONDS = 30;

const STEPS_PER_SECOND = Math.round(1 / STEP_SECONDS);
/** Seeds 3 and 4 run on the narrowest and widest fields, so the log covers the field-dependent spawn paths. */
const FIELDS: Readonly<Record<number, Field>> = {
  1: { width: 1280, height: 720 },
  2: { width: 1280, height: 720 },
  3: { width: 960, height: 720 },
  4: { width: 1680, height: 720 },
};

export interface PracticeSample {
  readonly second: number;
  readonly score: number;
  readonly lives: number;
  readonly asteroids: number;
  readonly status: string;
}

export interface PracticeRunLog {
  readonly seed: number;
  readonly level: number;
  readonly field: Field;
  /** Every event, tagged with the 0-based step it came from. */
  readonly events: readonly (SimEvent & { readonly step: number })[];
  readonly samples: readonly PracticeSample[];
}

const TURNS = [-1, 0, 1, 1, 0, -1] as const;

/** A fixed schedule that changes every 0.75 s: turning both ways, thrust on half the phases, fire on most. */
export function practiceScript(step: number): Controls {
  const phase = Math.floor(step / (STEPS_PER_SECOND * 0.75)) % TURNS.length;
  return { turn: TURNS[phase] ?? 0, thrust: phase % 2 === 0, fire: phase !== 4, stick: null };
}

function runLog(seed: number, level: number): PracticeRunLog {
  const field = FIELDS[seed] ?? { width: 1280, height: 720 };
  const world = new World({ seed, field, practiceLevel: level });
  const events: (SimEvent & { step: number })[] = [];
  const samples: PracticeSample[] = [];
  for (let step = 0; step < PRACTICE_LOG_SECONDS * STEPS_PER_SECOND; step++) {
    for (const e of world.step(STEP_SECONDS, practiceScript(step))) events.push({ ...e, step });
    if ((step + 1) % STEPS_PER_SECOND === 0) {
      samples.push({
        second: (step + 1) / STEPS_PER_SECOND,
        score: world.score,
        lives: world.lives,
        asteroids: world.asteroids.length,
        status: world.status,
      });
    }
  }
  return { seed, level, field, events, samples };
}

/** The deterministic practice event log: every seed at every level, 30 s of `practiceScript`. */
export function practiceLog(): PracticeRunLog[] {
  return PRACTICE_LOG_SEEDS.flatMap((seed) => PRACTICE_LOG_LEVELS.map((level) => runLog(seed, level)));
}
