import { describe, expect, it } from 'vitest';
import { controlsFromKeys, GAME_KEY_CODES } from '../../src/input/keyboard';
import { attachKeyboard } from '../../src/input/keyboardSource';
import { stickFromOffset } from '../../src/input/stick';

const keys = (...codes: string[]): ReadonlySet<string> => new Set(codes);

describe('controlsFromKeys', () => {
  it('maps nothing held to neutral', () => {
    expect(controlsFromKeys(keys())).toEqual({ turn: 0, thrust: false, fire: false });
  });

  it.each(['ArrowLeft', 'KeyA'])('turns left on %s', (code) => {
    expect(controlsFromKeys(keys(code)).turn).toBe(-1);
  });

  it.each(['ArrowRight', 'KeyD'])('turns right on %s', (code) => {
    expect(controlsFromKeys(keys(code)).turn).toBe(1);
  });

  it.each(['ArrowUp', 'KeyW'])('thrusts on %s', (code) => {
    expect(controlsFromKeys(keys(code)).thrust).toBe(true);
  });

  it.each(['Space', 'ShiftLeft', 'ShiftRight'])('fires on %s', (code) => {
    expect(controlsFromKeys(keys(code)).fire).toBe(true);
  });

  it.each([
    ['ArrowLeft', 'ArrowRight'],
    ['KeyA', 'KeyD'],
    ['ArrowLeft', 'KeyD'],
  ])('cancels turn when %s and %s are both held', (a, b) => {
    expect(controlsFromKeys(keys(a, b)).turn).toBe(0);
  });

  it('ignores unrelated keys', () => {
    expect(controlsFromKeys(keys('KeyZ', 'KeyD'))).toEqual({ turn: 1, thrust: false, fire: false });
  });

  it('claims exactly the game keys, with no debug binding', () => {
    expect([...GAME_KEY_CODES].sort()).toEqual(
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyW', 'Space', 'ShiftLeft', 'ShiftRight'].sort(),
    );
  });
});

describe('stickFromOffset', () => {
  it('reports distance and angle for a rightward drag', () => {
    expect(stickFromOffset(30, 0, 60)).toEqual({ angle: 0, distance: 30 });
  });

  it('does not clamp the distance past the base radius', () => {
    const stick = stickFromOffset(0, 120, 60);
    expect(stick.distance).toBe(120);
    expect(stick.angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('scales distance so the base radius maps to 60', () => {
    expect(stickFromOffset(45, 0, 90).distance).toBe(30);
    expect(stickFromOffset(90, 0, 90).distance).toBe(60);
  });

  it('uses the screen-space atan2(dy, dx) angle', () => {
    expect(stickFromOffset(-10, 0, 60).angle).toBeCloseTo(Math.PI, 10);
    expect(stickFromOffset(0, -10, 60).angle).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('is neutral at the centre', () => {
    expect(stickFromOffset(0, 0, 60)).toEqual({ angle: 0, distance: 0 });
  });
});

interface FakeEvent {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  prevented: boolean;
  preventDefault(): void;
}

function fakeTarget() {
  const listeners = new Map<string, Set<(e: never) => void>>();
  return {
    addEventListener(type: string, fn: (e: never) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: (e: never) => void) {
      listeners.get(type)?.delete(fn);
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    fire(type: string, e?: FakeEvent) {
      for (const fn of listeners.get(type) ?? []) (fn as (e?: FakeEvent) => void)(e);
    },
  };
}

function ev(code: string, repeat = false, mods: Partial<Pick<FakeEvent, 'ctrlKey' | 'metaKey' | 'altKey'>> = {}): FakeEvent {
  return {
    code,
    repeat,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

describe('attachKeyboard', () => {
  it('tracks held keys on keydown and keyup', () => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    target.fire('keydown', ev('KeyW'));
    target.fire('keydown', ev('Space'));
    expect(kb.held).toEqual(new Set(['KeyW', 'Space']));
    target.fire('keyup', ev('KeyW'));
    expect(kb.held).toEqual(new Set(['Space']));
  });

  it('drains pressed codes in order, once', () => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    target.fire('keydown', ev('KeyP'));
    target.fire('keydown', ev('Digit3'));
    target.fire('keydown', ev('KeyR'));
    expect(kb.drainPressed()).toEqual(['KeyP', 'Digit3', 'KeyR']);
    expect(kb.drainPressed()).toEqual([]);
  });

  it('ignores auto-repeat for pressed edges', () => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    target.fire('keydown', ev('Escape'));
    kb.drainPressed();
    target.fire('keydown', ev('Escape', true));
    expect(kb.drainPressed()).toEqual([]);
    expect(kb.held.has('Escape')).toBe(true);
  });

  it('prevents default only for game keys', () => {
    const target = fakeTarget();
    attachKeyboard(target);
    const space = ev('Space');
    const other = ev('KeyP');
    target.fire('keydown', space);
    target.fire('keydown', other);
    expect(space.prevented).toBe(true);
    expect(other.prevented).toBe(false);
  });

  it.each([
    ['KeyA', { ctrlKey: true }],
    ['KeyD', { metaKey: true }],
    ['ArrowLeft', { altKey: true }],
  ] as const)('ignores %s chorded with a modifier', (code, mods) => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    const chord = ev(code, false, mods);
    target.fire('keydown', chord);
    expect(chord.prevented).toBe(false);
    expect(kb.held.size).toBe(0);
    expect(kb.drainPressed()).toEqual([]);
  });

  it('releases a held key on keyup even if a modifier is down', () => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    target.fire('keydown', ev('KeyA'));
    target.fire('keyup', ev('KeyA', false, { metaKey: true }));
    expect(kb.held.has('KeyA')).toBe(false);
  });

  it.each(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight'])(
    'clears held keys when %s is released (swallowed keyups)',
    (code) => {
      const target = fakeTarget();
      const kb = attachKeyboard(target);
      target.fire('keydown', ev('KeyA'));
      target.fire('keyup', ev(code));
      expect(kb.held.size).toBe(0);
    },
  );

  it('clears held and pending pressed codes on blur', () => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    target.fire('keydown', ev('KeyW'));
    target.fire('keydown', ev('KeyP'));
    target.fire('blur');
    expect(kb.held.size).toBe(0);
    expect(kb.drainPressed()).toEqual([]);
  });

  it('removes every listener on dispose', () => {
    const target = fakeTarget();
    const kb = attachKeyboard(target);
    expect(target.count()).toBeGreaterThan(0);
    kb.dispose();
    expect(target.count()).toBe(0);
    target.fire('keydown', ev('KeyW'));
    expect(kb.held.size).toBe(0);
  });
});
