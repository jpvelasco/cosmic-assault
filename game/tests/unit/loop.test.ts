import { describe, expect, it } from 'vitest';
import { createFixedStepLoop } from '../../src/sim/loop';
import { STEP_SECONDS } from '../../src/sim/config';

interface StepCall {
  dt: number;
  isFirstStep: boolean;
}

function recordSteps(): { calls: StepCall[]; onStep: (dt: number, isFirstStep: boolean) => void } {
  const calls: StepCall[] = [];
  return {
    calls,
    onStep: (dt, isFirstStep) => {
      calls.push({ dt, isFirstStep });
    },
  };
}

describe('createFixedStepLoop', () => {
  it('runs two whole steps for a 1/60 s frame and flags only the first step of the call', () => {
    const loop = createFixedStepLoop();
    const { calls, onStep } = recordSteps();

    expect(loop.advance(1 / 60, onStep)).toBe(2);
    expect(calls).toEqual([
      { dt: STEP_SECONDS, isFirstStep: true },
      { dt: STEP_SECONDS, isFirstStep: false },
    ]);
  });

  it('carries the accumulator across calls so three 1/240 frames run 0, 1 and 0 steps', () => {
    const loop = createFixedStepLoop();
    const { onStep } = recordSteps();

    expect(loop.advance(1 / 240, onStep)).toBe(0);
    expect(loop.advance(1 / 240, onStep)).toBe(1);
    expect(loop.advance(1 / 240, onStep)).toBe(0);
  });

  it('clamps a long frame to maxFrameSeconds, caps steps, and drops the backlog', () => {
    const loop = createFixedStepLoop();
    const { calls, onStep } = recordSteps();

    expect(loop.advance(0.2, onStep)).toBe(5);
    expect(calls).toHaveLength(5);
    expect(loop.advance(0, onStep)).toBe(0);
  });

  it('runs zero steps and does not throw for negative or NaN frame times', () => {
    const loop = createFixedStepLoop();
    const { calls, onStep } = recordSteps();

    expect(loop.advance(-1, onStep)).toBe(0);
    expect(loop.advance(Number.NaN, onStep)).toBe(0);
    expect(loop.advance(Number.POSITIVE_INFINITY, onStep)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('reset() drops a partial accumulator', () => {
    const loop = createFixedStepLoop();
    const { onStep } = recordSteps();

    expect(loop.advance(1 / 240, onStep)).toBe(0);
    loop.reset();
    expect(loop.advance(1 / 240, onStep)).toBe(0);
  });
});
