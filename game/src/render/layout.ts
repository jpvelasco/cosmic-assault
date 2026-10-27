import type { Field } from '../sim/field';
import type { Palette } from './palette';
import { bakeSky, bakeTimeWarp, bakeVignette } from './sky';
import type { SpriteBaker } from './sprites';
import { visualScaleFor, type VisualScale } from './visualScale';

/** Where the field sits on the canvas for one viewport size. */
export interface Layout {
  readonly field: Field;
  readonly dpr: number;
  /** CSS px per field unit. */
  readonly scale: number;
  /** Device pixels per field unit (`scale × dpr`). */
  readonly k: number;
  /** How much larger than their field size sprites are drawn at this scale; hitboxes are unaffected. */
  readonly visual: VisualScale;
  /** The field's top-left corner in device pixels; above 0 on an axis that is letterboxed. */
  readonly fieldX: number;
  readonly fieldY: number;
}

/** Backdrop layers baked for a layout. */
export interface Bakes {
  readonly sky: HTMLCanvasElement;
  readonly vignette: HTMLCanvasElement;
  /** Time Warp's vignette: drawn over the field only while the warp runs. */
  readonly timeWarp: HTMLCanvasElement;
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
  /**
   * Bakes the sky for a new palette at once, from the latest layout (a resize still waiting out its delay is baked
   * now, not later). Nothing happens for the palette already in force, and before the first layout the palette is
   * just kept for it.
   */
  setPalette(palette: Palette): void;
  /** True once after each deferred re-bake, so a still frame (paused, game over) is redrawn with it. Reading clears it. */
  consumeRebaked(): boolean;
  /** Cancels a pending re-bake and frees the bakes; `bakes` is null after. */
  dispose(): void;
}

export const REBAKE_DELAY_MS = 280;

/** The device pixel ratio, capped at `cap` (a quality level's `dprCap`); 1 where the browser reports none. */
export function devicePixelRatio(cap: number): number {
  const ratio = globalThis.devicePixelRatio;
  return Math.min(Number.isFinite(ratio) && ratio > 0 ? ratio : 1, cap);
}

/** Fits `field` inside the CSS viewport, centred, at `dpr` device pixels per CSS px. */
export function layoutFor(cssWidth: number, cssHeight: number, field: Field, dpr: number): Layout {
  const scale = Math.min(cssWidth / field.width, cssHeight / field.height);
  return {
    field,
    dpr,
    scale,
    k: scale * dpr,
    visual: visualScaleFor(scale),
    fieldX: ((cssWidth - field.width * scale) / 2) * dpr,
    fieldY: ((cssHeight - field.height * scale) / 2) * dpr,
  };
}

/** Releases the bakes' backing stores now, rather than whenever the collector gets to them (iOS caps canvas memory). */
function freeBakes({ sky, vignette, timeWarp }: Bakes): void {
  for (const canvas of [sky, vignette, timeWarp]) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function createBackdrop(baker: SpriteBaker, initial: Palette, skySeed: number): Backdrop {
  let palette = initial;
  let latest: Layout | null = null;
  let bakes: Bakes | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rebaked = false;

  function bake({ field, scale, dpr, k, visual }: Layout): void {
    const previous = bakes;
    bakes = { sky: bakeSky(field, k, palette, skySeed), vignette: bakeVignette(field, k), timeWarp: bakeTimeWarp(field, k) };
    if (previous !== null) freeBakes(previous);
    baker.setScale(scale, dpr, visual);
  }

  return {
    get bakes() {
      return bakes;
    },
    schedule(layout) {
      latest = layout;
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
    setPalette(next) {
      if (next.id === palette.id) return;
      palette = next;
      if (latest === null) return;
      clearTimeout(timer);
      bake(latest);
      rebaked = true;
    },
    consumeRebaked() {
      const was = rebaked;
      rebaked = false;
      return was;
    },
    dispose() {
      clearTimeout(timer);
      if (bakes !== null) freeBakes(bakes);
      bakes = null;
    },
  };
}
