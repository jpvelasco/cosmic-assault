import type { Field } from '../sim/field';
import type { Palette } from './palette';
import { bakeSky, bakeVignette } from './sky';
import type { SpriteBaker } from './sprites';

/** Where the field sits on the canvas for one viewport size. */
export interface Layout {
  readonly field: Field;
  readonly dpr: number;
  /** CSS px per field unit. */
  readonly scale: number;
  /** Device pixels per field unit (`scale × dpr`). */
  readonly k: number;
  /** The field's top-left corner in device pixels; above 0 on an axis that is letterboxed. */
  readonly fieldX: number;
  readonly fieldY: number;
}

/** Backdrop layers baked for a layout. */
export interface Bakes {
  readonly sky: HTMLCanvasElement;
  readonly vignette: HTMLCanvasElement;
}

/**
 * Bakes the sky, the vignette and (through the sprite baker's scale) the sprites for the latest
 * layout. The first layout bakes at once, as nothing can draw without it; later ones wait until
 * resizing has settled for `REBAKE_DELAY_MS`, and until then the old bakes stretch to fit.
 */
export interface Backdrop {
  /** Null until the first `schedule`. */
  readonly bakes: Bakes | null;
  schedule(layout: Layout): void;
  /** True once after each deferred re-bake, so a still frame (paused, game over) is redrawn with it. Reading clears it. */
  consumeRebaked(): boolean;
  /** Cancels a pending re-bake. */
  dispose(): void;
}

const MAX_DPR = 2;
export const REBAKE_DELAY_MS = 280;

/** The device pixel ratio, capped at `cap` (and at MAX_DPR); 1 where the browser reports none. */
export function devicePixelRatio(cap = MAX_DPR): number {
  const ratio = globalThis.devicePixelRatio;
  return Math.min(Number.isFinite(ratio) && ratio > 0 ? ratio : 1, cap, MAX_DPR);
}

/** Fits `field` inside the CSS viewport, centred, at `dpr` device pixels per CSS px. */
export function layoutFor(cssWidth: number, cssHeight: number, field: Field, dpr: number): Layout {
  const scale = Math.min(cssWidth / field.width, cssHeight / field.height);
  return {
    field,
    dpr,
    scale,
    k: scale * dpr,
    fieldX: ((cssWidth - field.width * scale) / 2) * dpr,
    fieldY: ((cssHeight - field.height * scale) / 2) * dpr,
  };
}

export function createBackdrop(baker: SpriteBaker, palette: Palette, skySeed: number): Backdrop {
  let bakes: Bakes | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rebaked = false;

  function bake({ field, scale, dpr, k }: Layout): void {
    bakes = { sky: bakeSky(field, k, palette, skySeed), vignette: bakeVignette(field, k) };
    baker.setScale(scale, dpr);
  }

  return {
    get bakes() {
      return bakes;
    },
    schedule(layout) {
      clearTimeout(timer);
      if (bakes === null) {
        bake(layout);
        return;
      }
      timer = setTimeout(() => {
        bake(layout);
        rebaked = true;
      }, REBAKE_DELAY_MS);
    },
    consumeRebaked() {
      const was = rebaked;
      rebaked = false;
      return was;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
