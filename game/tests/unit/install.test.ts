import { describe, expect, it, vi } from 'vitest';
import { createInstallPrompt, installOffer, isIosSafari, isStandalone, type InstallOffer } from '../../src/platform/install';
import { RingLog } from '../../src/platform/log';

const UA = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iPadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iPodSafari: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  // iPadOS asks for desktop sites by default, so its Safari reports a Mac.
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iPhoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iPadEdge:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/130.2849.80 Mobile/15E148 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('installOffer', () => {
  it.each<[standalone: boolean, hasPrompt: boolean, iosSafari: boolean, offer: InstallOffer]>([
    [true, true, true, 'none'],
    [true, true, false, 'none'],
    [true, false, true, 'none'],
    [true, false, false, 'none'],
    [false, true, true, 'prompt'],
    [false, true, false, 'prompt'],
    [false, false, true, 'iosHint'],
    [false, false, false, 'none'],
  ])('standalone %s, prompt %s, iOS Safari %s: %s', (standalone, hasPrompt, iosSafari, offer) => {
    expect(installOffer({ standalone, hasPrompt, iosSafari })).toBe(offer);
  });
});

describe('isIosSafari', () => {
  it.each([
    ['iPhone Safari', UA.iPhoneSafari, 5],
    ['iPad Safari', UA.iPadSafari, 5],
    ['iPod Safari', UA.iPodSafari, 5],
    ['iPadOS Safari, which reports a Mac with touch', UA.macSafari, 5],
  ])('is true for %s', (_name, ua, touchPoints) => {
    expect(isIosSafari(ua, touchPoints)).toBe(true);
  });

  it.each([
    ['a Mac without touch', UA.macSafari, 0],
    ['a Mac with a single touch point', UA.macSafari, 1],
    ['Chrome on iPhone', UA.iPhoneChrome, 5],
    ['Firefox on iPhone', UA.iPhoneFirefox, 5],
    ['Edge on iPad', UA.iPadEdge, 5],
    ['Chrome on Android', UA.androidChrome, 5],
    ['Chrome on a desktop', UA.desktopChrome, 0],
  ])('is false for %s', (_name, ua, touchPoints) => {
    expect(isIosSafari(ua, touchPoints)).toBe(false);
  });
});

interface FakeWindowOptions {
  readonly displayStandalone?: boolean;
  readonly navigatorStandalone?: boolean;
  readonly userAgent?: string;
  readonly maxTouchPoints?: number;
}

function fakeWindow({ displayStandalone = false, navigatorStandalone, userAgent = UA.desktopChrome, maxTouchPoints = 0 }: FakeWindowOptions = {}) {
  const navigator = { userAgent, maxTouchPoints, ...(navigatorStandalone === undefined ? {} : { standalone: navigatorStandalone }) };
  const matchMedia = vi.fn((query: string) => ({ matches: displayStandalone && query === '(display-mode: standalone)' }));
  return Object.assign(new EventTarget(), { navigator, matchMedia });
}

function make(win: ReturnType<typeof fakeWindow>, log = new RingLog()) {
  const onChange = vi.fn();
  return { log, onChange, install: createInstallPrompt(win as unknown as Window, log, onChange) };
}

/** A `beforeinstallprompt` event as Chromium sends it: cancelable, with `prompt()` and a `userChoice` promise. */
function promptEvent(prompt: () => Promise<void> = () => Promise.resolve(), outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(prompt),
    userChoice: Promise.resolve({ outcome, platform: '' }),
  });
  return event;
}

