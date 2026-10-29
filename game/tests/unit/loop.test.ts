import { describe, expect, it } from 'vitest';
import { createFixedStepLoop, visualFrameSeconds } from '../../src/sim/loop';
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

  it('flags the first step of every call, including a repeated 1/60 frame', () => {
    const loop = createFixedStepLoop();
    const { calls, onStep } = recordSteps();

    loop.advance(1 / 60, onStep);
    calls.length = 0;
    expect(loop.advance(1 / 60, onStep)).toBe(2);
    expect(calls[0]?.isFirstStep).toBe(true);
    expect(calls[1]?.isFirstStep).toBe(false);
  });

  it('runs the expected whole-step count over a long 144 Hz run', () => {
    const loop = createFixedStepLoop();
    const { onStep } = recordSteps();
    let total = 0;

    for (let frame = 0; frame < 10_000; frame++) {
      total += loop.advance(1 / 144, onStep);
    }

    const expected = Math.floor((10_000 * (1 / 144)) / STEP_SECONDS);
    expect(Math.abs(total - expected)).toBeLessThanOrEqual(1);
  });

  it('uses defaults when no options are given', () => {
    expect(() => createFixedStepLoop()).not.toThrow();
    expect(() => createFixedStepLoop({})).not.toThrow();
  });

  it('rejects a non-positive or non-finite step with a message naming the fix', () => {
    for (const step of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createFixedStepLoop({ step })).toThrow(
        new RangeError(
          `createFixedStepLoop() needs a finite step > 0 seconds (got ${String(step)}); pass a positive step such as 1 / 120`,
        ),
      );
    }
  });

  it('rejects a non-positive or non-finite maxFrameSeconds', () => {
    for (const maxFrameSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createFixedStepLoop({ maxFrameSeconds })).toThrow(/needs/);
    }
  });

  it('rejects a maxSteps that is not a positive integer', () => {
    for (const maxSteps of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createFixedStepLoop({ maxSteps })).toThrow(/needs/);
    }
  });

  describe('alpha', () => {
    it('is 0 before any frame and after reset()', () => {
      const loop = createFixedStepLoop();
      const { onStep } = recordSteps();
      expect(loop.alpha()).toBe(0);
      loop.advance(1 / 240, onStep);
      loop.reset();
      expect(loop.alpha()).toBe(0);
    });

    it('is the carried fraction of a step: 0.5 after half a step', () => {
      const loop = createFixedStepLoop();
      const { onStep } = recordSteps();
      loop.advance(1 / 240, onStep);
      expect(loop.alpha()).toBeCloseTo(0.5, 9);
    });

    it('returns to the remainder after whole steps run', () => {
      const loop = createFixedStepLoop();
      const { onStep } = recordSteps();
      expect(loop.advance(1 / 240 + STEP_SECONDS, onStep)).toBe(1);
      expect(loop.alpha()).toBeCloseTo(0.5, 9);
    });

    it('is 0 after the max-steps backlog is dropped', () => {
      const loop = createFixedStepLoop();
      const { onStep } = recordSteps();
      loop.advance(0.2, onStep);
      expect(loop.alpha()).toBe(0);
    });

    it('stays within [0, 1) over a long run of uneven frames', () => {
      const loop = createFixedStepLoop();
      const { onStep } = recordSteps();
      for (let frame = 0; frame < 5000; frame++) {
        loop.advance(((frame * 7) % 13) / 700, onStep);
        expect(loop.alpha()).toBeGreaterThanOrEqual(0);
        expect(loop.alpha()).toBeLessThan(1);
      }
    });
  });
});

describe('visualFrameSeconds', () => {
  it('takes a display frame as it is, none if negative or not finite, and a stalled one as a tenth of a second', () => {
    expect(visualFrameSeconds(1 / 60)).toBe(1 / 60);
    expect(visualFrameSeconds(0.1)).toBe(0.1);
    expect(visualFrameSeconds(3)).toBe(0.1);
    expect(visualFrameSeconds(-1)).toBe(0);
    expect(visualFrameSeconds(Number.NaN)).toBe(0);
  });
});
