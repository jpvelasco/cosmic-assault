import { STEP_SECONDS } from './config';

export interface FixedStepLoop {
  /** Runs whole steps for `frameSeconds`; returns how many ran. */
  advance(frameSeconds: number, onStep: (dt: number, isFirstStep: boolean) => void): number;
  /** Fraction of a step left in the accumulator, in [0, 1): how far to interpolate past the latest step. */
  alpha(): number;
  reset(): void; // drop the accumulator (used on pause/resume)
}

export interface FixedStepLoopOptions {
  step?: number;
  maxFrameSeconds?: number;
  maxSteps?: number;
}

const DEFAULT_MAX_FRAME_SECONDS = 0.05;
/** The longest frame the visuals and the attract demo take, so a stalled tab, or one back from the background, never jumps them ahead. */
const MAX_VISUAL_FRAME_SECONDS = 0.1;
const DEFAULT_MAX_STEPS = 5;
const STEP_EPSILON = 1e-9;

function clampFrame(frameSeconds: number, maxFrameSeconds: number): number {
  if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
    return 0;
  }
  return Math.min(frameSeconds, maxFrameSeconds);
}

/** A display frame of `frameSeconds` as the visuals and the attract demo take it: none if negative, at most MAX_VISUAL_FRAME_SECONDS. */
export const visualFrameSeconds = (frameSeconds: number): number => clampFrame(frameSeconds, MAX_VISUAL_FRAME_SECONDS);

function assertLoopOptions(step: number, maxFrameSeconds: number, maxSteps: number): void {
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError(
      `createFixedStepLoop() needs a finite step > 0 seconds (got ${String(step)}); pass a positive step such as 1 / 120`,
    );
  }
  if (!Number.isFinite(maxFrameSeconds) || maxFrameSeconds <= 0) {
    throw new RangeError(
      `createFixedStepLoop() needs a finite maxFrameSeconds > 0 (got ${String(maxFrameSeconds)}); pass a positive cap such as 0.05`,
    );
  }
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new RangeError(
      `createFixedStepLoop() needs a positive integer maxSteps (got ${String(maxSteps)}); pass a cap such as 5`,
    );
  }
}

export function createFixedStepLoop(opts: FixedStepLoopOptions = {}): FixedStepLoop {
  const step = opts.step ?? STEP_SECONDS;
  const maxFrameSeconds = opts.maxFrameSeconds ?? DEFAULT_MAX_FRAME_SECONDS;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  assertLoopOptions(step, maxFrameSeconds, maxSteps);
  const isWholeStep = (acc: number): boolean => acc >= step - STEP_EPSILON;
  let accumulator = 0;

  return {
    advance(frameSeconds, onStep) {
      accumulator += clampFrame(frameSeconds, maxFrameSeconds);
      let steps = 0;
      while (steps < maxSteps && isWholeStep(accumulator)) {
        onStep(step, steps === 0);
        accumulator -= step;
        steps++;
      }
      if (steps === maxSteps && isWholeStep(accumulator)) {
        accumulator = 0;
      }
      return steps;
    },
    alpha() {
      // A step fires once the accumulator is within STEP_EPSILON of `step`, so what is left is below 1;
      // only the epsilon leaves it a hair negative.
      return Math.max(0, accumulator / step);
    },
    reset() {
      accumulator = 0;
    },
  };
}
