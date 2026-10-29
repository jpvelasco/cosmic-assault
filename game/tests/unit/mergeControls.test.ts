import { describe, expect, it } from 'vitest';
import { mergeControls } from '../../src/input/mergeControls';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';

const KEYS = { turn: 0, thrust: false, fire: false } as const;
const NO_TOUCH = { fire: false, stick: null };
const NO_MOUSE = { fire: false };
const stick = (angle: number) => ({ angle, distance: 30 });

describe('mergeControls', () => {
  it('is neutral when every source is', () => {
    expect(mergeControls(KEYS, NO_TOUCH, NO_CONTROLS, NO_MOUSE)).toEqual(NO_CONTROLS);
  });

  it.each<[string, Parameters<typeof mergeControls>]>([
    ['keys', [{ ...KEYS, fire: true }, NO_TOUCH, NO_CONTROLS, NO_MOUSE]],
    ['touch', [KEYS, { fire: true, stick: null }, NO_CONTROLS, NO_MOUSE]],
    ['the pad', [KEYS, NO_TOUCH, { ...NO_CONTROLS, fire: true }, NO_MOUSE]],
    ['the mouse', [KEYS, NO_TOUCH, NO_CONTROLS, { fire: true }]],
  ])('fires when %s fire', (_source, args) => {
    expect(mergeControls(...args).fire).toBe(true);
  });

  it('thrusts when the keys or the pad do', () => {
    expect(mergeControls({ ...KEYS, thrust: true }, NO_TOUCH, NO_CONTROLS, NO_MOUSE).thrust).toBe(true);
    expect(mergeControls(KEYS, NO_TOUCH, { ...NO_CONTROLS, thrust: true }, NO_MOUSE).thrust).toBe(true);
  });

  it('turns by the keys before the pad, and by the pad when the keys do not turn', () => {
    const pad: Controls = { ...NO_CONTROLS, turn: -1 };
    expect(mergeControls({ ...KEYS, turn: 1 }, NO_TOUCH, pad, NO_MOUSE).turn).toBe(1);
    expect(mergeControls(KEYS, NO_TOUCH, pad, NO_MOUSE).turn).toBe(-1);
  });

  it('lets the keys turn the ship even while a stick is reported (a drifting pad or a resting thumb)', () => {
    const merged = mergeControls({ ...KEYS, turn: -1, thrust: true }, { fire: false, stick: stick(1) }, { ...NO_CONTROLS, stick: stick(2) }, NO_MOUSE);
    expect(merged.stick).toBeNull();
    expect(merged.turn).toBe(-1);
    expect(merged.thrust).toBe(true);
  });

  it('steers by the touch stick before the pad stick', () => {
    const pad: Controls = { ...NO_CONTROLS, stick: stick(2) };
    expect(mergeControls(KEYS, { fire: false, stick: stick(1) }, pad, NO_MOUSE).stick).toEqual(stick(1));
    expect(mergeControls(KEYS, NO_TOUCH, pad, NO_MOUSE).stick).toEqual(stick(2));
  });
});
