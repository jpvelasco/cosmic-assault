import type { Stick } from '../sim/controls';
import { stickFromOffset } from './stick';

const BASE_SIZE_PX = 120;
const HANDLE_SIZE_PX = 50;
const FIRE_SIZE_PX = 80;
const PAUSE_SIZE_PX = 44;
const MAX_HANDLE_TRAVEL_PX = (BASE_SIZE_PX - HANDLE_SIZE_PX) / 2;
const inset = (side: 'top' | 'left' | 'right' | 'bottom', px: number): string =>
  `max(${String(px)}px, env(safe-area-inset-${side}))`;
const STICK_EDGE_PX = 35;
const FIRE_EDGE_PX = 20;
const PAUSE_EDGE_PX = 16;
const TOUCH_CSS =
  'pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent';

/** A box in CSS px, from the viewport's top-left corner. */
export interface CssBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the joystick, FIRE and pause sit in a `cssWidth` by `cssHeight` viewport with no safe-area insets, as the
 * stylesheet below places them: the joystick bottom left and FIRE bottom right, or swapped when `leftHanded`, and pause
 * top right.
 */
export function touchControlBoxes(cssWidth: number, cssHeight: number, leftHanded: boolean): Readonly<Record<'stick' | 'fire' | 'pause', CssBox>> {
  const corner = (size: number, edge: number, right: boolean): CssBox => ({ x: right ? cssWidth - edge - size : edge, y: cssHeight - edge - size, width: size, height: size });
  return {
    stick: corner(BASE_SIZE_PX, STICK_EDGE_PX, leftHanded),
    fire: corner(FIRE_SIZE_PX, FIRE_EDGE_PX, !leftHanded),
    pause: { x: cssWidth - PAUSE_EDGE_PX - PAUSE_SIZE_PX, y: PAUSE_EDGE_PX, width: PAUSE_SIZE_PX, height: PAUSE_SIZE_PX },
  };
}

export interface TouchControls {
  /** Current drag, or null while the joystick is released. */
  readonly stick: Stick | null;
  readonly fire: boolean;
  /** The pause button's viewport box in CSS px, or null while the touch layer is hidden. */
  pauseRect(): DOMRect | null;
  show(visible: boolean): void;
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

const BASE_CSS = `position:absolute;bottom:${inset('bottom', STICK_EDGE_PX)};width:${String(BASE_SIZE_PX)}px;height:${String(BASE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;border-width:2px;${TOUCH_CSS}`;
const HANDLE_CSS = `position:absolute;left:50%;top:50%;width:${String(HANDLE_SIZE_PX)}px;height:${String(HANDLE_SIZE_PX)}px;margin:-${String(HANDLE_SIZE_PX / 2)}px 0 0 -${String(HANDLE_SIZE_PX / 2)}px;border-radius:50%;pointer-events:none`;
const FIRE_CSS = `position:absolute;bottom:${inset('bottom', FIRE_EDGE_PX)};width:${String(FIRE_SIZE_PX)}px;height:${String(FIRE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;border-width:2px;display:flex;align-items:center;justify-content:center;${TOUCH_CSS}`;
const PAUSE_CSS = `position:absolute;top:${inset('top', PAUSE_EDGE_PX)};right:${inset('right', PAUSE_EDGE_PX)};width:${String(PAUSE_SIZE_PX)}px;height:${String(PAUSE_SIZE_PX)}px;box-sizing:border-box;padding:0;border-radius:50%;border-width:2px;${TOUCH_CSS}`;
const LAYER_CSS = 'position:fixed;inset:0;pointer-events:none;z-index:var(--layer-touch)';

/** Anchors `el` to one side of the screen, clearing the other. */
function anchorTo(el: HTMLElement, side: 'left' | 'right', px: number): void {
  el.style.left = side === 'left' ? inset('left', px) : '';
  el.style.right = side === 'right' ? inset('right', px) : '';
}

function pauseButton(): HTMLButtonElement {
  const button = styled('button', 'touch-pause', PAUSE_CSS, 'touch-pause');
  button.type = 'button';
  button.textContent = 'II';
  button.setAttribute('aria-label', 'Pause');
  return button;
}

/**
 * Joystick, FIRE and a pause button. `onPause` runs as a finger lands on the pause button: on
 * pointerdown rather than click, because a phone sends no click for a second finger while the
 * thumb is on the stick.
 */
export function attachTouchControls(root: HTMLElement, onPause: () => void): TouchControls {
  const layer = styled('div', '', LAYER_CSS);
  const base = styled('div', 'touch-stick', BASE_CSS, 'touch-joystick');
  const handle = styled('div', 'touch-knob', HANDLE_CSS);
  const fireButton = styled('div', 'touch-fire', FIRE_CSS, 'touch-fire');
  fireButton.textContent = 'FIRE';
  const pause = pauseButton();
  base.append(handle);
  layer.append(base, fireButton, pause);
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
  const show = (visible: boolean): void => {
    layer.style.display = visible ? '' : 'none';
    if (!visible) releaseAll();
  };
  const setLeftHanded = (on: boolean): void => {
    anchorTo(base, on ? 'right' : 'left', STICK_EDGE_PX);
    anchorTo(fireButton, on ? 'left' : 'right', FIRE_EDGE_PX);
  };
  setLeftHanded(false);
  show(window.matchMedia('(pointer: coarse)').matches);

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
    setLeftHanded,
    dispose() {
      for (const tracker of trackers) tracker.detach();
      layer.remove();
    },
  };
}
