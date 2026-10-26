import { describe, expect, it } from 'vitest';
import { drawBossHp, PHASE_NOTCHES } from '../../src/render/hudBoss';
import { chevronPulse, drawShowerWarning, drawTimer } from '../../src/render/hudGalaxy';
import type { HudRect } from '../../src/render/hudShapes';

interface Call {
  readonly name: string;
  readonly args: readonly number[];
  readonly alpha: number;
}

/** A 2D context that logs every call with the alpha in force, and fails on any use of `shadowBlur`. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  let alpha = 1;
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => (...args: number[]) => calls.push({ name: String(name), args, alpha }),
      set: (_target, name, value) => {
        if (name === 'shadowBlur') throw new Error('the HUD must not use shadowBlur');
        if (name === 'globalAlpha') alpha = value as number;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

const TRACK: HudRect = { x: 100, y: 20, width: 300, height: 8 };
const of = (calls: readonly Call[], name: string): Call[] => calls.filter((c) => c.name === name);

describe('drawBossHp', () => {
  it('fills the track to the HP share and notches it at one and two thirds, where the phases change', () => {
    const { ctx, calls } = recorder();
    drawBossHp(ctx, TRACK, 10, 20, 'red', 1);
    const [track, fill] = of(calls, 'roundRect');
    expect(track?.args.slice(0, 3)).toEqual([100, 20, 300]);
    expect(fill?.args[2]).toBe(150);
    const notches = of(calls, 'fillRect').map(({ args }) => (args[0] ?? 0) + (args[2] ?? 0) / 2);
    expect(notches).toEqual(PHASE_NOTCHES.map((share) => 100 + 300 * share));
    // Notches stand proud of the track by 2 px each side.
    expect(of(calls, 'fillRect')[0]?.args.slice(1)).toEqual([18, 2, 12]);
  });

  it('draws no fill once the HP is gone, and scales its notches with the HUD', () => {
    const { ctx, calls } = recorder();
    drawBossHp(ctx, TRACK, 0, 20, 'red', 1.5);
    expect(of(calls, 'roundRect')).toHaveLength(1);
    expect(of(calls, 'fillRect')[0]?.args[2]).toBe(3);
  });
});

describe('drawTimer', () => {
  const bar: HudRect = { x: 10, y: 50, width: 80, height: 4 };

  it('draws the track, then the fill to the fraction gone', () => {
    const { ctx, calls } = recorder();
    drawTimer(ctx, bar, 0.25, 'blue');
    expect(of(calls, 'roundRect').map(({ args }) => args[2])).toEqual([80, 20]);
  });

  it('draws only the track at the start, and never a fill thinner than it is tall', () => {
    const empty = recorder();
    drawTimer(empty.ctx, bar, 0, 'blue');
    expect(of(empty.calls, 'roundRect')).toHaveLength(1);
    const sliver = recorder();
    drawTimer(sliver.ctx, bar, 0.01, 'blue');
    expect(of(sliver.calls, 'roundRect')[1]?.args[2]).toBe(4);
  });
});

describe('drawShowerWarning', () => {
  const view = { width: 844, height: 390, insets: { top: 0, right: 0, left: 44 }, scale: 1 };

  it('draws three chevrons inside the telegraphed edge, past its safe-area inset, pointing in', () => {
    const { ctx, calls } = recorder();
    // The left edge.
    drawShowerWarning(ctx, Math.PI, view, 'gold', 0, true);
    const moves = of(calls, 'moveTo');
    const tips = of(calls, 'lineTo').filter((_, i) => i % 2 === 0);
    expect(moves).toHaveLength(3);
    for (const [i, tip] of tips.entries()) {
      const arm = moves[i];
      // In from the arm ends: the chevron points away from the left edge.
      expect(tip.args[0]).toBeGreaterThan(arm?.args[0] ?? Infinity);
      expect(tip.args[1]).toBeCloseTo(195);
    }
    // The first sits 26 px inside the inset; each next one 15 px further in.
    expect(tips.map(({ args }) => Math.round((args[0] ?? 0) - 4.5))).toEqual([70, 85, 100]);
  });

  it('holds still under reduced motion: a faint glow stroke and a full one, at fixed alpha', () => {
    const { ctx, calls } = recorder();
    drawShowerWarning(ctx, -Math.PI / 2, view, 'gold', 1.234, true);
    expect(new Set(of(calls, 'stroke').map(({ alpha }) => alpha))).toEqual(new Set([0.28, 1]));
  });

  it('pulses each chevron in turn otherwise, within a visible range', () => {
    expect(chevronPulse(0, 0.7, true)).toBe(1);
    const samples = Array.from({ length: 40 }, (_, k) => chevronPulse(1, k / 40, false));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.35);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
    expect(chevronPulse(0, 0.2, false)).not.toBeCloseTo(chevronPulse(1, 0.2, false));
  });
});
