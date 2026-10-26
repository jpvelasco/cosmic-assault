import { describe, expect, it, vi } from 'vitest';
import { attachFullscreenKey, createFullscreen } from '../../src/platform/fullscreen';
import { RingLog } from '../../src/platform/log';

interface FakeDoc extends EventTarget {
  fullscreenEnabled: boolean;
  fullscreenElement: Element | null;
  exitFullscreen: ReturnType<typeof vi.fn<() => Promise<void>>>;
}
interface FakeTarget {
  element: HTMLElement;
  request: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function fakeDoc(enabled = true): FakeDoc {
  const doc: FakeDoc = Object.assign(new EventTarget(), {
    fullscreenEnabled: enabled,
    fullscreenElement: null as Element | null,
    exitFullscreen: vi.fn<() => Promise<void>>(() => {
      doc.fullscreenElement = null;
      return Promise.resolve();
    }),
  });
  return doc;
}

/** A target whose request puts it in `doc.fullscreenElement`, as the browser does. */
function fakeTarget(doc: FakeDoc): FakeTarget {
  const element = {} as HTMLElement;
  const request = vi.fn<() => Promise<void>>(() => {
    doc.fullscreenElement = element;
    return Promise.resolve();
  });
  element.requestFullscreen = request;
  return { element, request };
}

function make(doc: FakeDoc, target: HTMLElement, log = new RingLog()) {
  return { log, control: createFullscreen(doc as unknown as Document, target, log) };
}

describe('createFullscreen', () => {
  it('is supported when the document allows full screen and the target can request it', () => {
    const doc = fakeDoc();
    expect(make(doc, fakeTarget(doc).element).control.supported).toBe(true);
  });

  it('is unsupported, and toggle does nothing, when the document disables full screen', () => {
    const doc = fakeDoc(false);
    const target = fakeTarget(doc);
    const { control, log } = make(doc, target.element);
    expect(control.supported).toBe(false);
    control.toggle();
    expect(target.request).not.toHaveBeenCalled();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(log.size).toBe(0);
  });

  it('is unsupported when the target has no requestFullscreen (iPhone Safari)', () => {
    const doc = fakeDoc();
    const { control } = make(doc, {} as HTMLElement);
    expect(control.supported).toBe(false);
    expect(() => {
      control.toggle();
    }).not.toThrow();
  });

  it('requests full screen on the target, then exits it, tracking active', async () => {
    const doc = fakeDoc();
    const target = fakeTarget(doc);
    const { control } = make(doc, target.element);
    expect(control.active).toBe(false);

    control.toggle();
    await Promise.resolve();
    expect(target.request).toHaveBeenCalledTimes(1);
    expect(control.active).toBe(true);

    control.toggle();
    await Promise.resolve();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(control.active).toBe(false);
  });

  it('logs a rejected request as one error entry and does not throw', async () => {
    const doc = fakeDoc();
    const target = fakeTarget(doc);
    target.request.mockRejectedValueOnce(new TypeError('Permissions check failed'));
    const { control, log } = make(doc, target.element);

    expect(() => {
      control.toggle();
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(log.size).toBe(1);
    });
    const [entry] = log.entries();
    expect(entry?.kind).toBe('error');
    expect(entry?.message).toContain('enter full screen');
    expect(entry?.message).toContain('Permissions check failed');
  });

  it('logs a rejected exit as one error entry', async () => {
    const doc = fakeDoc();
    doc.fullscreenElement = {} as Element;
    doc.exitFullscreen.mockRejectedValueOnce('document not active');
    const { control, log } = make(doc, fakeTarget(doc).element);

    control.toggle();
    await vi.waitFor(() => {
      expect(log.size).toBe(1);
    });
    expect(log.entries()[0]?.message).toContain('exit full screen');
    expect(log.entries()[0]?.message).toContain('document not active');
  });

  it('is unsupported when fullscreenEnabled is missing altogether', () => {
    const doc = fakeDoc();
    (doc as { fullscreenEnabled: boolean | undefined }).fullscreenEnabled = undefined;
    expect(make(doc, fakeTarget(doc).element).control.supported).toBe(false);
  });

  it('survives an engine whose request returns nothing', () => {
    const doc = fakeDoc();
    const target = fakeTarget(doc);
    target.request.mockReturnValueOnce(undefined as unknown as Promise<void>);
    const { control, log } = make(doc, target.element);
    expect(() => {
      control.toggle();
    }).not.toThrow();
    expect(target.request).toHaveBeenCalledTimes(1);
    expect(log.size).toBe(0);
  });

  it('logs a request that throws instead of rejecting, without throwing', () => {
    const doc = fakeDoc();
    const target = fakeTarget(doc);
    target.request.mockImplementationOnce(() => {
      throw new Error('not allowed');
    });
    const { control, log } = make(doc, target.element);
    expect(() => {
      control.toggle();
    }).not.toThrow();
    expect(log.size).toBe(1);
    expect(log.entries()[0]).toMatchObject({ kind: 'error' });
    expect(log.entries()[0]?.message).toContain('not allowed');
  });

  it('calls onChange on fullscreenchange until unsubscribed', () => {
    const doc = fakeDoc();
    const { control } = make(doc, fakeTarget(doc).element);
    const seen = vi.fn();
    const off = control.onChange(seen);

    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(seen).toHaveBeenCalledTimes(1);

    off();
    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('attachFullscreenKey', () => {
  type Key = { code: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown };

  function setup() {
    const win = new EventTarget();
    const toggle = vi.fn();
    const detach = attachFullscreenKey(win as never, { toggle });
    const press = ({ target, ...key }: Key): void => {
      const event = Object.assign(new Event('keydown'), { repeat: false, ctrlKey: false, metaKey: false, altKey: false }, key);
      // `target` is a getter on Event; a key typed into a form control reaches the window with that control as its target.
      if (target !== undefined) Object.defineProperty(event, 'target', { value: target });
      win.dispatchEvent(event);
    };
    return { toggle, detach, press };
  }

  it('toggles synchronously inside the keydown dispatch, before any frame could run', () => {
    const { toggle, press } = setup();
    press({ code: 'KeyF' });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Key]>([
    ['auto-repeat', { code: 'KeyF', repeat: true }],
    ['Ctrl', { code: 'KeyF', ctrlKey: true }],
    ['Cmd', { code: 'KeyF', metaKey: true }],
    ['Alt', { code: 'KeyF', altKey: true }],
    ['another key', { code: 'KeyG' }],
  ])('ignores %s', (_name, key) => {
    const { toggle, press } = setup();
    press(key);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('stands down while a form control has focus', () => {
    const { toggle, press } = setup();
    press({ code: 'KeyF', target: { tagName: 'INPUT' } });
    expect(toggle).not.toHaveBeenCalled();
  });

  it('stops listening once detached', () => {
    const { toggle, detach, press } = setup();
    detach();
    press({ code: 'KeyF' });
    expect(toggle).not.toHaveBeenCalled();
  });
});
