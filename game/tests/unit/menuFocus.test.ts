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

describe('nextFocus on mode select', () => {
  // Resume Rank over the three mode cards (Rank, Free play, the Daily), and the Records, Hangar and Back chips under them, as at 1366×860.
  const [RESUME, RANK, FREE, DAILY, RECORDS, HANGAR, BACK] = [0, 1, 2, 3, 4, 5, 6];
  const screen = [
    rect(583, 100, 200, 40),
    rect(293, 160, 240, 170),
    rect(553, 160, 240, 170),
    rect(813, 160, 240, 170),
    rect(560, 360, 80, 34),
    rect(650, 360, 80, 34),
    rect(740, 360, 80, 34),
  ];

  it('walks the three cards side by side, stopping at either end', () => {
    expect(nextFocus(screen, RANK, 'right')).toBe(FREE);
    expect(nextFocus(screen, FREE, 'right')).toBe(DAILY);
    expect(nextFocus(screen, DAILY, 'right')).toBe(DAILY);
    expect(nextFocus(screen, DAILY, 'left')).toBe(FREE);
    expect(nextFocus(screen, RANK, 'left')).toBe(RANK);
  });

  it('reaches the Daily from the chips and Resume above, and leaves it for either', () => {
    expect(nextFocus(screen, DAILY, 'up')).toBe(RESUME);
    expect(nextFocus(screen, DAILY, 'down')).toBe(BACK);
    // Every chip sits under the middle card, so up from any of them lands on Free play, one step from the Daily.
    for (const chip of [RECORDS, HANGAR, BACK]) expect(nextFocus(screen, chip, 'up')).toBe(FREE);
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
