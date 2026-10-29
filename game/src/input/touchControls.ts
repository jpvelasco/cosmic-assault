import type { Stick } from '../sim/controls';
import { stickFromOffset } from './stick';

const BASE_SIZE_PX = 120;
const HANDLE_SIZE_PX = 50;
const FIRE_SIZE_PX = 80;
const PAUSE_SIZE_PX = 44;
const MAX_HANDLE_TRAVEL_PX = (BASE_SIZE_PX - HANDLE_SIZE_PX) / 2;
type Side = 'top' | 'left' | 'right' | 'bottom';
type Control = 'stick' | 'fire' | 'pause';

/** Safe-area insets in CSS px, one per side. */
export type SafeInsets = Readonly<Record<Side, number>>;
export const NO_INSETS: SafeInsets = { top: 0, left: 0, right: 0, bottom: 0 };

/**
 * Where each control sits: its size, and its gap from the screen edges it is anchored to. The gap never falls inside a
 * safe-area inset: it is the larger of the two, in the stylesheet (`cssGap`) and in `touchControlBoxes` (`pxGap`) alike.
 */
const PLACEMENT: Readonly<Record<Control, { readonly size: number; readonly edge: number }>> = {
  stick: { size: BASE_SIZE_PX, edge: 35 },
  fire: { size: FIRE_SIZE_PX, edge: 20 },
  pause: { size: PAUSE_SIZE_PX, edge: 16 },
};

/** The sides each control is anchored to: the joystick bottom left and FIRE bottom right, swapped when `leftHanded`, and pause top right. */
function anchors(leftHanded: boolean): Readonly<Record<Control, { readonly x: 'left' | 'right'; readonly y: 'top' | 'bottom' }>> {
  return {
    stick: { x: leftHanded ? 'right' : 'left', y: 'bottom' },
    fire: { x: leftHanded ? 'left' : 'right', y: 'bottom' },
    pause: { x: 'right', y: 'top' },
  };
}

/** `control`'s gap from `side`, for the stylesheet: its edge or the side's safe-area inset, whichever is larger. */
const cssGap = (control: Control, side: Side): string => `max(${String(PLACEMENT[control].edge)}px, env(safe-area-inset-${side}))`;
/** The same gap in CSS px, for `insets`. */
const pxGap = (control: Control, side: Side, insets: SafeInsets): number => Math.max(PLACEMENT[control].edge, insets[side]);
const TOUCH_CSS =
  'pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent';

/** A box in CSS px, from the viewport's top-left corner. */
export interface CssBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the joystick, FIRE and pause sit in a `cssWidth` by `cssHeight` viewport with `insets`, as the stylesheet places them. */
export function touchControlBoxes(cssWidth: number, cssHeight: number, leftHanded: boolean, insets: SafeInsets = NO_INSETS): Readonly<Record<Control, CssBox>> {
  const sides = anchors(leftHanded);
  const box = (control: Control): CssBox => {
    const { size } = PLACEMENT[control];
    const { x, y } = sides[control];
    return {
      x: x === 'left' ? pxGap(control, 'left', insets) : cssWidth - pxGap(control, 'right', insets) - size,
      y: y === 'top' ? pxGap(control, 'top', insets) : cssHeight - pxGap(control, 'bottom', insets) - size,
      width: size,
      height: size,
    };
  };
  return { stick: box('stick'), fire: box('fire'), pause: box('pause') };
}

/** What the layer shows: nothing, the pause button alone (play with a mouse or keys), or the joystick and FIRE as well. */
export type TouchShown = 'none' | 'pause' | 'all';

export interface TouchControls {
  /** Current drag, or null while the joystick is released. */
  readonly stick: Stick | null;
  readonly fire: boolean;
  /** The pause button's viewport box in CSS px, or null while it is hidden. */
  pauseRect(): DOMRect | null;
  /** Shows what `shown` names; a control that hides lets go of its finger. */
  show(shown: TouchShown): void;
  /** The pause button's tooltip; empty for none. */
  setPauseTip(text: string): void;
  /** Puts the joystick on the right and FIRE on the left (or back); the pause button stays top right. */
  setLeftHanded(on: boolean): void;
  dispose(): void;
}

interface PointerTracker {
  release(): void;
  detach(): void;
}

interface PointerHandlers {
  onStart(e: PointerEvent): void;
  onMove?(e: PointerEvent): void;
  onRelease?(): void;
}

/** `css` holds the geometry, which the stick maths depends on; `className` picks the look from index.html. */
function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  css: string,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.style.cssText = css;
  if (testId !== undefined) el.dataset['testid'] = testId;
  return el;
}

/**
 * Makes `el` follow a single pointer: the first pointer down is captured and
 * tracked by id, other pointers are ignored, and any end of the gesture
 * releases it. `release` ends the current gesture; `detach` also removes the listeners.
 */
function trackSinglePointer(el: HTMLElement, handlers: PointerHandlers): PointerTracker {
  let activeId: number | null = null;

  const release = (): void => {
    if (activeId === null) return;
    activeId = null;
    handlers.onRelease?.();
  };
  const onDown = (e: PointerEvent): void => {
    if (activeId !== null) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    activeId = e.pointerId;
    handlers.onStart(e);
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId === activeId) handlers.onMove?.(e);
  };
  const onEnd = (e: PointerEvent): void => {
    if (e.pointerId === activeId) release();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onEnd);
  el.addEventListener('pointercancel', onEnd);
  el.addEventListener('lostpointercapture', onEnd);
  window.addEventListener('blur', release);

  return {
    release,
    detach() {
      release();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('lostpointercapture', onEnd);
      window.removeEventListener('blur', release);
    },
  };
}

