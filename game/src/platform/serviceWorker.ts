import { errorMessage, type RingLog } from './log';

/**
 * Registers the offline worker (built to `sw.js` beside index.html) with the default scope: this directory and
 * below. Dev servers never get one. A failure is logged, never thrown: the game still runs, only not offline.
 */
export function registerServiceWorker(nav: Navigator, log: RingLog): void {
  if (import.meta.env.MODE === 'development' || !('serviceWorker' in nav)) return;
  const failed = (reason: unknown): void => {
    log.add('error', `Offline play is unavailable: the service worker did not register (${errorMessage(reason)}). Reload the page to try again.`, performance.now());
  };
  // A browser may throw rather than reject: Firefox can, on reading `serviceWorker` while site data is blocked.
  try {
    nav.serviceWorker.register('./sw.js').catch(failed);
  } catch (error) {
    failed(error);
  }
}
