import type { Stick } from '../sim/controls';
import { stickFromOffset } from './stick';

const BASE_SIZE_PX = 120;
const HANDLE_SIZE_PX = 50;
const FIRE_SIZE_PX = 80;
const MAX_HANDLE_TRAVEL_PX = (BASE_SIZE_PX - HANDLE_SIZE_PX) / 2;
const INSET = (side: 'left' | 'right' | 'bottom'): string => `max(16px, env(safe-area-inset-${side}))`;

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
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.style.cssText = css;
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
    activeId = e.pointerId;
    el.setPointerCapture(e.pointerId);
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

const BASE_CSS = `position:absolute;left:${INSET('left')};bottom:${INSET('bottom')};width:${String(BASE_SIZE_PX)}px;height:${String(BASE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;background:rgba(57,255,20,0.1);border:2px solid rgba(57,255,20,0.5);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none`;
const HANDLE_CSS = `position:absolute;left:50%;top:50%;width:${String(HANDLE_SIZE_PX)}px;height:${String(HANDLE_SIZE_PX)}px;margin:-${String(HANDLE_SIZE_PX / 2)}px 0 0 -${String(HANDLE_SIZE_PX / 2)}px;border-radius:50%;background:rgba(57,255,20,0.5);pointer-events:none`;
const FIRE_CSS = `position:absolute;right:${INSET('right')};bottom:${INSET('bottom')};width:${String(FIRE_SIZE_PX)}px;height:${String(FIRE_SIZE_PX)}px;box-sizing:border-box;border-radius:50%;background:rgba(255,0,255,0.5);border:2px solid rgba(255,0,255,0.8);color:#fff;font:bold 14px sans-serif;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none`;
const LAYER_CSS = 'position:fixed;inset:0;pointer-events:none;z-index:1000';

export function attachTouchControls(root: HTMLElement): TouchControls {
  const layer = styled('div', LAYER_CSS);
  const base = styled('div', BASE_CSS);
  const handle = styled('div', HANDLE_CSS);
  const fireButton = styled('div', FIRE_CSS);
  fireButton.textContent = 'FIRE';
  base.append(handle);
  layer.append(base, fireButton);
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
