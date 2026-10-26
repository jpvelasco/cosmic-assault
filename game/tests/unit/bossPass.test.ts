import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOSS_FLASH_SECONDS, createBossPass, type BossPass } from '../../src/render/bossPass';
import { createFieldPen } from '../../src/render/fieldPen';
import { DRIFT } from '../../src/render/palette';
import { createSpriteBaker, type SpriteBaker } from '../../src/render/sprites';
import type { BossView } from '../../src/sim/boss/bossRunner';

interface Draw {
  readonly image: unknown;
  /** The transform's x scale: the field scale times the sprite's size. */
  readonly a: number;
  readonly e: number;
  readonly f: number;
  readonly alpha: number;
}

/** A 2D context that accepts every call and logs each drawImage with the transform offset and alpha in force. */
function fakeContext(): { ctx: CanvasRenderingContext2D; draws: Draw[] } {
  const draws: Draw[] = [];
  let a = 1;
  let e = 0;
  let f = 0;
  let alpha = 1;
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        switch (name) {
          case 'setTransform':
            return (nextA: number, _b: number, _c: number, _d: number, nextE: number, nextF: number) => {
              a = nextA;
              e = nextE;
              f = nextF;
            };
          case 'drawImage':
            return (image: unknown) => draws.push({ image, a, e, f, alpha });
          case 'createLinearGradient':
          case 'createRadialGradient':
            return () => gradient;
          default:
            return () => undefined;
        }
      },
      set: (_target, name, value) => {
        if (name === 'shadowBlur') throw new Error('the boss must not use shadowBlur');
        if (name === 'globalAlpha') alpha = value as number;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, draws };
}

const fakeCanvas = (): unknown => {
  const { ctx } = fakeContext();
  return { width: 0, height: 0, getContext: () => ctx };
};

const boss = (over: Partial<BossView> = {}): BossView => ({ x: 640, y: 200, px: 600, py: 200, radius: 70, hp: 20, maxHp: 20, phase: 1, state: 'fighting', windup: null, ...over });
const LOOK = { glow: 1, still: false, aimX: 640, aimY: 600 };

