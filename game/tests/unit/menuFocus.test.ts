import { describe, expect, it } from 'vitest';
import { arrowDirection, nextFocus } from '../../src/input/menuFocus';

const rect = (x: number, y: number, width = 40, height = 20): DOMRectReadOnly =>
  ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRectReadOnly;

describe('nextFocus', () => {
  const row = [rect(0, 0), rect(50, 0), rect(100, 0)];

  it('moves along a row', () => {
    expect(nextFocus(row, 0, 'right')).toBe(1);
    expect(nextFocus(row, 1, 'right')).toBe(2);
    expect(nextFocus(row, 2, 'left')).toBe(1);
  });

  it('keeps the current item at the ends of a row and when nothing lies up or down', () => {
    expect(nextFocus(row, 2, 'right')).toBe(2);
    expect(nextFocus(row, 0, 'left')).toBe(0);
    expect(nextFocus(row, 1, 'up')).toBe(1);
    expect(nextFocus(row, 1, 'down')).toBe(1);
  });

  const card = [rect(0, 0, 200), rect(0, 40, 200), rect(0, 80, 200)];

  it('moves down and up a vertical card', () => {
    expect(nextFocus(card, 0, 'down')).toBe(1);
    expect(nextFocus(card, 1, 'down')).toBe(2);
    expect(nextFocus(card, 2, 'up')).toBe(1);
  });

  it('keeps the current item at the ends of a vertical card and sideways', () => {
    expect(nextFocus(card, 0, 'up')).toBe(0);
    expect(nextFocus(card, 2, 'down')).toBe(2);
    expect(nextFocus(card, 1, 'left')).toBe(1);
    expect(nextFocus(card, 1, 'right')).toBe(1);
  });

  it('goes to the nearest item below by column, not the first in document order', () => {
    const levels = [rect(0, 0), rect(50, 0), rect(100, 0), rect(0, 40), rect(50, 40), rect(100, 40)];
    expect(nextFocus(levels, 2, 'down')).toBe(5);
    expect(nextFocus(levels, 1, 'down')).toBe(4);
    expect(nextFocus(levels, 3, 'up')).toBe(0);
  });

  it('prefers the item straight ahead over a nearer one that is far off to the side', () => {
    const items = [rect(100, 0), rect(0, 30), rect(100, 50)];
    expect(nextFocus(items, 0, 'down')).toBe(2);
  });

  it('keeps sideways moves on the item\'s own row', () => {
    const items = [rect(0, 0), rect(100, 40)];
    expect(nextFocus(items, 0, 'right')).toBe(0);
    expect(nextFocus(items, 1, 'left')).toBe(1);
  });

  it('keeps current for an out-of-range index or an empty list', () => {
    expect(nextFocus([], 0, 'down')).toBe(0);
    expect(nextFocus(row, -1, 'right')).toBe(-1);
  });
});

describe('arrowDirection', () => {
  it.each([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
  ])('maps %s to %s', (code, direction) => {
    expect(arrowDirection(code)).toBe(direction);
  });

  it.each(['KeyW', 'KeyA', 'Space', 'Enter'])('ignores %s', (code) => {
    expect(arrowDirection(code)).toBeNull();
  });
});
