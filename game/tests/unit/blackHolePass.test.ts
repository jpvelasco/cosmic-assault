import { describe, expect, it } from 'vitest';
import { createHazardPass } from '../../src/render/hazardPass';
import { paletteFor } from '../../src/render/palette';
import type { SceneLook } from '../../src/render/scene';
import type { Sprite, SpriteBaker } from '../../src/render/sprites';
import type { FieldPen } from '../../src/render/fieldPen';
import type { HazardState } from '../../src/sim/hazards/hazard';

const FIELD = { width: 1280, height: 720 };
const LOOK = (still: boolean, time: number): SceneLook => ({ glow: 1, still, time, visual: { ship: 1, rock: 1 } } as unknown as SceneLook);
const sprite = (halfW: number): Sprite => ({ canvas: null as unknown as HTMLCanvasElement, halfW, halfH: halfW });

/**
 * A hazard pass over stand-in canvases: the sprites are only named, and each stamp is recorded with the turn it was
 * drawn at. What the pass paints is the baked sprites' business, and what it does with them is what these tests read.
 */
function pass() {
  const stamps: { key: string; angle: number }[] = [];
  const keys: string[] = [];
  const baker: SpriteBaker = {
    glow: () => sprite(100),
    custom: (key: string, half: number) => {
      keys.push(key);
      return { canvas: null as unknown as HTMLCanvasElement, halfW: half, halfH: half };
    },
  } as unknown as SpriteBaker;
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over' } as unknown as CanvasRenderingContext2D;
  const pen = { aim: () => undefined, field: () => undefined, place: () => undefined } as unknown as FieldPen;
  const stamp = (_sprite: Sprite, _x: number, _y: number, cos: number, sin: number): void => {
    stamps.push({ key: keys[keys.length - 1] ?? '', angle: Math.atan2(sin, cos) });
  };
  return { hazards: createHazardPass(ctx, pen, stamp, baker, paletteFor('singularity')), stamps, keys };
}

const hole = (stage: HazardState['stage'], remaining = 40): HazardState => ({ id: 7, type: 'blackHole', stage, x: 640, y: 360, intensity: 2, remaining });

describe('the black hole\'s art', () => {
  it('turns its accretion ring as the game runs, and holds it still under reduced motion', () => {
    const turning = pass();
    turning.hazards.drawHazards([hole('active')], FIELD, LOOK(false, 1.5));
    const ring = turning.stamps.find((s) => s.key.endsWith('|disc'));
    // 0.9 rad/s over 1.5 s of play: 1.35 rad, the turn the ring is stamped at.
    expect(ring?.angle).toBeCloseTo(1.35, 6);

    const still = pass();
    still.hazards.drawHazards([hole('active')], FIELD, LOOK(true, 1.5));
    expect(still.stamps.find((s) => s.key.endsWith('|disc'))?.angle).toBe(0);
  });

  it('bakes its lens and accretion ring under keys of its own, and its warning under another', () => {
    const drawn = pass();
    drawn.hazards.drawHazards([hole('active')], FIELD, LOOK(false, 1));
    expect(drawn.keys.filter((k) => k.startsWith('hole|singularity|')).sort()).toEqual(['hole|singularity|disc', 'hole|singularity|lens']);
    const warned = pass();
    warned.hazards.drawWarnings([hole('warning', 2)], FIELD, LOOK(false, 1));
    expect(warned.keys).toEqual(['hole|singularity|warn']);
  });

  it('draws nothing for its warning in the field, and nothing for the active hole among the warnings', () => {
    const drawn = pass();
    drawn.hazards.drawHazards([hole('warning', 2)], FIELD, LOOK(false, 1));
    expect(drawn.keys).toEqual([]);
    drawn.hazards.drawWarnings([hole('active')], FIELD, LOOK(false, 1));
    expect(drawn.keys).toEqual([]);
  });
});
