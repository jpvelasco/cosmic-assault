import { describe, expect, it } from 'vitest';
import { createHud, HUD_PILLS, hudScale, rightPillEdge, type HudBounds, type HudRect } from '../../src/render/hud';
import { showerWarningAngle, timerFraction } from '../../src/render/hudGalaxy';
import { DRIFT } from '../../src/render/palette';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import type { BossView } from '../../src/sim/boss/bossRunner';
import type { ShowerState } from '../../src/sim/galaxy/showers';
import { World } from '../../src/sim/world';

const NONE: HudBounds = { insets: { top: 0, right: 0, left: 0 }, topRight: null };

/** A Canvas 2D stand-in: text is 10 px per character wide; every other call is a no-op. Counts measureText calls and keeps what was written. */
function fakeContext(): { ctx: CanvasRenderingContext2D; measured: () => number; texts: string[] } {
  let measured = 0;
  const texts: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        switch (name) {
          case 'measureText':
            return (text: string) => {
              measured++;
              return { width: text.length * 10 };
            };
          case 'fillText':
            return (text: string) => texts.push(text);
          case 'createLinearGradient':
            return () => gradient;
          default:
            return () => undefined;
        }
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, measured: () => measured, texts };
}

interface GalaxyWorld {
  readonly galaxy?: GalaxyId;
  readonly lives?: number;
  readonly timeLeft?: number;
  readonly multiplier?: number;
  readonly boss?: Partial<BossView> | null;
  readonly shower?: ShowerState | null;
}

/** The fields of a galaxy World the HUD reads, as a stand-in. */
function galaxyWorld({ galaxy = '1-3', lives = 3, timeLeft = 45, multiplier = 1, boss = null, shower = null }: GalaxyWorld = {}): World {
  const fight = boss === null ? null : { x: 640, y: 200, px: 640, py: 200, radius: 70, hp: 20, maxHp: 20, phase: 1, state: 'fighting', windup: null, ...boss };
  return { score: 0, lives, practiceLevel: 1, elapsed: 10, galaxy: galaxyById(galaxy), timeLeft, multiplier, boss: fight, shower } as unknown as World;
}

function apart(a: HudRect, b: HudRect): boolean {
  return a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height;
}

/** Every pair of pills is apart, and each lies inside the viewport and clear of the corner box. */
function expectClearLayout(rects: readonly HudRect[], width: number, height: number, corner: HudRect | null): void {
  rects.forEach((rect, i) => {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    if (corner !== null) expect(apart(rect, corner), `${JSON.stringify(rect)} under the corner`).toBe(true);
    for (const other of rects.slice(i + 1)) expect(apart(rect, other), `${JSON.stringify(rect)} overlaps ${JSON.stringify(other)}`).toBe(true);
  });
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

/** A practice World stand-in with only what the HUD reads. */
function practiceWorld(score: number, lives: number): World {
  return { score, lives, practiceLevel: 4, elapsed: 0, galaxy: null, timeLeft: null, multiplier: 1, boss: null, shower: null } as unknown as World;
}

describe('timerFraction', () => {
  it('is the share of the galaxy gone, filling from 0 at the start to 1 at the warp', () => {
    expect(timerFraction(90, 90)).toBe(0);
    expect(timerFraction(45, 90)).toBe(0.5);
    expect(timerFraction(9, 90)).toBeCloseTo(0.9);
    expect(timerFraction(0, 90)).toBe(1);
  });

  it('stays within 0 and 1, and reads full for a galaxy with no length', () => {
    expect(timerFraction(120, 90)).toBe(0);
    expect(timerFraction(-3, 90)).toBe(1);
    expect(timerFraction(0, 0)).toBe(1);
  });
});

describe('showerWarningAngle', () => {
  it('points at the edge a shower is telegraphed from, only while it is a warning', () => {
    expect(showerWarningAngle({ stage: 'warning', edge: 1, angle: 0, remaining: 2 })).toBe(0);
    expect(showerWarningAngle({ stage: 'warning', edge: 0, angle: -Math.PI / 2, remaining: 0.1 })).toBe(-Math.PI / 2);
    expect(showerWarningAngle({ stage: 'active', edge: 1, angle: 0, remaining: 5 })).toBeNull();
    expect(showerWarningAngle(null)).toBeNull();
  });
});

/** A Canvas 2D stand-in that keeps every point a path is drawn through, for the shower chevrons; text is 10 px per character. */
function pathContext(): { ctx: CanvasRenderingContext2D; points: { x: number; y: number }[] } {
  const points: { x: number; y: number }[] = [];
  const keep = (x: number, y: number) => points.push({ x, y });
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'moveTo' || name === 'lineTo') return keep;
        if (name === 'measureText') return (text: string) => ({ width: text.length * 10 });
        if (name === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, points };
}

