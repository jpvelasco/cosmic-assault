import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackdrop, layoutFor, REBAKE_DELAY_MS, type Backdrop, type Bakes } from '../../src/render/layout';
import { DRIFT, ION_REACH } from '../../src/render/palette';
import type { SpriteBaker } from '../../src/render/sprites';
import { visualScaleFor } from '../../src/render/visualScale';

const FIELD = { width: 1280, height: 720 };

/** A canvas whose 2D context accepts every call. */
function fakeCanvas(): { width: number; height: number; getContext: () => unknown } {
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy({}, { get: (_target, name) => (name === 'createLinearGradient' || name === 'createRadialGradient' ? () => gradient : () => undefined) });
  return { width: 0, height: 0, getContext: () => ctx };
}

const sizeOf = ({ sky, vignette }: Bakes): number[] => [sky.width, sky.height, vignette.width, vignette.height];

describe('layoutFor', () => {
  it('carries the visual scale for its CSS px per field unit', () => {
    expect(layoutFor(1280, 720, FIELD, 2).visual).toEqual(visualScaleFor(1));
    expect(layoutFor(390, 219.375, FIELD, 2).visual).toEqual(visualScaleFor(390 / 1280));
  });
});

describe('createBackdrop', () => {
  let backdrop: Backdrop;
  const current = (): Bakes => {
    const { bakes } = backdrop;
    if (bakes === null) throw new Error('nothing baked yet');
    return bakes;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: fakeCanvas });
    backdrop = createBackdrop({ setScale: () => undefined } as unknown as SpriteBaker, DRIFT, 1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('bakes the sky 1:1 and the vignette at a quarter of its resolution per axis', () => {
    backdrop.schedule(layoutFor(1280, 720, FIELD, 2));
    expect(sizeOf(current())).toEqual([2560, 1440, 640, 360]);
  });

  it('frees the previous sky and vignette once a re-bake replaces them', () => {
    backdrop.schedule(layoutFor(1280, 720, FIELD, 2));
    const first = current();
    backdrop.schedule(layoutFor(640, 360, FIELD, 2));
    expect(sizeOf(first)).toEqual([2560, 1440, 640, 360]);
    vi.advanceTimersByTime(REBAKE_DELAY_MS);
    expect(current()).not.toBe(first);
    expect(sizeOf(first)).toEqual([0, 0, 0, 0]);
    expect(sizeOf(current())).toEqual([1280, 720, 320, 180]);
  });

  it('frees the bakes on dispose and cancels a pending re-bake', () => {
    backdrop.schedule(layoutFor(1280, 720, FIELD, 1));
    const baked = current();
    backdrop.schedule(layoutFor(640, 360, FIELD, 1));
    backdrop.dispose();
    vi.advanceTimersByTime(REBAKE_DELAY_MS * 2);
    expect(sizeOf(baked)).toEqual([0, 0, 0, 0]);
    expect(backdrop.bakes).toBeNull();
    expect(backdrop.consumeRebaked()).toBe(false);
  });

  describe('setPalette', () => {
    const setScale = vi.fn();
    /** The colour stops painted onto the sky's linear gradient, in order, for every bake since the last reset. */
    let skyStops: string[];

    beforeEach(() => {
      setScale.mockClear();
      skyStops = [];
      const fake = (): { width: number; height: number; getContext: () => unknown } => {
        const ctx = new Proxy({}, {
          get: (_target, name) => {
            if (name === 'createLinearGradient') return () => ({ addColorStop: (_at: number, color: string) => skyStops.push(color) });
            if (name === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
            return () => undefined;
          },
        });
        return { width: 0, height: 0, getContext: () => ctx };
      };
      vi.stubGlobal('document', { createElement: fake });
      backdrop = createBackdrop({ setScale } as unknown as SpriteBaker, DRIFT, 1);
    });

    it('re-bakes the sky and vignette once, at once, in the new palette', () => {
      backdrop.schedule(layoutFor(1280, 720, FIELD, 2));
      const first = current();
      skyStops.length = 0;
      setScale.mockClear();
      backdrop.setPalette(ION_REACH);
      expect(setScale).toHaveBeenCalledTimes(1);
      expect(skyStops).toEqual([...ION_REACH.skyStops]);
      expect(current()).not.toBe(first);
      expect(sizeOf(first)).toEqual([0, 0, 0, 0]);
      expect(sizeOf(current())).toEqual([2560, 1440, 640, 360]);
      expect(backdrop.consumeRebaked()).toBe(true);
    });

    it('does nothing for the palette already in force', () => {
      backdrop.schedule(layoutFor(1280, 720, FIELD, 2));
      const first = current();
      setScale.mockClear();
      backdrop.setPalette(DRIFT);
      expect(setScale).not.toHaveBeenCalled();
      expect(current()).toBe(first);
      expect(backdrop.consumeRebaked()).toBe(false);
    });

    it('bakes the layout that is waiting out a resize, and leaves nothing for the timer to bake twice', () => {
      backdrop.schedule(layoutFor(1280, 720, FIELD, 2));
      backdrop.schedule(layoutFor(640, 360, FIELD, 2));
      setScale.mockClear();
      backdrop.setPalette(ION_REACH);
      expect(sizeOf(current())).toEqual([1280, 720, 320, 180]);
      vi.advanceTimersByTime(REBAKE_DELAY_MS * 2);
      expect(setScale).toHaveBeenCalledTimes(1);
    });

    it('bakes later layouts in the new palette, and waits for a first layout when none has come', () => {
      backdrop.setPalette(ION_REACH);
      expect(backdrop.bakes).toBeNull();
      expect(setScale).not.toHaveBeenCalled();
      backdrop.schedule(layoutFor(1280, 720, FIELD, 1));
      expect(skyStops).toEqual([...ION_REACH.skyStops]);
    });
  });
});
