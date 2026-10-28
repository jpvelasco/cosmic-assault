import { errorMessage, type RingLog } from './log';

/** What the title card offers: the browser's own install prompt, the iOS Add to Home Screen steps, or nothing. */
export type InstallOffer = 'prompt' | 'iosHint' | 'none';

export function installOffer(env: { standalone: boolean; hasPrompt: boolean; iosSafari: boolean }): InstallOffer {
  if (env.standalone) return 'none';
  if (env.hasPrompt) return 'prompt';
  return env.iosSafari ? 'iosHint' : 'none';
}

/**
 * Safari on iPhone, iPad or iPod, which can only install from its Share menu. iPadOS Safari reports a Mac, told
 * apart by its touch screen. Chrome, Firefox and Edge on iOS name themselves (CriOS, FxiOS, EdgiOS).
 */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  return apple && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Whether the page runs as the installed app; iOS reports it only through its own `navigator.standalone`. */
export function isStandalone(win: Pick<Window, 'matchMedia' | 'navigator'>): boolean {
  const nav = win.navigator;
  return win.matchMedia('(display-mode: standalone)').matches || ('standalone' in nav && nav.standalone === true);
}

/** Chromium's `beforeinstallprompt` event, which the DOM typings do not include. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<unknown>;
}

function isInstallPromptEvent(e: Event): e is InstallPromptEvent {
  return 'prompt' in e && typeof e.prompt === 'function' && 'userChoice' in e;
}

/** Whether the player chose to install from the prompt (`userChoice` resolves to `{ outcome }`). */
function accepted(choice: unknown): boolean {
  return typeof choice === 'object' && choice !== null && 'outcome' in choice && choice.outcome === 'accepted';
}

export interface InstallPrompt {
  readonly offer: InstallOffer;
  /** Whether the browser's install prompt is up, over the title. */
  readonly prompting: boolean;
  /** Shows the kept browser prompt. Call it from a tap or key press; the offer goes once the player installs. */
  readonly install: () => void;
  readonly dispose: () => void;
}

/**
 * Holds back the browser's own install bar and keeps its prompt for the title card's Install chip. Calls `onChange`
 * whenever the offer may have changed.
 */
export function createInstallPrompt(win: Window, log: RingLog, onChange: () => void): InstallPrompt {
  const iosSafari = isIosSafari(win.navigator.userAgent, win.navigator.maxTouchPoints);
  let kept: InstallPromptEvent | null = null;
  /** While a prompt is up, a second press of the chip must not ask for another. */
  let showing = false;

  const onPrompt = (e: Event): void => {
    if (!isInstallPromptEvent(e)) return;
    e.preventDefault();
    kept = e;
    onChange();
  };
  /** Only an install ends the offer. After a dismissal the browser sends a fresh prompt, which replaces the kept one. */
  const withdraw = (): void => {
    kept = null;
    onChange();
  };
  /** A refusal (no user gesture, as after a pad press) leaves the offer for a tap or key press to try again. */
  const refused = (reason: unknown): void => {
    log.add('error', `Could not show the install prompt: ${errorMessage(reason)}. Install from the browser menu instead.`, performance.now());
  };
  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', withdraw);

  return {
    get offer() {
      return installOffer({ standalone: isStandalone(win), hasPrompt: kept !== null, iosSafari });
    },
    get prompting() {
      return showing;
    },
    install: () => {
      const event = kept;
      if (event === null || showing) return;
      showing = true;
      try {
        event
          .prompt()
          .then(() => event.userChoice)
          .then((choice) => {
            if (accepted(choice)) withdraw();
          }, refused)
          .finally(() => {
            showing = false;
          });
      } catch (error) {
        showing = false;
        refused(error);
      }
    },
    dispose: () => {
      win.removeEventListener('beforeinstallprompt', onPrompt);
      win.removeEventListener('appinstalled', withdraw);
    },
  };
}
