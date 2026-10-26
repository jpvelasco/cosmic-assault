import { describe, expect, it } from 'vitest';
import { createHud, hudScale, rightPillEdge, type HudBounds } from '../../src/render/hud';
import { DRIFT } from '../../src/render/palette';
import { galaxyById } from '../../src/content/galaxies';
import { World } from '../../src/sim/world';

const NONE: HudBounds = { insets: { top: 0, right: 0, left: 0 }, topRight: null };

/** A Canvas 2D stand-in: text is 10 px per character wide; every other call is a no-op. Counts measureText calls. */
function fakeContext(): { ctx: CanvasRenderingContext2D; measured: () => number } {
  let measured = 0;
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'measureText'
          ? (text: string) => {
              measured++;
              return { width: text.length * 10 };
            }
          : () => undefined,
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, measured: () => measured };
}

function world(): World {
  return new World({ seed: 1, field: { width: 1280, height: 720 }, practiceLevel: 4 });
}

describe('hudScale', () => {
  it('is 1 on short viewports and grows with height to at most 1.5', () => {
    expect(hudScale(293)).toBe(1);
    expect(hudScale(480)).toBe(1);
    expect(hudScale(600)).toBeCloseTo(1.25);
    expect(hudScale(2000)).toBe(1.5);
  });
});

describe('rightPillEdge', () => {
  it('keeps the edge margin, or the safe-area inset when it is larger', () => {
    expect(rightPillEdge(800, 12, 12, NONE, 8)).toBe(788);
    expect(rightPillEdge(800, 12, 12, { ...NONE, insets: { top: 0, right: 47, left: 0 } }, 8)).toBe(753);
  });

  it('moves left of a corner box that shares its rows, plus the gap', () => {
    expect(rightPillEdge(800, 12, 12, { ...NONE, topRight: { width: 60, height: 60 } }, 8)).toBe(732);
  });

  it('ignores a corner box that ends above the pill', () => {
    expect(rightPillEdge(800, 70, 12, { ...NONE, topRight: { width: 60, height: 60 } }, 8)).toBe(788);
  });
});

describe('createHud', () => {
  it('lays out score, lives and practice pills inside the safe area', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(844, 390);
    hud.setBounds({ insets: { top: 20, right: 0, left: 44 }, topRight: { width: 76, height: 76 } });
    hud.draw(ctx, world());
    const [score, lives, practice] = hud.rects;
    expect(score).toEqual({ x: 44, y: 20, width: 122, height: 28 });
    expect(lives).toEqual({ x: 44, y: 54, width: 60, height: 20 });
    // "Practice L4" is 110 px wide plus 12 px padding each side, ending 8 px left of the 76 px corner.
    expect(practice).toEqual({ x: 844 - 76 - 8 - 134, y: 20, width: 134, height: 28 });
  });

  it('drops the lives pill at zero lives and widens the score pill for long scores', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(1280, 720);
    // The HUD reads only these three fields.
    hud.draw(ctx, { score: 1_234_567_890, lives: 0, practiceLevel: 4 } as World);
    expect(hud.rects).toHaveLength(2);
    const [score] = hud.rects;
    // At scale 1.5: (48 + 12) × 1.5 = 90 px of label and padding plus at least 10 digits (100 px) beats the 183 px minimum.
    expect(score?.width).toBeGreaterThanOrEqual(190);
  });

  it('keeps the right pill off the score pill, dropping it below the lives pill when the top row is too narrow', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(320, 390);
    hud.setBounds({ ...NONE, topRight: { width: 60, height: 60 } });
    // 7 digits format to at least 7 characters (70 px): the score pill ends at 12 + 60 + 70 or later.
    hud.draw(ctx, { score: 1_234_567, lives: 3, practiceLevel: 4 } as World);
    const [score, lives, practice] = hud.rects;
    if (score === undefined || lives === undefined || practice === undefined) throw new Error('expected three pills');
    expect(practice.x).toBe(12);
    expect(practice.y).toBe(lives.y + lives.height + 6);
    for (const other of [score, lives]) {
      const apart = practice.y >= other.y + other.height || practice.x >= other.x + other.width;
      expect(apart).toBe(true);
    }
  });

  it('keeps the right pill on the top row, right of the score pill, when there is room', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(844, 390);
    hud.draw(ctx, { score: 1_234_567, lives: 3, practiceLevel: 4 } as World);
    const [score, , practice] = hud.rects;
    expect(practice?.y).toBe(12);
    expect(practice?.x).toBeGreaterThanOrEqual((score?.x ?? 0) + (score?.width ?? 0) + 8);
  });

  it('measures text only when the score or level changes', () => {
    const hud = createHud(DRIFT);
    const { ctx, measured } = fakeContext();
    hud.resize(844, 390);
    const w = world();
    for (let frame = 0; frame < 10; frame++) hud.draw(ctx, w);
    expect(measured()).toBe(2);
  });

  it('labels a galaxy run by its galaxy, a boss galaxy with a star, and measures the label once', () => {
    const hud = createHud(DRIFT);
    const { ctx, measured } = fakeContext();
    hud.resize(1280, 720);
    const galaxy = new World({ seed: 1, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById('1-3'), mode: 'free' } });
    for (let frame = 0; frame < 5; frame++) hud.draw(ctx, galaxy);
    // "1-3" is 3 characters (30 px) plus 12 px padding each side, at scale 1.5.
    expect(hud.rects.at(-1)?.width).toBe(30 + 2 * 12 * 1.5);
    expect(measured()).toBe(2);
    const boss = new World({ seed: 1, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById('2-6'), mode: 'rank' } });
    hud.draw(ctx, boss);
    expect(hud.rects.at(-1)?.width).toBe(30 + 2 * 12 * 1.5);
    expect(measured()).toBe(3);
  });
});
