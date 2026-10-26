import { nextFocus, type FocusDirection } from '../input/menuFocus';

/** The one of `controls` that has keyboard focus, if any. */
export function focusedControl(controls: readonly HTMLElement[]): HTMLElement | null {
  return controls.find((el) => el === document.activeElement) ?? null;
}

/** Moves focus one step `dir` through `controls`; with nothing focused, lands on the first. */
export function moveFocus(controls: readonly HTMLElement[], dir: FocusDirection): void {
  const focused = focusedControl(controls);
  if (focused === null) {
    controls[0]?.focus();
    return;
  }
  const next = nextFocus(controls.map((el) => el.getBoundingClientRect()), controls.indexOf(focused), dir);
  controls[next]?.focus();
}

/** Steps a focused slider one notch the way its arrow keys would, and reports it so the game hears it live and saves it. */
export function nudgeSlider(el: HTMLElement, dir: 'left' | 'right'): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== 'range') return false;
  if (dir === 'left') el.stepDown();
  else el.stepUp();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
