import { describe, expect, it, vi } from 'vitest';
import { createCrashGuard } from '../../src/platform/crashGuard';
import { RingLog } from '../../src/platform/log';

const ORIGIN = 'https://example.test';
const OURS = `${ORIGIN}/next/assets/index-abc.js`;

interface FakeWindow extends EventTarget {
  location: { origin: string; href: string };
}

function fakeWindow(): FakeWindow {
  return Object.assign(new EventTarget(), { location: { origin: ORIGIN, href: `${ORIGIN}/next/index.html?seed=1` } });
}

/** An `error` event as browsers shape it (Node has no ErrorEvent). */
function errorEvent(props: { message?: string; filename?: string; error?: unknown }): Event {
  return Object.assign(new Event('error'), props);
}

function rejection(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

/** A function that throws `error` when called. */
function thrower(error: unknown): () => never {
  return () => {
    throw error;
  };
}

function stackedError(message: string, url: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at run (${url}:1:1)`;
  return error;
}

function setup() {
  const log = new RingLog();
  const onCrash = vi.fn();
  const guard = createCrashGuard(log, onCrash, () => 7);
  const win = fakeWindow();
  const detach = guard.attachGlobal(win);
  return { log, onCrash, guard, win, detach };
}

describe('createCrashGuard', () => {
  it('returns the result while nothing throws', () => {
    const { guard, onCrash } = setup();
    expect(guard.run(() => 42)).toBe(42);
    expect(guard.tripped).toBe(false);
    expect(onCrash).not.toHaveBeenCalled();
  });

  it('catches a throw, calls onCrash once with it and logs it', () => {
    const { guard, onCrash, log } = setup();
    const boom = new Error('boom');
    const result = guard.run<number>(thrower(boom));
    expect(result).toBeUndefined();
    expect(guard.tripped).toBe(true);
    expect(onCrash).toHaveBeenCalledExactlyOnceWith(boom);
    expect(log.entries()).toEqual([{ t: 7, kind: 'error', message: expect.stringContaining('boom') as string }]);
  });

  it('stops calling fn once tripped', () => {
    const { guard, onCrash } = setup();
    guard.run(thrower(new Error('first')));
    const fn = vi.fn(() => 1);
    expect(guard.run(fn)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    guard.run(thrower(new Error('second')));
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it('swallows a throw inside onCrash and logs it', () => {
    const log = new RingLog();
    const guard = createCrashGuard(log, thrower(new Error('card broke')));
    expect(() => {
      guard.run(thrower(new Error('boom')));
    }).not.toThrow();
    expect(guard.tripped).toBe(true);
    const messages = log.entries().map((entry) => entry.message);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain('card broke');
  });

  it('keeps the message when the stack lacks it, as in Firefox and Safari', () => {
    const { guard, log } = setup();
    const error = new Error('boom');
    error.stack = `run@${OURS}:1:1\nframe@${OURS}:2:2`;
    guard.run(thrower(error));
    expect(log.entries()[0]?.message).toBe(`Error: boom\nrun@${OURS}:1:1\nframe@${OURS}:2:2`);
  });

  it('does not repeat the message when the stack already starts with it', () => {
    const { guard, log } = setup();
    guard.run(thrower(stackedError('boom', OURS)));
    expect(log.entries()[0]?.message).toBe(`Error: boom\n    at run (${OURS}:1:1)`);
  });

  it('describes non-Error throws', () => {
    const { guard, log } = setup();
    guard.run(thrower('plain text'));
    expect(log.entries()[0]?.message).toContain('plain text');
  });
});

describe('attachGlobal', () => {
  it('logs and trips on an error from our own module', () => {
    const { win, log, onCrash, guard } = setup();
    win.dispatchEvent(errorEvent({ message: 'ours broke', filename: OURS, error: new Error('ours broke') }));
    expect(guard.tripped).toBe(true);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]?.kind).toBe('error');
  });

  it('logs but does not trip on a third-party error', () => {
    const { win, log, onCrash, guard } = setup();
    win.dispatchEvent(errorEvent({ message: 'ext', filename: 'chrome-extension://abc/content.js', error: new Error('ext') }));
    expect(guard.tripped).toBe(false);
    expect(onCrash).not.toHaveBeenCalled();
    expect(log.entries()).toHaveLength(1);
  });

  it('logs only the message of a third-party error, with no stack or extension URL', () => {
    const { win, log } = setup();
    const url = 'chrome-extension://abcdef/content.js';
    win.dispatchEvent(errorEvent({ message: 'ext', filename: url, error: stackedError('ext failed', url) }));
    win.dispatchEvent(rejection(stackedError('ext rejected', url)));
    expect(log.entries().map((entry) => entry.message)).toEqual(['Error: ext failed', 'Error: ext rejected']);
  });

  it('does not trip on a same-origin script outside our base path', () => {
    const { win, onCrash } = setup();
    win.dispatchEvent(errorEvent({ message: 'legacy', filename: `${ORIGIN}/game-modular.js` }));
    expect(onCrash).not.toHaveBeenCalled();
  });

  it('trips when only the stack points at our code', () => {
    const { win, onCrash } = setup();
    win.dispatchEvent(errorEvent({ message: 'x', error: stackedError('x', OURS) }));
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it('does not trip on a cross-origin "Script error." with no location', () => {
    const { win, log, onCrash } = setup();
    win.dispatchEvent(errorEvent({ message: 'Script error.', filename: '' }));
    expect(onCrash).not.toHaveBeenCalled();
    expect(log.entries()).toHaveLength(1);
  });

  it('trips on an unhandled rejection whose stack is ours', () => {
    const { win, onCrash, log } = setup();
    win.dispatchEvent(rejection(stackedError('late', OURS)));
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(log.entries()[0]?.message).toContain('late');
  });

  it('logs a third-party or non-Error rejection without tripping', () => {
    const { win, onCrash, log } = setup();
    win.dispatchEvent(rejection(stackedError('ext', 'chrome-extension://abc/x.js')));
    win.dispatchEvent(rejection('just a string'));
    expect(onCrash).not.toHaveBeenCalled();
    expect(log.entries()).toHaveLength(2);
  });

  it('stops listening once detached', () => {
    const { win, detach, log } = setup();
    detach();
    win.dispatchEvent(errorEvent({ message: 'late', filename: OURS }));
    win.dispatchEvent(rejection(stackedError('late', OURS)));
    expect(log.entries()).toHaveLength(0);
  });
});