/** Lets the prompt's promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isStandalone', () => {
  it('is true when the display mode is standalone', () => {
    expect(isStandalone(fakeWindow({ displayStandalone: true }) as unknown as Window)).toBe(true);
  });

  it('is true when iOS reports navigator.standalone', () => {
    expect(isStandalone(fakeWindow({ navigatorStandalone: true }) as unknown as Window)).toBe(true);
  });

  it('is false in a browser tab', () => {
    expect(isStandalone(fakeWindow({ navigatorStandalone: false }) as unknown as Window)).toBe(false);
    expect(isStandalone(fakeWindow() as unknown as Window)).toBe(false);
  });
});

describe('createInstallPrompt', () => {
  it('offers nothing until the browser sends a prompt', () => {
    expect(make(fakeWindow()).install.offer).toBe('none');
  });

  it('keeps the prompt event, holds back the browser bar, and offers the prompt', () => {
    const win = fakeWindow();
    const { install, onChange } = make(win);
    const event = promptEvent();
    win.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(install.offer).toBe('prompt');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows the kept prompt on install, then withdraws the offer once the player accepts', async () => {
    const win = fakeWindow();
    const { install, onChange } = make(win);
    const event = promptEvent();
    win.dispatchEvent(event);

    install.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(install.offer).toBe('none');
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('withdraws the offer when the app is installed by other means', () => {
    const win = fakeWindow();
    const { install, onChange } = make(win);
    win.dispatchEvent(promptEvent());
    win.dispatchEvent(new Event('appinstalled'));

    expect(install.offer).toBe('none');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps the offer when the player dismisses the prompt', async () => {
    const win = fakeWindow();
    const { install } = make(win);
    win.dispatchEvent(promptEvent(undefined, 'dismissed'));

    install.install();
    await settle();
    expect(install.offer).toBe('prompt');
  });

  it('logs a prompt the browser refuses, with what to do, and keeps the offer', async () => {
    const win = fakeWindow();
    const { install, log } = make(win);
    // A pad press is no user activation, so Chromium refuses the prompt it asks for.
    win.dispatchEvent(promptEvent(() => Promise.reject(new DOMException('needs a user gesture', 'NotAllowedError'))));

    install.install();
    await vi.waitFor(() => {
      expect(log.size).toBe(1);
    });
    const [entry] = log.entries();
    expect(entry?.kind).toBe('error');
    expect(entry?.message).toMatch(/user gesture.*browser menu/);
    expect(install.offer).toBe('prompt');
  });

  it('logs a prompt that throws instead of rejecting, and keeps the offer', () => {
    const win = fakeWindow();
    const { install, log } = make(win);
    const event = promptEvent();
    event.prompt.mockImplementation(() => {
      throw new Error('not allowed');
    });
    win.dispatchEvent(event);

    expect(() => {
      install.install();
    }).not.toThrow();
    expect(install.offer).toBe('prompt');
    expect(log.entries()[0]?.message).toMatch(/not allowed/);
  });

  it('shows the prompt once however often the chip is pressed while it is up, and again once it is answered', async () => {
    const win = fakeWindow();
    const { install } = make(win);
    let answer: () => void = () => undefined;
    const event = promptEvent(() => new Promise<void>((resolve) => (answer = resolve)), 'dismissed');
    win.dispatchEvent(event);

    install.install();
    install.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    answer();
    await settle();
    install.install();
    expect(event.prompt).toHaveBeenCalledTimes(2);
  });

  it('says the prompt is up from install until the player answers it, as a card over the title', async () => {
    const win = fakeWindow();
    const { install } = make(win);
    let answer: () => void = () => undefined;
    win.dispatchEvent(promptEvent(() => new Promise<void>((resolve) => (answer = resolve)), 'dismissed'));
    expect(install.prompting).toBe(false);
    install.install();
    expect(install.prompting).toBe(true);
    answer();
    await settle();
    expect(install.prompting).toBe(false);
  });

  it('does nothing on install while it holds no prompt', () => {
    const { install, onChange } = make(fakeWindow());
    install.install();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores an event that carries no prompt()', () => {
    const win = fakeWindow();
    const { install } = make(win);
    win.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    expect(install.offer).toBe('none');
  });

  it('offers nothing in the installed app, even with a prompt', () => {
    const win = fakeWindow({ displayStandalone: true });
    const { install } = make(win);
    win.dispatchEvent(promptEvent());
    expect(install.offer).toBe('none');
  });

  it('offers the Add to Home Screen hint in iOS Safari', () => {
    expect(make(fakeWindow({ userAgent: UA.macSafari, maxTouchPoints: 5 })).install.offer).toBe('iosHint');
  });

  it('stops listening once disposed', () => {
    const win = fakeWindow();
    const { install, onChange } = make(win);
    install.dispose();
    win.dispatchEvent(promptEvent());
    expect(install.offer).toBe('none');
    expect(onChange).not.toHaveBeenCalled();
  });
});