const BASE_CSS = `position:absolute;bottom:${cssGap('stick', 'bottom')};width:${String(BASE_SIZE_PX)}px;height:${String(BASE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;border-width:2px;${TOUCH_CSS}`;
const HANDLE_CSS = `position:absolute;left:50%;top:50%;width:${String(HANDLE_SIZE_PX)}px;height:${String(HANDLE_SIZE_PX)}px;margin:-${String(HANDLE_SIZE_PX / 2)}px 0 0 -${String(HANDLE_SIZE_PX / 2)}px;border-radius:50%;pointer-events:none`;
const FIRE_CSS = `position:absolute;bottom:${cssGap('fire', 'bottom')};width:${String(FIRE_SIZE_PX)}px;height:${String(FIRE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;border-width:2px;display:flex;align-items:center;justify-content:center;${TOUCH_CSS}`;
const PAUSE_CSS = `position:absolute;top:${cssGap('pause', 'top')};right:${cssGap('pause', 'right')};width:${String(PAUSE_SIZE_PX)}px;height:${String(PAUSE_SIZE_PX)}px;box-sizing:border-box;padding:0;border-radius:50%;border-width:2px;${TOUCH_CSS}`;
const LAYER_CSS = 'position:fixed;inset:0;pointer-events:none;z-index:var(--layer-touch)';

/** Anchors `control`'s element to the side of the screen `anchors` gives it, clearing the other. */
function anchorTo(el: HTMLElement, control: Control, leftHanded: boolean): void {
  const side = anchors(leftHanded)[control].x;
  el.style.left = side === 'left' ? cssGap(control, 'left') : '';
  el.style.right = side === 'right' ? cssGap(control, 'right') : '';
}

/** The pause button; a click from the keyboard (Enter on it once Tab has reached it) pauses too, as a press does. */
function pauseButton(onPause: () => void): HTMLButtonElement {
  const button = styled('button', 'touch-pause', PAUSE_CSS, 'touch-pause');
  button.type = 'button';
  button.textContent = 'II';
  button.setAttribute('aria-label', 'Pause');
  button.setAttribute('aria-keyshortcuts', 'Escape P');
  button.addEventListener('click', (e) => {
    if (e.detail === 0) onPause();
  });
  return button;
}

/**
 * Joystick, FIRE and a pause button. `onPause` runs as a finger or the mouse lands on the pause
 * button: on pointerdown rather than click, because a phone sends no click for a second finger
 * while the thumb is on the stick.
 */
export function attachTouchControls(root: HTMLElement, onPause: () => void): TouchControls {
  const layer = styled('div', '', LAYER_CSS);
  const base = styled('div', 'touch-stick', BASE_CSS, 'touch-joystick');
  const handle = styled('div', 'touch-knob', HANDLE_CSS);
  const fireButton = styled('div', 'touch-fire', FIRE_CSS, 'touch-fire');
  fireButton.textContent = 'FIRE';
  const pause = pauseButton(onPause);
  // The joystick and FIRE share a box of their own, so the pause button can show without them; the layer places all three.
  const sticks = document.createElement('div');
  base.append(handle);
  sticks.append(base, fireButton);
  layer.append(sticks, pause);
  root.append(layer);

  let stick: Stick | null = null;
  let fire = false;

  const moveHandle = (x: number, y: number): void => {
    handle.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
  };
  const updateStick = (e: PointerEvent): void => {
    const rect = base.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    stick = stickFromOffset(dx, dy, BASE_SIZE_PX / 2);
    const travel = Math.min(Math.hypot(dx, dy), MAX_HANDLE_TRAVEL_PX);
    const angle = Math.atan2(dy, dx);
    moveHandle(travel * Math.cos(angle), travel * Math.sin(angle));
  };

  const stickTracker = trackSinglePointer(base, {
    onStart: updateStick,
    onMove: updateStick,
    onRelease() {
      stick = null;
      moveHandle(0, 0);
    },
  });
  const fireTracker = trackSinglePointer(fireButton, {
    onStart() {
      fire = true;
    },
    onRelease() {
      fire = false;
    },
  });

  const trackers = [stickTracker, fireTracker, trackSinglePointer(pause, { onStart: onPause })];

  const releaseAll = (): void => {
    for (const tracker of trackers) tracker.release();
  };
  const show = (shown: TouchShown): void => {
    layer.style.display = shown === 'none' ? 'none' : '';
    sticks.style.display = shown === 'all' ? '' : 'none';
    if (shown !== 'all') releaseAll();
  };
  const setLeftHanded = (on: boolean): void => {
    anchorTo(base, 'stick', on);
    anchorTo(fireButton, 'fire', on);
  };
  setLeftHanded(false);
  show('none');

  return {
    get stick() {
      return stick;
    },
    get fire() {
      return fire;
    },
    pauseRect() {
      return layer.style.display === 'none' ? null : pause.getBoundingClientRect();
    },
    show,
    setPauseTip(text) {
      pause.title = text;
    },
    setLeftHanded,
    dispose() {
      for (const tracker of trackers) tracker.detach();
      layer.remove();
    },
  };
}
