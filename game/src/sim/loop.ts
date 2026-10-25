import { STEP_SECONDS } from './config';

export interface FixedStepLoop {
  /** Runs whole steps for `frameSeconds`; returns how many ran. */
  advance(frameSeconds: number, onStep: (dt: number, isFirstStep: boolean) => void): number;
  reset(): void; // drop the accumulator (used on pause/resume)
}

export interface FixedStepLoopOptions {
  step?: number;
  maxFrameSeconds?: number;
  maxSteps?: number;
}

const DEFAULT_MAX_FRAME_SECONDS = 0.05;
const DEFAULT_MAX_STEPS = 5;
const STEP_EPSILON = 1e-9;

function clampFrame(frameSeconds: number, maxFrameSeconds: number): number {
  if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
    return 0;
  }
  return Math.min(frameSeconds, maxFrameSeconds);
}

export function createFixedStepLoop(opts: FixedStepLoopOptions = {}): FixedStepLoop {
  const step = opts.step ?? STEP_SECONDS;
  const maxFrameSeconds = opts.maxFrameSeconds ?? DEFAULT_MAX_FRAME_SECONDS;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
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
    reset() {
      accumulator = 0;
    },
  };
}