describe('createHud shower chevrons', () => {
  /** The chevron points drawn for a shower warned from bearing `angle` on an 844×390 phone with `bounds`. */
  function chevrons(angle: number, bounds: HudBounds): { x: number; y: number }[] {
    const hud = createHud(DRIFT);
    const { ctx, points } = pathContext();
    hud.resize(844, 390);
    hud.setBounds(bounds);
    const shower: ShowerState = { stage: 'warning', edge: 0, angle, remaining: 2 };
    // A frame with no shower counts the pills' points; the warned frame draws those again, then the chevrons.
    hud.draw(ctx, galaxyWorld(), 0);
    const pills = points.length;
    hud.draw(ctx, galaxyWorld({ shower }), 0);
    return points.slice(2 * pills);
  }
  const insets = { insets: { top: 30, right: 47, left: 44 }, topRight: { width: 76, height: 76 } };

  it('draws them inside the left and right safe areas, moved in by exactly the inset', () => {
    for (const [angle, side] of [[Math.PI, 'left'], [0, 'right']] as const) {
      const bare = chevrons(angle, NONE);
      const inset = chevrons(angle, insets);
      expect(bare.length).toBeGreaterThan(0);
      const sign = side === 'left' ? 1 : -1;
      const shift = insets.insets[side];
      inset.forEach((p, i) => {
        expect(p.x).toBeCloseTo((bare[i]?.x ?? Number.NaN) + sign * shift, 9);
        expect(p.y).toBeCloseTo(bare[i]?.y ?? Number.NaN, 9);
      });
      if (side === 'left') expect(Math.min(...inset.map((p) => p.x))).toBeGreaterThan(shift);
      else expect(Math.max(...inset.map((p) => p.x))).toBeLessThan(844 - shift);
    }
  });

  it('draws them below the top inset for a shower from the top, and ignores it for one from the bottom', () => {
    const top = chevrons(-Math.PI / 2, insets);
    const bareTop = chevrons(-Math.PI / 2, NONE);
    top.forEach((p, i) => {
      expect(p.y).toBeCloseTo((bareTop[i]?.y ?? Number.NaN) + 30, 9);
    });
    expect(Math.min(...top.map((p) => p.y))).toBeGreaterThan(30);
    expect(chevrons(Math.PI / 2, insets)).toEqual(chevrons(Math.PI / 2, NONE));
  });
});

