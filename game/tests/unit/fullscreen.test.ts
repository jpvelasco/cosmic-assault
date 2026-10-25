import { describe, expect, it, vi } from 'vitest';
import { createFullscreen } from '../../src/platform/fullscreen';
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
