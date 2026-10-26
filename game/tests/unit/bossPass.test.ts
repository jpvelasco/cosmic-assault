import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOSS_FLASH_SECONDS, createBossPass, type BossPass } from '../../src/render/bossPass';
import { createFieldPen } from '../../src/render/fieldPen';
import { DRIFT } from '../../src/render/palette';
import { createSpriteBaker, type SpriteBaker } from '../../src/render/sprites';
import type { BossView } from '../../src/sim/boss/bossRunner';

interface Draw {
  readonly image: unknown;
  readonly e: number;
  readonly f: number;
  readonly alpha: number;
}

/** A 2D context that accepts every call and logs each drawImage with the transform offset and alpha in force. */
function fakeContext(): { ctx: CanvasRenderingContext2D; draws: Draw[] } {
  const draws: Draw[] = [];
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
            return (_a: number, _b: number, _c: number, _d: number, nextE: number, nextF: number) => {
              e = nextE;
              f = nextF;
            };
          case 'drawImage':
            return (image: unknown) => draws.push({ image, e, f, alpha });
          case 'createLinearGradient':
          case 'createRadialGradient':
            return () => gradient;
          default:
            return () => undefined;
        }
      },
      set: (_target, name, value) => {
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

  it('forgets the last fight on reset', () => {
    pass.handle([{ type: 'bossHit', x: 640, y: 200, hp: 19 }]);
    pass.reset();
    expect(pass.flash).toBe(0);
  });
});
