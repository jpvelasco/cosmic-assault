import { createHazardPass, type HazardPass } from '../../src/render/hazardPass';
import type { FieldPen } from '../../src/render/fieldPen';
import type { PaletteId } from '../../src/content/types';
import { paletteFor } from '../../src/render/palette';
import type { SceneLook } from '../../src/render/scene';
import type { Sprite, SpriteBaker } from '../../src/render/sprites';
import { recordingContext } from './fakeCanvas';

export const PASS_FIELD = { width: 1280, height: 720 };
/** A scene's look with full glow, at `time` seconds, held still under reduced motion if `still`. */
export const passLook = (still: boolean, time: number): SceneLook => ({ glow: 1, still, time, visual: { ship: 1, rock: 1 } }) as unknown as SceneLook;

/** A path or stroke call on the context, with the alpha and dash it was made under. */
export interface PassCall {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly alpha: number;
  readonly dash: readonly number[];
}

/** A sprite stamped: the key it was last baked under, the alpha, the turn it was drawn at and its drawn reach. */
export interface PassStamp {
  readonly key: string;
  readonly alpha: number;
  readonly angle: number;
  readonly reach: number;
}

export interface PassRig {
  readonly hazards: HazardPass;
  readonly calls: PassCall[];
  readonly keys: string[];
  readonly stamps: PassStamp[];
}

const sprite = (halfW: number): Sprite => ({ canvas: null as unknown as HTMLCanvasElement, halfW, halfH: halfW });
const PATH_CALLS = ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'arc', 'ellipse', 'stroke', 'fill', 'fillRect', 'clip', 'save', 'restore'] as const;

/**
 * A hazard pass in `palette` over a recording context: every path call and stamp is logged with the alpha (and dash) it was
 * made under, and the baked sprites are only named. What the sprites paint is the baker's business; what the pass does with
 * them, and with its own strokes, is what the tests read.
 */
export function hazardPassRig(palette: PaletteId): PassRig {
  const calls: PassCall[] = [];
  const keys: string[] = [];
  const stamps: PassStamp[] = [];
  const state = { alpha: 1, dash: [] as readonly number[] };
  const ctx = recordingContext({
    call: (name, args) => {
      if (name === 'setLineDash') state.dash = args[0] as readonly number[];
      else if ((PATH_CALLS as readonly string[]).includes(name)) calls.push({ name, args, alpha: state.alpha, dash: state.dash });
    },
    set: (name, value) => {
      if (name === 'globalAlpha') state.alpha = value as number;
    },
  });
  const baker = {
    glow: () => sprite(100),
    custom: (key: string, half: number) => {
      keys.push(key);
      return sprite(half);
    },
  } as unknown as SpriteBaker;
  const pen = { aim: () => undefined, field: () => undefined, place: () => undefined } as unknown as FieldPen;
  const stamp = (_sprite: Sprite, _x: number, _y: number, cos: number, sin: number, reach: number): void => {
    stamps.push({ key: keys[keys.length - 1] ?? '', alpha: state.alpha, angle: Math.atan2(sin, cos), reach });
  };
  return { hazards: createHazardPass(ctx as CanvasRenderingContext2D, pen, stamp, baker, paletteFor(palette)), calls, keys, stamps };
}