describe('createHud', () => {
  it('lays out score, lives and practice pills inside the safe area', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(844, 390);
    hud.setBounds({ insets: { top: 20, right: 0, left: 44 }, topRight: { width: 76, height: 76 } });
    const w = world();
    hud.draw(ctx, w, w.score);
    const [score, lives, practice] = hud.rects;
    expect(score).toEqual({ x: 44, y: 20, width: 122, height: 28 });
    expect(lives).toEqual({ x: 44, y: 54, width: 60, height: 20 });
    // "Practice L4" is 110 px wide plus 12 px padding each side, ending 8 px left of the 76 px corner.
    expect(practice).toEqual({ x: 844 - 76 - 8 - 134, y: 20, width: 134, height: 28 });
    expect(hud.rects).toHaveLength(3);
  });

  it('drops the lives pill at zero lives and widens the score pill for long scores', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(1280, 720);
    hud.draw(ctx, practiceWorld(0, 0), 1_234_567_890);
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
    hud.draw(ctx, practiceWorld(0, 3), 1_234_567);
    const [score, lives, practice] = hud.rects;
    if (score === undefined || lives === undefined || practice === undefined) throw new Error('expected three pills');
    expect(practice.x).toBe(12);
    expect(practice.y).toBe(lives.y + lives.height + 6);
    for (const other of [score, lives]) expect(apart(practice, other)).toBe(true);
  });

  it('keeps the right pill on the top row, right of the score pill, when there is room', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(844, 390);
    hud.draw(ctx, practiceWorld(0, 3), 1_234_567);
    const [score, , practice] = hud.rects;
    expect(practice?.y).toBe(12);
    expect(practice?.x).toBeGreaterThanOrEqual((score?.x ?? 0) + (score?.width ?? 0) + 8);
  });

  it('measures text only when the score or level changes', () => {
    const hud = createHud(DRIFT);
    const { ctx, measured } = fakeContext();
    hud.resize(844, 390);
    const w = world();
    for (let frame = 0; frame < 10; frame++) hud.draw(ctx, w, w.score);
    expect(measured()).toBe(2);
  });

  it('shows the score it is given: the run total in Rank rather than the galaxy score', () => {
    const hud = createHud(DRIFT);
    const { ctx, texts } = fakeContext();
    hud.resize(1280, 720);
    // The World has scored 345 in this galaxy; the run carried 12,000 into it.
    hud.draw(ctx, galaxyWorld(), 12_345);
    expect(texts).toContain(new Intl.NumberFormat().format(12_345));
    expect(texts).not.toContain('345');
  });

  it('labels a galaxy run by its galaxy, a boss galaxy with a star, and measures each label once', () => {
    const hud = createHud(DRIFT);
    const { ctx, measured, texts } = fakeContext();
    hud.resize(1280, 720);
    const galaxy = new World({ seed: 1, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById('1-3'), mode: 'free' } });
    for (let frame = 0; frame < 5; frame++) hud.draw(ctx, galaxy, galaxy.score);
    expect(texts).toContain('GALAXY');
    expect(texts).toContain('1-3');
    // "GALAXY" (60 px), a 6 px gap and "1-3" (30 px) inside 12 px of padding each side, at scale 1.5.
    expect(hud.pill('galaxy')?.width).toBe(60 + 30 + (6 + 2 * 12) * 1.5);
    // The score, the caption and the label.
    expect(measured()).toBe(3);
    const boss = new World({ seed: 1, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById('2-6'), mode: 'rank' } });
    hud.draw(ctx, boss, boss.score);
    expect(texts).toContain('2-★');
    expect(measured()).toBe(4);
  });

  it('runs a thin timer bar under the galaxy pill, as wide as its straight edge', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(844, 390);
    hud.draw(ctx, galaxyWorld(), 0);
    const galaxy = hud.pill('galaxy');
    const timer = hud.pill('timer');
    if (galaxy === null || timer === null) throw new Error('expected the galaxy pill and its timer');
    expect(timer.y).toBe(galaxy.y + galaxy.height + 4);
    expect(timer.height).toBe(4);
    expect(timer.x).toBe(galaxy.x + galaxy.height / 2);
    expect(timer.width).toBe(galaxy.width - galaxy.height);
  });

  it('keeps the timer through a boss galaxy approach and hides it once the boss appears, which brings its HP bar', () => {
    const hud = createHud(DRIFT);
    const { ctx, texts } = fakeContext();
    hud.resize(1280, 720);
    hud.draw(ctx, galaxyWorld({ galaxy: '1-6', timeLeft: 5 }), 0);
    expect(hud.pill('timer')).not.toBeNull();
    expect(hud.pill('boss')).toBeNull();
    hud.draw(ctx, galaxyWorld({ galaxy: '1-6', timeLeft: 0, boss: { hp: 12 } }), 0);
    expect(hud.pill('timer')).toBeNull();
    expect(hud.pill('boss')).not.toBeNull();
    expect(texts).toContain('SENTINEL');
    // Once it is down the bar goes too, as the ship warps out.
    hud.draw(ctx, galaxyWorld({ galaxy: '1-6', timeLeft: 0, boss: { hp: 0, state: 'down' } }), 0);
    expect(hud.pill('boss')).toBeNull();
  });

  it('shows the combo pill only while the multiplier is above 1, beside the lives', () => {
    const hud = createHud(DRIFT);
    const { ctx, texts } = fakeContext();
    hud.resize(844, 390);
    hud.draw(ctx, galaxyWorld({ multiplier: 1 }), 0);
    expect(hud.pill('combo')).toBeNull();
    hud.draw(ctx, galaxyWorld({ multiplier: 3 }), 0);
    const combo = hud.pill('combo');
    const lives = hud.pill('lives');
    if (combo === null || lives === null) throw new Error('expected the combo pill beside the lives');
    expect(texts).toContain('×3');
    expect(combo.y).toBe(lives.y);
    expect(combo.x).toBeGreaterThan(lives.x + lives.width);
    hud.draw(ctx, galaxyWorld({ multiplier: 1 }), 0);
    expect(hud.pill('combo')).toBeNull();
  });

  it('names its pills in draw order', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(1280, 720);
    hud.draw(ctx, galaxyWorld({ galaxy: '1-6', multiplier: 2, boss: {} }), 0);
    expect(HUD_PILLS.map((id) => hud.pill(id)).filter((r) => r !== null)).toEqual(hud.rects);
  });

  it.each([
    ['an 844×390 phone, under its pause button and notch', 844, 390, { insets: { top: 0, right: 44, left: 44 }, topRight: { width: 76, height: 76 } }],
    ['a 1280×720 screen', 1280, 720, NONE],
    ['a 568×320 phone, under its pause button', 568, 320, { ...NONE, topRight: { width: 76, height: 76 } }],
  ] as const)('keeps every pill apart with the boss bar up on %s', (_name, width, height, bounds) => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(width, height);
    hud.setBounds(bounds);
    // The widest HUD: a long run total, five lives, a top combo and the boss.
    hud.draw(ctx, galaxyWorld({ galaxy: '3-6', lives: 5, multiplier: 5, timeLeft: 0, boss: { hp: 9 } }), 1_234_567);
    const corner = bounds.topRight === null ? null : { x: width - bounds.topRight.width, y: 0, width: bounds.topRight.width, height: bounds.topRight.height };
    expect(hud.rects).toHaveLength(5);
    expectClearLayout(hud.rects, width, height, corner);
  });

  it('centres the boss bar at the top when the row has room', () => {
    const hud = createHud(DRIFT);
    const { ctx } = fakeContext();
    hud.resize(1280, 720);
    hud.draw(ctx, galaxyWorld({ galaxy: '1-6', timeLeft: 0, boss: {} }), 0);
    const boss = hud.pill('boss');
    if (boss === null) throw new Error('expected the boss bar');
    expect(boss.y).toBe(hud.pill('score')?.y);
    expect(boss.x + boss.width / 2).toBeCloseTo(640);
  });

  it('keeps every pill apart mid-galaxy with a combo going, on a phone and a desktop', () => {
    for (const [width, height] of [
      [844, 390],
      [1280, 720],
    ] as const) {
      const hud = createHud(DRIFT);
      const { ctx } = fakeContext();
      hud.resize(width, height);
      hud.setBounds({ ...NONE, topRight: { width: 76, height: 76 } });
      hud.draw(ctx, galaxyWorld({ lives: 4, multiplier: 4 }), 98_765);
      expect(hud.rects).toHaveLength(5);
      expectClearLayout(hud.rects, width, height, { x: width - 76, y: 0, width: 76, height: 76 });
    }
  });
});
