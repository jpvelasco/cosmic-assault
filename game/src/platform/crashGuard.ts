import type { RingLog } from './log';

/** The part of `Window` the guard listens on. */
export interface GlobalErrorTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  readonly location: { readonly href: string };
}

export interface CrashGuard {
  /** Runs `fn`; a throw trips the guard. Once tripped it returns undefined without calling `fn`. */
  run<T>(fn: () => T): T | undefined;
  readonly tripped: boolean;
  /** Logs window `error` and `unhandledrejection` events, and trips on those that come from our own code. Returns the detach function. */
  attachGlobal(win: GlobalErrorTarget): () => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

function field(event: Event, key: string): unknown {
  return Reflect.get(event, key);
}

/**
 * Turns the first uncaught failure into a call to `onCrash`, so the game can stop and show a recovery card
 * instead of freezing. Everything it sees is written to `log`; nothing is sent anywhere.
 */
export function createCrashGuard(log: RingLog, onCrash: (error: unknown) => void, now: () => number = () => performance.now()): CrashGuard {
  let tripped = false;

  const record = (error: unknown): void => {
    log.add('error', describeError(error), now());
  };

  const trip = (error: unknown): void => {
    if (tripped) return;
    tripped = true;
    try {
      onCrash(error);
    } catch (failure) {
      log.add('error', `Crash card failed: ${describeError(failure)}`, now());
    }
  };

  return {
    run(fn) {
      if (tripped) return undefined;
      try {
        return fn();
      } catch (error) {
        record(error);
        trip(error);
        return undefined;
      }
    },
    get tripped() {
      return tripped;
    },
    attachGlobal(win) {
      // Our modules are served from the page's own directory, so a script elsewhere (a browser extension) is not ours.
      const ownUrl = new URL('./', win.location.href).href;
      const isOurs = (...clues: unknown[]): boolean => clues.some((clue) => typeof clue === 'string' && clue.includes(ownUrl));
      const onError = (event: Event): void => {
        const error = field(event, 'error');
        const message = field(event, 'message');
        record(error ?? message);
        if (isOurs(field(event, 'filename'), error instanceof Error && error.stack)) trip(error ?? message);
      };
      const onRejection = (event: Event): void => {
        const reason = field(event, 'reason');
        record(reason);
        if (isOurs(reason instanceof Error && reason.stack)) trip(reason);
      };
      win.addEventListener('error', onError);
      win.addEventListener('unhandledrejection', onRejection);
      return () => {
        win.removeEventListener('error', onError);
        win.removeEventListener('unhandledrejection', onRejection);
      };
    },
  };
}
