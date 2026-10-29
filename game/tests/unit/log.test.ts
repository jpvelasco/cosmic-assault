import { describe, expect, it } from 'vitest';
import { errorMessage, MAX_MESSAGE_LENGTH, RingLog } from '../../src/platform/log';

describe('RingLog', () => {
  it('lists entries oldest first', () => {
    const log = new RingLog();
    log.add('mode', 'playing', 1);
    log.add('event', 'hello', 2);
    expect(log.entries()).toEqual([
      { t: 1, kind: 'mode', message: 'playing' },
      { t: 2, kind: 'event', message: 'hello' },
    ]);
    expect(log.size).toBe(2);
  });

  it('overwrites the oldest entry at capacity and keeps order', () => {
    const log = new RingLog(3);
    for (let i = 1; i <= 5; i++) log.add('event', `e${String(i)}`, i);
    expect(log.entries().map((entry) => entry.message)).toEqual(['e3', 'e4', 'e5']);
    expect(log.size).toBe(3);
  });

  it('defaults to 200 entries', () => {
    const log = new RingLog();
    for (let i = 0; i < 250; i++) log.add('event', String(i), i);
    expect(log.size).toBe(200);
    expect(log.entries()[0]?.message).toBe('50');
  });

  it('cuts a very long message so the log stays small', () => {
    const log = new RingLog(1);
    log.add('error', 'x'.repeat(MAX_MESSAGE_LENGTH + 500), 0);
    expect(log.entries()[0]?.message).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it('returns a copy, so callers cannot change the log', () => {
    const log = new RingLog(2);
    log.add('event', 'a', 0);
    log.entries().pop();
    expect(log.size).toBe(1);
  });

  it('rejects a capacity that is not a positive integer, saying what to use', () => {
    expect(() => new RingLog(0)).toThrow(/capacity.*positive whole number/);
    expect(() => new RingLog(1.5)).toThrow(/capacity/);
  });

  it('reports valid JSON holding the meta and the entries', () => {
    const log = new RingLog(2);
    log.add('stall', '1200 ms', 5);
    const parsed: unknown = JSON.parse(log.report({ build: 'v2.0.0 · local', mode: 'playing' }));
    expect(parsed).toEqual({
      meta: { build: 'v2.0.0 · local', mode: 'playing' },
      entries: [{ t: 5, kind: 'stall', message: '1200 ms' }],
    });
  });
});

describe('errorMessage', () => {
  it("gives an Error's message and anything else as text", () => {
    expect(errorMessage(new TypeError('denied'))).toBe('denied');
    expect(errorMessage('refused')).toBe('refused');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
