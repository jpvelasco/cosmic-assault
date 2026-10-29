import type { MouseInput } from './mergeControls';

/** The slice of the canvas the source needs, so tests can supply a fake. */
export type MouseFireSurface = Pick<Element, 'addEventListener' | 'removeEventListener' | 'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'>;

/** The slice of `Document` the source needs: a hidden tab lets go. */
export type MouseFireDocument = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;

export interface MouseFire extends MouseInput {
  /** Lets go of a held press, as leaving play does: a button still held fires again only once pressed again. */
  release(): void;
  dispose(): void;
}

/** Whether the primary button is among those held in a pointer event's `buttons`. */
const PRIMARY_BUTTON = 1;

/**
 * Fires while the primary mouse button is held on `surface`, the game canvas: beside Z and X, the second way round
 * keyboards that cannot report Up + Left + Space together. Only a press that lands on the surface while `canFire` holds
 * counts, so a press on a button, a card or the touch layer (which never reaches the canvas), a press before the run,
 * and a finger or a pen (the touch layer's) never fire. The press is captured, so its release comes back wherever the
 * pointer goes, and it lets go on that release, a cancel, a lost capture, the primary button let go under another, the
 * context menu, a lost focus, a hidden tab or `release()`.
 */
export function attachMouseFire(surface: MouseFireSurface, win: EventTarget, doc: MouseFireDocument, canFire: () => boolean): MouseFire {
  let held: number | null = null;

  const release = (): void => {
    if (held === null) return;
    const pointerId = held;
    held = null;
    if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
  };
  const onDown = (e: Event): void => {
    const { pointerType, button, pointerId } = e as PointerEvent;
    if (held !== null || pointerType !== 'mouse' || button !== 0 || !canFire()) return;
    held = pointerId;
    surface.setPointerCapture(pointerId);
  };
  const onEnd = (e: Event): void => {
    if ((e as PointerEvent).pointerId === held) release();
  };
  const onMove = (e: Event): void => {
    const { pointerId, buttons } = e as PointerEvent;
    if (pointerId === held && (buttons & PRIMARY_BUTTON) === 0) release();
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') release();
  };

  const surfaceListeners: readonly (readonly [string, (e: Event) => void])[] = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onEnd],
    ['pointercancel', onEnd],
    ['lostpointercapture', onEnd],
  ];
  for (const [type, listener] of surfaceListeners) surface.addEventListener(type, listener);
  win.addEventListener('blur', release);
  win.addEventListener('contextmenu', release);
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    get fire() {
      return held !== null;
    },
    release,
    dispose() {
      release();
      for (const [type, listener] of surfaceListeners) surface.removeEventListener(type, listener);
      win.removeEventListener('blur', release);
      win.removeEventListener('contextmenu', release);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
