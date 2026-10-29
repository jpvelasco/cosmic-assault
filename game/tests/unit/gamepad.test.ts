import { describe, expect, it, vi } from 'vitest';
import { controlsFromPad, createPadFireLatch, createPadReader, padEdges, padInUse, pickPad, snapshotPad } from '../../src/input/gamepad';
import { NO_CONTROLS } from '../../src/sim/controls';
import { pad } from '../helpers/padSnapshot';

describe('controlsFromPad', () => {
  it('maps no pad and a resting pad to neutral controls', () => {
    expect(controlsFromPad(null)).toEqual(NO_CONTROLS);
    expect(controlsFromPad(pad())).toEqual(NO_CONTROLS);
  });

  it.each([
    [0.1, 0],
    [-0.15, 0.1],
    [0.2, 0],
  ])('ignores a stick inside the dead zone (%f, %f)', (x, y) => {
    expect(controlsFromPad(pad([], [x, y, 0, 0])).stick).toBeNull();
  });

  it('turns a full stick push into full thrust in the direction pushed', () => {
    const stick = controlsFromPad(pad([], [0, 1, 0, 0])).stick;
    expect(stick?.angle).toBeCloseTo(Math.PI / 2);
    expect(stick?.distance).toBeCloseTo(60);
  });

  it('scales the stick distance linearly from the dead zone edge', () => {
    const stick = controlsFromPad(pad([], [-0.6, 0, 0, 0])).stick;
    expect(stick?.angle).toBeCloseTo(Math.PI);
    expect(stick?.distance).toBeCloseTo(30);
  });

  it('clamps a corner push (magnitude above 1) at full thrust', () => {
    expect(controlsFromPad(pad([], [1, 1, 0, 0])).stick?.distance).toBe(60);
  });

  it('reads only the left stick', () => {
    expect(controlsFromPad(pad([], [0, 0, 1, 1])).stick).toBeNull();
  });

  it('survives a pad with missing axes', () => {
    expect(controlsFromPad({ axes: [], pressed: [] })).toEqual(NO_CONTROLS);
  });

  it.each([
    [14, -1],
    [15, 1],
  ])('turns with D-pad button %i', (button, turn) => {
    expect(controlsFromPad(pad([button])).turn).toBe(turn);
  });

  it('cancels the turn when both sides are held', () => {
    expect(controlsFromPad(pad([14, 15])).turn).toBe(0);
  });

  it('thrusts with D-pad up', () => {
    expect(controlsFromPad(pad([12])).thrust).toBe(true);
    expect(controlsFromPad(pad([13])).thrust).toBe(false);
  });

  it.each([0, 5, 7])('fires with button %i', (button) => {
    expect(controlsFromPad(pad([button])).fire).toBe(true);
  });

  it.each([1, 2, 3, 4, 6, 9])('does not fire with button %i', (button) => {
    expect(controlsFromPad(pad([button])).fire).toBe(false);
  });
});

describe('padEdges', () => {
  it.each([
    [0, 'confirm'],
    [1, 'back'],
    [9, 'pause'],
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
  ])('reports button %i as %s once per press', (button, edge) => {
    const down = pad([button]);
    expect(padEdges(pad(), down)).toEqual([edge]);
    expect(padEdges(down, down)).toEqual([]);
    expect(padEdges(down, pad())).toEqual([]);
  });

  it('treats a pad that appears with a button already down as a press', () => {
    expect(padEdges(null, pad([0]))).toEqual(['confirm']);
  });

  it('reports nothing for a pad that goes away or was never there', () => {
    expect(padEdges(pad([0]), null)).toEqual([]);
    expect(padEdges(null, null)).toEqual([]);
  });

  it('ignores buttons that are not menu buttons', () => {
    expect(padEdges(pad(), pad([2, 3, 5, 7]))).toEqual([]);
  });

  it('reports the stick as a direction once it crosses 0.5 and again only after it returns', () => {
    const rest = pad();
    const right = pad([], [0.6, 0, 0, 0]);
    expect(padEdges(rest, right)).toEqual(['right']);
    expect(padEdges(right, pad([], [0.9, 0, 0, 0]))).toEqual([]);
    expect(padEdges(right, rest)).toEqual([]);
    expect(padEdges(rest, right)).toEqual(['right']);
  });

  it.each([
    [[-0.7, 0], 'left'],
    [[0, -0.7], 'up'],
    [[0, 0.7], 'down'],
  ] as const)('reports a stick pushed to %j as %s', ([x, y], edge) => {
    expect(padEdges(pad(), pad([], [x, y, 0, 0]))).toEqual([edge]);
  });

  it('does not report a stick below 0.5', () => {
    expect(padEdges(pad(), pad([], [0.4, 0, 0, 0]))).toEqual([]);
  });

  it('reports only the dominant axis of a diagonal push', () => {
    expect(padEdges(pad(), pad([], [0.6, 0.9, 0, 0]))).toEqual(['down']);
  });

  it('does not report a direction twice when the D-pad and the stick agree', () => {
    expect(padEdges(pad(), pad([15], [0.9, 0, 0, 0]))).toEqual(['right']);
  });

  it('reports several buttons pressed in one frame', () => {
    expect(padEdges(pad(), pad([0, 15]))).toEqual(['confirm', 'right']);
  });
});