describe('createBossPass', () => {
  let baker: SpriteBaker;
  let draws: Draw[];
  let pass: BossPass;

  beforeEach(() => {
    vi.stubGlobal('document', { createElement: fakeCanvas });
    baker = createSpriteBaker();
    const fake = fakeContext();
    draws = fake.draws;
    const pen = createFieldPen(fake.ctx);
    pen.aim(1, 0, 0);
    pass = createBossPass(fake.ctx, pen, baker, DRIFT);
  });

  it('draws nothing without a boss, or once it is down', () => {
    pass.draw(null, 1, LOOK);
    pass.draw(boss({ state: 'down' }), 1, LOOK);
    expect(draws).toHaveLength(0);
  });

  it('draws the core from baked sprites at its interpolated position', () => {
    const custom = vi.spyOn(baker, 'custom');
    pass.draw(boss(), 0.5, LOOK);
    expect(draws.length).toBeGreaterThan(0);
    expect(custom.mock.calls.map(([key]) => key)).toContain('boss|core|70');
    // Halfway from x 600 to 640.
    expect(draws.some(({ e, f }) => e === 620 && f === 200)).toBe(true);
  });

  it('rings the core with a glow while an attack winds up, coloured by the attack', () => {
    const custom = vi.spyOn(baker, 'custom');
    pass.draw(boss(), 1, LOOK);
    expect(custom.mock.calls.some(([key]) => key.startsWith('boss|ring|'))).toBe(false);
    pass.draw(boss({ windup: 'shardRing' }), 1, LOOK);
    pass.draw(boss({ windup: 'lunge' }), 1, LOOK);
    const rings = custom.mock.calls.map(([key]) => key).filter((key) => key.startsWith('boss|ring|'));
    expect(new Set(rings).size).toBe(2);
  });

  it('flashes on a hit, for a moment', () => {
    expect(pass.flash).toBe(0);
    pass.handle([{ type: 'bossHit', x: 640, y: 200, hp: 19 }]);
    expect(pass.flash).toBe(1);
    pass.advance(BOSS_FLASH_SECONDS / 2, boss());
    expect(pass.flash).toBeCloseTo(0.5);
    pass.advance(BOSS_FLASH_SECONDS, boss());
    expect(pass.flash).toBe(0);
  });

  it('fades the core in through its intro', () => {
    pass.advance(0.01, boss({ state: 'intro' }));
    pass.draw(boss({ state: 'intro' }), 1, LOOK);
    const early = Math.max(...draws.map((d) => d.alpha));
    draws.length = 0;
    pass.advance(2, boss({ state: 'intro' }));
    pass.draw(boss({ state: 'intro' }), 1, LOOK);
    expect(early).toBeLessThan(Math.max(...draws.map((d) => d.alpha)));
  });

  /** The draw of the sprite baked under `key` in `draws`. */
  function drawOf(key: string, spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[]; readonly results: readonly { readonly value: unknown }[] } }): Draw | undefined {
    const index = spy.mock.calls.findIndex(([k]) => k === key);
    const canvas = spy.mock.results[index]?.value as { canvas: unknown } | undefined;
    return draws.findLast((d) => d.image === canvas?.canvas);
  }

  it('closes the windup ring in on the core as the attack nears, so its size tells when it lands', () => {
    const custom = vi.spyOn(baker, 'custom');
    const winding = boss({ windup: 'shardRing' });
    pass.advance(0.01, winding);
    pass.draw(winding, 1, LOOK);
    const early = drawOf('boss|ring|shardRing|70', custom)?.a ?? 0;
    pass.advance(0.3, winding);
    pass.draw(winding, 1, LOOK);
    const later = drawOf('boss|ring|shardRing|70', custom)?.a ?? 0;
    pass.advance(0.4, winding);
    pass.draw(winding, 1, LOOK);
    const closed = drawOf('boss|ring|shardRing|70', custom)?.a ?? 0;
    expect(early).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(closed);
    expect(closed).toBeCloseTo(1);
  });

  it('holds the ring steady and at one size under reduced motion', () => {
    const custom = vi.spyOn(baker, 'custom');
    const still = { ...LOOK, still: true };
    const winding = boss({ windup: 'lunge' });
    const sizes: number[] = [];
    const alphas: number[] = [];
    for (const dt of [0.01, 0.1, 0.2]) {
      pass.advance(dt, winding);
      pass.draw(winding, 1, still);
      const ring = drawOf('boss|ring|lunge|70', custom);
      sizes.push(ring?.a ?? 0);
      alphas.push(ring?.alpha ?? 0);
    }
    expect(new Set(sizes)).toEqual(new Set([1.1]));
    expect(new Set(alphas).size).toBe(1);
  });

  it('fades and whitens the core as it dies, and grows a little', () => {
    const custom = vi.spyOn(baker, 'custom');
    const dying = boss({ state: 'dying', hp: 0 });
    pass.advance(0.01, dying);
    pass.advance(0.5, dying);
    pass.draw(dying, 1, LOOK);
    const early = drawOf('boss|core|70', custom);
    const earlyWhite = draws.filter((d) => d.alpha > 0 && d.image !== early?.image).length;
    pass.advance(1, dying);
    pass.draw(dying, 1, LOOK);
    const late = drawOf('boss|core|70', custom);
    expect(late?.alpha).toBeLessThan(early?.alpha ?? 0);
    expect(late?.a).toBeGreaterThan(early?.a ?? Infinity);
    expect(earlyWhite).toBeGreaterThan(0);
  });

  it('forgets the last fight on reset', () => {
    pass.handle([{ type: 'bossHit', x: 640, y: 200, hp: 19 }]);
    pass.reset();
    expect(pass.flash).toBe(0);
  });
});
