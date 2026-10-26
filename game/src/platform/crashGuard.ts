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

/** Just `Name: message`: enough to tell what failed, with no file URLs. */
function summarizeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Message and stack. Only V8 starts its stack with the message, so Firefox and Safari get it added. */
function describeError(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return summarizeError(error);
  return error.stack.includes(error.message) ? error.stack : `${summarizeError(error)}\n${error.stack}`;
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

  /** Our own errors are logged in full; a third party's keep only their message, so the report carries no extension IDs or URLs. */
  const record = (error: unknown, ours: boolean): void => {
    log.add('error', ours ? describeError(error) : summarizeError(error), now());
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
        record(error, true);
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
        const failure = error ?? message;
        const ours = isOurs(field(event, 'filename'), error instanceof Error && error.stack);
        record(failure, ours);
        if (ours) trip(failure);
      };
      const onRejection = (event: Event): void => {
        const reason = field(event, 'reason');
        const ours = isOurs(reason instanceof Error && reason.stack);
        record(reason, ours);
        if (ours) trip(reason);
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
