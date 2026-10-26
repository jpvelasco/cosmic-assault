import { hasShortcutModifier, isFormControlTarget, type KeyEventLike } from '../input/keyEvent';
import type { RingLog } from './log';

export interface FullscreenControl {
  /** Whether this browser can put the page in full screen; false on iPhone Safari, which has no element full screen. */
  readonly supported: boolean;
  /** Whether the page is in full screen right now. */
  readonly active: boolean;
  /** Enters or leaves full screen. Call it from a key press or tap: browsers refuse it otherwise. No-op when unsupported. */
  toggle(): void;
  /** Calls `cb` whenever full screen starts or ends, including when the player leaves it with Esc. Returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}

export function createFullscreen(doc: Document, target: HTMLElement, log: RingLog): FullscreenControl {
  // Browsers without the API leave `fullscreenEnabled` undefined, which the DOM typings do not admit.
  const supported = (doc.fullscreenEnabled as boolean | undefined) === true && typeof target.requestFullscreen === 'function';
  const active = (): boolean => doc.fullscreenElement !== null;

  /** A refused request is routine (no user gesture, a permissions policy), so it is logged rather than raised. */
  const logRefusal = (action: string) => (reason: unknown) => {
    const why = reason instanceof Error ? reason.message : String(reason);
    log.add('error', `Could not ${action}: ${why}. Press F or use the Full screen button again after a click or key press.`, performance.now());
  };

  return {
    supported,
    get active() {
      return active();
    },
    toggle() {
      if (!supported) return;
      const exiting = active();
      const refused = logRefusal(exiting ? 'exit full screen' : 'enter full screen');
      // Engines that predate the promise API return nothing, and a browser may throw outright; neither may reach the frame loop.
      try {
        Promise.resolve(exiting ? doc.exitFullscreen() : target.requestFullscreen()).catch(refused);
      } catch (error) {
        refused(error);
      }
    },
    onChange(cb) {
      doc.addEventListener('fullscreenchange', cb);
      return () => {
        doc.removeEventListener('fullscreenchange', cb);
      };
    },
  };
}

const FULLSCREEN_KEY = 'KeyF';

/**
 * Toggles full screen on F from inside the keydown handler itself: Safari and Firefox refuse a request made
 * later, such as from the next animation frame. Ignores auto-repeat, Ctrl/Cmd/Alt combinations and keys typed into a form control.
 * Returns the function that detaches the listener.
 */
export function attachFullscreenKey(
  target: {
    addEventListener(type: 'keydown', listener: (e: KeyEventLike) => void): void;
    removeEventListener(type: 'keydown', listener: (e: KeyEventLike) => void): void;
  },
  fullscreen: Pick<FullscreenControl, 'toggle'>,
): () => void {
  const onKeyDown = (e: KeyEventLike): void => {
    if (e.code === FULLSCREEN_KEY && !e.repeat && !hasShortcutModifier(e) && !isFormControlTarget(e.target)) fullscreen.toggle();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
  };
}
