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
  const supported = doc.fullscreenEnabled && typeof target.requestFullscreen === 'function';
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
      if (active()) doc.exitFullscreen().catch(logRefusal('exit full screen'));
      else target.requestFullscreen().catch(logRefusal('enter full screen'));
    },
    onChange(cb) {
      doc.addEventListener('fullscreenchange', cb);
      return () => {
        doc.removeEventListener('fullscreenchange', cb);
      };
    },
  };
}
