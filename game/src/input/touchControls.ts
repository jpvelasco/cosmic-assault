import type { Stick } from '../sim/controls';
import { stickFromOffset } from './stick';

const BASE_SIZE_PX = 120;
const HANDLE_SIZE_PX = 50;
const FIRE_SIZE_PX = 80;
const PAUSE_SIZE_PX = 44;
const MAX_HANDLE_TRAVEL_PX = (BASE_SIZE_PX - HANDLE_SIZE_PX) / 2;
const inset = (side: 'top' | 'left' | 'right' | 'bottom', px: number): string =>
  `max(${String(px)}px, env(safe-area-inset-${side}))`;
const TOUCH_CSS =
  'pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent';

export interface TouchControls {
  /** Current drag, or null while the joystick is released. */
  readonly stick: Stick | null;
  readonly fire: boolean;
  show(visible: boolean): void;
  dispose(): void;
}

interface PointerTracker {
  release(): void;
  detach(): void;
}

interface PointerHandlers {
  onStart(e: PointerEvent): void;
  onMove?(e: PointerEvent): void;
  onRelease(): void;
}

function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
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
    handlers.onRelease();
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

const BASE_CSS = `position:absolute;left:${inset('left', 35)};bottom:${inset('bottom', 35)};width:${String(BASE_SIZE_PX)}px;height:${String(BASE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;background:rgba(57,255,20,0.1);border:2px solid rgba(57,255,20,0.5);${TOUCH_CSS}`;
const HANDLE_CSS = `position:absolute;left:50%;top:50%;width:${String(HANDLE_SIZE_PX)}px;height:${String(HANDLE_SIZE_PX)}px;margin:-${String(HANDLE_SIZE_PX / 2)}px 0 0 -${String(HANDLE_SIZE_PX / 2)}px;border-radius:50%;background:rgba(57,255,20,0.5);pointer-events:none`;
const FIRE_CSS = `position:absolute;right:${inset('right', 20)};bottom:${inset('bottom', 20)};width:${String(FIRE_SIZE_PX)}px;height:${String(FIRE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;background:rgba(255,0,255,0.5);border:2px solid rgba(255,0,255,0.8);color:#fff;font:bold 16px sans-serif;display:flex;align-items:center;justify-content:center;${TOUCH_CSS}`;
const PAUSE_CSS = `position:absolute;top:${inset('top', 16)};right:${inset('right', 16)};width:${String(PAUSE_SIZE_PX)}px;height:${String(PAUSE_SIZE_PX)}px;box-sizing:border-box;padding:0;border-radius:50%;background:rgba(232,236,255,0.12);border:2px solid rgba(232,236,255,0.5);color:#e8ecff;font:bold 16px sans-serif;letter-spacing:-1px;${TOUCH_CSS}`;
const LAYER_CSS = 'position:fixed;inset:0;pointer-events:none;z-index:1000';

function pauseButton(onPause: () => void): HTMLButtonElement {
  const button = styled('button', PAUSE_CSS, 'touch-pause');
  button.type = 'button';
  button.textContent = 'II';
  button.setAttribute('aria-label', 'Pause');
  button.addEventListener('click', onPause);
  return button;
}

/** Joystick, FIRE and a pause button; `onPause` runs when the pause button is tapped. */
export function attachTouchControls(root: HTMLElement, onPause: () => void): TouchControls {
  const layer = styled('div', LAYER_CSS);
  const base = styled('div', BASE_CSS, 'touch-joystick');
  const handle = styled('div', HANDLE_CSS);
  const fireButton = styled('div', FIRE_CSS, 'touch-fire');
  fireButton.textContent = 'FIRE';
  base.append(handle);
  layer.append(base, fireButton, pauseButton(onPause));
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

  const releaseAll = (): void => {
    stickTracker.release();
    fireTracker.release();
  };
  const show = (visible: boolean): void => {
    layer.style.display = visible ? '' : 'none';
    if (!visible) releaseAll();
  };
  show(window.matchMedia('(pointer: coarse)').matches);

  return {
    get stick() {
      return stick;
    },
    get fire() {
      return fire;
    },
    show,
    dispose() {
      stickTracker.detach();
      fireTracker.detach();
      layer.remove();
    },
  };
}
