export type FocusDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_DIRECTIONS: Readonly<Record<string, FocusDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** The direction an arrow key (`KeyboardEvent.code`) moves menu focus, or null for any other key. */
export function arrowDirection(code: string): FocusDirection | null {
  return ARROW_DIRECTIONS[code] ?? null;
}

/** How much a step off the line of travel costs against a step along it, so the item straight ahead wins. */
const SIDEWAYS_PENALTY = 2;

const centreX = (r: DOMRectReadOnly): number => r.left + r.width / 2;
const centreY = (r: DOMRectReadOnly): number => r.top + r.height / 2;

/**
 * The item `dir` of `items[current]`, or `current` when there is none. Sideways moves stay on the item's own row, and
 * vertical moves may land in any column; among the candidates the nearest wins, with a straight line favoured.
 */
export function nextFocus(items: readonly DOMRectReadOnly[], current: number, dir: FocusDirection): number {
  const from = items[current];
  if (from === undefined) return current;
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = current;
  let bestCost = Infinity;
  for (const [i, to] of items.entries()) {
    if (i === current) continue;
    const along = horizontal ? centreX(to) - centreX(from) : centreY(to) - centreY(from);
    if (along * sign <= 0) continue;
    if (horizontal && (to.bottom <= from.top || to.top >= from.bottom)) continue;
    const across = horizontal ? centreY(to) - centreY(from) : centreX(to) - centreX(from);
    const cost = Math.abs(along) + SIDEWAYS_PENALTY * Math.abs(across);
    if (cost < bestCost) {
      best = i;
      bestCost = cost;
    }
  }
  return best;
}
