import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackdrop, layoutFor, REBAKE_DELAY_MS, type Backdrop, type Bakes } from '../../src/render/layout';
import { DRIFT } from '../../src/render/palette';
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
});