describe('padInUse', () => {
  it('is false for no pad and for a pad at rest, its stick inside the dead zone', () => {
    expect(padInUse(null)).toBe(false);
    expect(padInUse(pad())).toBe(false);
    expect(padInUse(pad([], [0.15, -0.1, 0, 0]))).toBe(false);
  });

  it.each([0, 1, 5, 7, 9, 12, 16])('is true while button %i is held, menu button or not', (button) => {
    expect(padInUse(pad([button]))).toBe(true);
  });

  it('is true for a stick pushed past the dead zone, short of a menu direction', () => {
    expect(padInUse(pad([], [0.3, 0, 0, 0]))).toBe(true);
    expect(padInUse(pad([], [0.16, 0.16, 0, 0]))).toBe(true);
  });
});

describe('pickPad and snapshotPad', () => {
  const fake = (mapping: string, extra: Partial<Gamepad> = {}): Gamepad =>
    ({
      mapping,
      axes: [0.5, -0.25],
      buttons: [{ pressed: true }, { pressed: false }],
      ...extra,
    }) as unknown as Gamepad;

  it('finds nothing when no pad is connected', () => {
    expect(pickPad([])).toBeNull();
    expect(pickPad([null, null, null, null])).toBeNull();
  });

  it('prefers the first pad with the standard mapping', () => {
    const odd = fake('');
    const standard = fake('standard');
    expect(pickPad([null, odd, standard, fake('standard')])).toBe(standard);
  });

  it('falls back to the first pad of any mapping', () => {
    const odd = fake('');
    expect(pickPad([null, odd, fake('')])).toBe(odd);
  });

  it('copies axes and pressed flags, so a reused Gamepad object cannot change a kept snapshot', () => {
    const live = fake('standard');
    const snapshot = snapshotPad(live);
    (live.axes as number[])[0] = 0;
    (live.buttons[0] as { pressed: boolean }).pressed = false;
    expect(snapshot).toEqual({ axes: [0.5, -0.25], pressed: [true, false] });
  });

  it('snapshots no pad as null', () => {
    expect(snapshotPad(null)).toBeNull();
  });
});

describe('createPadReader', () => {
  const connected = { mapping: 'standard', axes: [0], buttons: [{ pressed: true }] } as unknown as Gamepad;

  it('reads the active pad on every call, and null once it is gone', () => {
    let pads: (Gamepad | null)[] = [connected];
    const read = createPadReader(() => pads, vi.fn());
    expect(read()).toEqual({ axes: [0], pressed: [true] });
    pads = [null];
    expect(read()).toBeNull();
  });

  it('reports a failing Gamepad API once and reads null from then on', () => {
    const getPads = vi.fn(() => {
      throw new Error('blocked');
    });
    const onUnavailable = vi.fn();
    const read = createPadReader(getPads, onUnavailable);
    expect(read()).toBeNull();
    expect(read()).toBeNull();
    expect(getPads).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});

describe('createPadFireLatch', () => {
  const firing = { ...NO_CONTROLS, fire: true };

  it('passes controls through when nothing is latched', () => {
    const latch = createPadFireLatch();
    expect(latch.apply(firing)).toBe(firing);
  });

  it('silences a fire button held at the latch until it is released', () => {
    const latch = createPadFireLatch();
    latch.latch(pad([0]));
    expect(latch.apply(firing).fire).toBe(false);
    expect(latch.apply(NO_CONTROLS).fire).toBe(false);
    expect(latch.apply(firing).fire).toBe(true);
  });

  it('keeps the other controls while latched', () => {
    const latch = createPadFireLatch();
    latch.latch(pad([7]));
    expect(latch.apply({ ...firing, turn: 1, thrust: true })).toEqual({ turn: 1, thrust: true, fire: false, stick: null });
  });

  it('latches nothing when the pad is not firing or is gone', () => {
    const latch = createPadFireLatch();
    latch.latch(pad([12]));
    expect(latch.apply(firing).fire).toBe(true);
    latch.latch(null);
    expect(latch.apply(firing).fire).toBe(true);
  });
});
