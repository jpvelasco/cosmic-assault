import { describe, expect, it } from 'vitest';
import { controlsFromKeys } from '../../src/input/keyboard';
import { createKeyLatch } from '../../src/input/keyLatch';

const keys = (...codes: string[]): Set<string> => new Set(codes);

describe('createKeyLatch', () => {
  it('passes held keys through when nothing is latched', () => {
    const held = keys('ArrowUp');
    expect(createKeyLatch().active(held)).toBe(held);
  });

  it('keeps Space held at start from firing until it is released and pressed again', () => {
    const latch = createKeyLatch();
    latch.latch(keys('Space'));
    expect(controlsFromKeys(latch.active(keys('Space'))).fire).toBe(false);
    expect(controlsFromKeys(latch.active(keys())).fire).toBe(false);
    expect(controlsFromKeys(latch.active(keys('Space'))).fire).toBe(true);
  });

  it('keeps ArrowLeft held at start from turning until it is released', () => {
    const latch = createKeyLatch();
    latch.latch(keys('ArrowLeft'));
    expect(controlsFromKeys(latch.active(keys('ArrowLeft'))).turn).toBe(0);
    latch.active(keys());
    expect(controlsFromKeys(latch.active(keys('ArrowLeft'))).turn).toBe(-1);
  });

  it('releases a latched key on a fresh press even if its release fell between frames', () => {
    const latch = createKeyLatch();
    latch.latch(keys('Space'));
    latch.release('Space');
    expect(controlsFromKeys(latch.active(keys('Space'))).fire).toBe(true);
  });

  it('ignores fresh presses of keys that are not latched', () => {
    const latch = createKeyLatch();
    latch.latch(keys('Space'));
    latch.release('ArrowUp');
    expect([...latch.active(keys('Space', 'ArrowUp'))]).toEqual(['ArrowUp']);
  });

  it('lets keys pressed after the latch through while latched ones stay blocked', () => {
    const latch = createKeyLatch();
    latch.latch(keys('Space'));
    const controls = controlsFromKeys(latch.active(keys('Space', 'ArrowUp')));
    expect(controls).toEqual({ turn: 0, thrust: true, fire: false });
  });

  it('releases each latched key independently', () => {
    const latch = createKeyLatch();
    latch.latch(keys('Space', 'ArrowLeft'));
    latch.active(keys('ArrowLeft'));
    expect([...latch.active(keys('ArrowLeft', 'Space'))]).toEqual(['Space']);
  });

  it('copies the held set, so later changes to it do not extend the latch', () => {
    const latch = createKeyLatch();
    const held = keys('Space');
    latch.latch(held);
    held.add('ArrowUp');
    expect([...latch.active(held)]).toEqual(['ArrowUp']);
  });

  it('replaces the previous latch on each start', () => {
    const latch = createKeyLatch();
    latch.latch(keys('Space'));
    latch.latch(keys('ArrowUp'));
    expect([...latch.active(keys('Space', 'ArrowUp'))]).toEqual(['Space']);
  });
});
