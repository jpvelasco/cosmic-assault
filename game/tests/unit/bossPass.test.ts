import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOSS_FLASH_SECONDS, createBossPass, type BossPass } from '../../src/render/bossPass';
import { createFieldPen } from '../../src/render/fieldPen';
import { DRIFT, SINGULARITY, VOID_RIFT, type Palette } from '../../src/render/palette';
import { createSpriteBaker, type SpriteBaker } from '../../src/render/sprites';
import type { BossPart, BossView } from '../../src/sim/boss/behaviour';
import { bossView } from '../helpers/bossView';

interface Draw {
  readonly image: unknown;
  /** The transform's x scale: the field scale times the sprite's size. */
  readonly a: number;
  /** The transform's scale, however it is turned. */
  readonly scale: number;
  readonly e: number;
  readonly f: number;
  readonly alpha: number;
}

/** A 2D context that accepts every call and logs each drawImage with the transform offset and alpha in force, to `sink`. */
function fakeContext(sink?: (draw: Draw) => void): { ctx: CanvasRenderingContext2D; draws: Draw[] } {
  const draws: Draw[] = [];
  const log = sink ?? ((draw: Draw) => draws.push(draw));
  let a = 1;
  let b = 0;
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
            return (nextA: number, nextB: number, _c: number, _d: number, nextE: number, nextF: number) => {
              a = nextA;
              b = nextB;
              e = nextE;
              f = nextF;
            };
          case 'drawImage':
            return (image: unknown) => {
              log({ image, a, scale: Math.hypot(a, b), e, f, alpha });
            };
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

/** Draws onto offscreen canvases (bakes, and the Hive Carrier's turned hull), each with the canvas it lands on. */
let offscreen: (Draw & { readonly target: unknown })[] = [];

const fakeCanvas = (): unknown => {
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const { ctx } = fakeContext((draw) => offscreen.push({ ...draw, target: canvas }));
  return canvas;
};

const boss = (over: Partial<BossView> = {}): BossView => bossView({ y: 200, px: 600, ...over });
const LOOK = { glow: 1, still: false, aimX: 640, aimY: 600 };

describe('createBossPass', () => {
  let baker: SpriteBaker;
  let draws: Draw[];
  let pass: BossPass;

  beforeEach(() => {
    vi.stubGlobal('document', { createElement: fakeCanvas });
    offscreen = [];
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
    expect(custom.mock.calls.map(([key]) => key)).toContain('boss|drift|core|70');
    // Halfway from x 600 to 640.
    expect(draws.some(({ e, f }) => e === 620 && f === 200)).toBe(true);
  });

  it('rings the core with a glow while an attack winds up, coloured by the attack', () => {
    const custom = vi.spyOn(baker, 'custom');
    pass.draw(boss(), 1, LOOK);
    expect(custom.mock.calls.some(([key]) => key.startsWith('boss|drift|ring|'))).toBe(false);
    pass.draw(boss({ windup: 'shardRing' }), 1, LOOK);
    pass.draw(boss({ windup: 'lunge' }), 1, LOOK);
    const rings = custom.mock.calls.map(([key]) => key).filter((key) => key.startsWith('boss|drift|ring|'));
    expect(new Set(rings).size).toBe(2);
  });

  it('keys every baked boss sprite by palette, so no two palettes share one', () => {
    const keysIn = (palette: Palette): string[] => {
      const fake = fakeContext();
      const pen = createFieldPen(fake.ctx);
      pen.aim(1, 0, 0);
      const custom = vi.spyOn(baker, 'custom');
      custom.mockClear();
      const drawing = createBossPass(fake.ctx, pen, baker, palette);
      for (const id of ['sentinel', 'monolith', 'hiveCarrier'] as const) {
        drawing.draw(boss({ id, windup: 'lunge' }), 1, LOOK);
      }
      return [...new Set(custom.mock.calls.map(([key]) => key))];
    };
    const [drift, rift, hole] = [DRIFT, VOID_RIFT, SINGULARITY].map(keysIn) as [string[], string[], string[]];
    expect(drift.length).toBeGreaterThan(3);
    for (const [palette, keys] of [[DRIFT, drift], [VOID_RIFT, rift], [SINGULARITY, hole]] as const) {
      for (const key of keys) expect(key.startsWith(`boss|${palette.id}|`), key).toBe(true);
    }
    expect(new Set([...drift, ...rift, ...hole]).size).toBe(drift.length + rift.length + hole.length);
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

  it('draws the core as its white silhouette for the first 60 ms after a hit, then in colour again', () => {
    pass.draw(boss(), 1, LOOK);
    const core = baker.custom('boss|drift|core|70', 0, () => undefined).canvas;
    const white = baker.white('boss|drift|core|70')?.canvas;
    expect(white).toBeDefined();
    draws.length = 0;
    pass.handle([{ type: 'bossHit', x: 640, y: 200, hp: 19 }]);
    pass.advance(0.05, boss());
    pass.draw(boss(), 1, LOOK);
    expect(draws.some(({ image }) => image === white)).toBe(true);
    expect(draws.some(({ image }) => image === core)).toBe(false);
    draws.length = 0;
    pass.advance(0.02, boss());
    pass.draw(boss(), 1, LOOK);
    expect(draws.some(({ image }) => image === white)).toBe(false);
    expect(draws.some(({ image }) => image === core)).toBe(true);
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
    const early = drawOf('boss|drift|ring|shardRing|70', custom)?.a ?? 0;
    pass.advance(0.3, winding);
    pass.draw(winding, 1, LOOK);
    const later = drawOf('boss|drift|ring|shardRing|70', custom)?.a ?? 0;
    pass.advance(0.4, winding);
    pass.draw(winding, 1, LOOK);
    const closed = drawOf('boss|drift|ring|shardRing|70', custom)?.a ?? 0;
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
      const ring = drawOf('boss|drift|ring|lunge|70', custom);
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
    const early = drawOf('boss|drift|core|70', custom);
    const earlyWhite = draws.filter((d) => d.alpha > 0 && d.image !== early?.image).length;
    pass.advance(1, dying);
    pass.draw(dying, 1, LOOK);
    const late = drawOf('boss|drift|core|70', custom);
    expect(late?.alpha).toBeLessThan(early?.alpha ?? 0);
    expect(late?.a).toBeGreaterThan(early?.a ?? Infinity);
    expect(earlyWhite).toBeGreaterThan(0);
  });

  describe('the Monolith', () => {
    const shard = (x: number, hp = 2): BossPart => ({ x, y: 330, px: x, py: 330, radius: 15, hp, maxHp: 2 });
    const monolith = (over: Partial<BossView> = {}): BossView =>
      boss({ id: 'monolith', radius: 90, hp: 60, maxHp: 60, vulnerable: false, parts: [shard(600), shard(640, 1), shard(680, 0)], ...over });
    const keysOf = (spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }): unknown[] => spy.mock.calls.map(([key]) => key);

    it('draws a rock core with fissures, and a shard for each live part, cracked once hurt, with no eye', () => {
      const custom = vi.spyOn(baker, 'custom');
      pass.draw(monolith(), 1, LOOK);
      const keys = keysOf(custom);
      expect(keys).toEqual(expect.arrayContaining(['boss|drift|monolith|core|90', 'boss|drift|monolith|fissures|90', 'boss|drift|monolith|shard|15', 'boss|drift|monolith|shardCracked|15']));
      expect(keys.filter((k) => k === 'boss|drift|monolith|shard|15')).toHaveLength(1);
      expect(keys.filter((k) => k === 'boss|drift|monolith|shardCracked|15')).toHaveLength(1);
      expect(keys.some((k) => String(k).startsWith('boss|drift|eye|'))).toBe(false);
      expect(keys).not.toContain('boss|drift|core|90');
    });

    it('lights its fissures brighter, and adds a glow, once its core is exposed', () => {
      const custom = vi.spyOn(baker, 'custom');
      const glow = vi.spyOn(baker, 'glow');
      pass.draw(monolith(), 1, LOOK);
      const shielded = drawOf('boss|drift|monolith|fissures|90', custom)?.alpha ?? 1;
      const shieldedGlows = glow.mock.calls.length;
      pass.draw(monolith({ vulnerable: true }), 1, LOOK);
      const exposed = drawOf('boss|drift|monolith|fissures|90', custom)?.alpha ?? 0;
      expect(exposed).toBeGreaterThan(shielded + 0.3);
      expect(glow.mock.calls.length - shieldedGlows).toBeGreaterThan(shieldedGlows);
    });

    it('flashes a shard white when a shot cracks it', () => {
      const white = vi.spyOn(baker, 'white');
      pass.draw(monolith(), 1, LOOK);
      expect(white.mock.calls.map(([key]) => key)).not.toContain('boss|drift|monolith|shard|15');
      pass.handle([{ type: 'bossPartHit', part: 0, x: 600, y: 330, hp: 1 }]);
      pass.draw(monolith(), 1, LOOK);
      expect(white.mock.calls.map(([key]) => key)).toContain('boss|drift|monolith|shard|15');
      pass.advance(0.2, monolith());
      white.mockClear();
      pass.draw(monolith(), 1, LOOK);
      expect(white).not.toHaveBeenCalled();
    });

    it('grows a shard back in, from small to full size', () => {
      const custom = vi.spyOn(baker, 'custom');
      const broken = monolith({ parts: [shard(600, 0)] });
      pass.advance(0.01, broken);
      const regrown = monolith({ parts: [shard(600)] });
      pass.advance(0.05, regrown);
      pass.draw(regrown, 1, LOOK);
      const early = drawOf('boss|drift|monolith|shard|15', custom)?.scale ?? 0;
      pass.advance(1, regrown);
      pass.draw(regrown, 1, LOOK);
      const later = drawOf('boss|drift|monolith|shard|15', custom)?.scale ?? 0;
      expect(early).toBeLessThan(later * 0.7);
      expect(later).toBeCloseTo(1, 6);
    });

    it('brings its shards in with the core through the intro, at its scale and about its centre', () => {
      const custom = vi.spyOn(baker, 'custom');
      const arriving = monolith({ state: 'intro', px: 640, parts: [shard(740)] });
      pass.advance(0.01, arriving);
      pass.advance(0.1, arriving);
      pass.draw(arriving, 1, LOOK);
      const early = drawOf('boss|drift|monolith|shard|15', custom);
      expect(early?.scale ?? 1).toBeLessThan(0.9);
      expect(Math.hypot((early?.e ?? 0) - 640, (early?.f ?? 0) - 200)).toBeLessThan(Math.hypot(740 - 640, 330 - 200) * 0.9);
    });

    it('starts each fight with its shards whole, not growing back from the last fight', () => {
      const custom = vi.spyOn(baker, 'custom');
      pass.advance(0.01, monolith({ parts: [shard(600, 0)] }));
      pass.handle([{ type: 'bossIntro', id: 'monolith' }]);
      const next = monolith({ parts: [shard(600)] });
      pass.advance(0.01, next);
      pass.draw(next, 1, LOOK);
      expect(drawOf('boss|drift|monolith|shard|15', custom)?.scale).toBeCloseTo(1, 6);
    });

    it('rings its windups in the attack\'s colour, and sends a shockwave out as it pulses', () => {
      const custom = vi.spyOn(baker, 'custom');
      pass.draw(monolith({ windup: 'shardVolley' }), 1, LOOK);
      pass.draw(monolith({ windup: 'quake' }), 1, LOOK);
      pass.draw(monolith({ windup: 'pulse' }), 1, LOOK);
      expect(keysOf(custom)).toEqual(expect.arrayContaining(['boss|drift|ring|shardVolley|90', 'boss|drift|ring|quake|90', 'boss|drift|ring|pulse|90']));
      custom.mockClear();
      const pulsing = monolith({ active: 'pulse' });
      pass.advance(0.01, pulsing);
      pass.draw(pulsing, 1, LOOK);
      const near = drawOf('boss|drift|ring|pulse|90', custom)?.a ?? 0;
      pass.advance(0.2, pulsing);
      pass.draw(pulsing, 1, LOOK);
      const far = drawOf('boss|drift|ring|pulse|90', custom)?.a ?? 0;
      expect(near).toBeGreaterThan(0);
      expect(far).toBeGreaterThan(near);
    });
  });

  describe('the Hive Carrier', () => {
    const DOWN = Math.PI / 2;
    const carrier = (over: Partial<BossView> = {}): BossView => boss({ id: 'hiveCarrier', radius: 100, hp: 70, maxHp: 70, vulnerable: false, facing: DOWN, ...over });
    const keysOf = (spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }): unknown[] => spy.mock.calls.map(([key]) => key);
    /** The bearing a draw is turned to, from its transform, as |cos|: 0 straight down the field. */
    const turn = (d: Draw | undefined): number => Math.abs((d?.a ?? Number.NaN) / (d?.scale ?? Number.NaN));

    const HULL = 'boss|drift|hiveCarrier|hull|100';
    const SHUT = 'boss|drift|hiveCarrier|hullShut|100';
    const DOORS = ['boss|drift|hiveCarrier|door|1|100', 'boss|drift|hiveCarrier|door|-1|100'] as const;
    const BAY = 'boss|drift|hiveCarrier|bay|100';
    const area = (d: Draw | undefined): number => {
      const image = d?.image as { width: number; height: number } | undefined;
      return (image?.width ?? Number.NaN) * (image?.height ?? Number.NaN);
    };

    /** How the hull baked under `key` was last turned onto its own canvas, and every draw of that canvas onto the field. */
    const hullDraws = (key: string, spy: Parameters<typeof drawOf>[1]): { turned: Draw | undefined; shown: Draw[] } => {
      const index = spy.mock.calls.findIndex(([k]) => k === key);
      const source = (spy.mock.results[index]?.value as { canvas: unknown } | undefined)?.canvas;
      const turned = offscreen.findLast((d) => d.image === source);
      return { turned, shown: draws.filter((d) => turned !== undefined && d.image === turned.target) };
    };

    it('draws a shut hangar as one hull sprite with its doors folded in, turned the way it faces, and no bay light', () => {
      const custom = vi.spyOn(baker, 'custom');
      pass.draw(carrier(), 1, LOOK);
      const keys = keysOf(custom);
      expect(keys).toEqual([SHUT]);
      expect(keys).not.toContain('boss|drift|core|100');
      const { turned, shown } = hullDraws(SHUT, custom);
      expect(turn(turned)).toBeCloseTo(0, 9);
      expect(shown).toHaveLength(1);
      expect(turn(shown[0])).toBe(1);
      custom.mockClear();
      pass.draw(carrier({ facing: 0 }), 1, LOOK);
      expect(turn(hullDraws(SHUT, custom).turned)).toBeCloseTo(1, 9);
    });

    it('turns the hull again only once its angle has moved its corners half a device pixel, and the parts follow it', () => {
      const custom = vi.spyOn(baker, 'custom');
      const open = carrier({ vulnerable: true });
      pass.advance(0.15, open);
      pass.draw(open, 1, LOOK);
      const turns = offscreen.length;
      const nudged = carrier({ vulnerable: true, facing: DOWN + 0.001 });
      pass.draw(nudged, 1, LOOK);
      expect(offscreen).toHaveLength(turns);
      expect(turn(drawOf(DOORS[0], custom))).toBeCloseTo(Math.sin(0.25), 9);
      pass.draw(carrier({ vulnerable: true, facing: DOWN + 0.05 }), 1, LOOK);
      expect(offscreen.length).toBeGreaterThan(turns);
      expect(turn(drawOf(DOORS[0], custom))).toBeCloseTo(Math.sin(0.3), 9);
    });

    it('bakes the door leaves and the bay light on their own bounds, a fraction of the hull\'s, and draws them out at the hangar', () => {
      const custom = vi.spyOn(baker, 'custom');
      const open = carrier({ vulnerable: true });
      pass.advance(0.15, open);
      pass.draw(open, 1, LOOK);
      const { turned: hull, shown: [onField] } = hullDraws(HULL, custom);
      for (const key of DOORS) {
        const door = drawOf(key, custom);
        expect(area(door), key).toBeLessThan(area(hull) / 8);
        expect(Math.hypot((door?.e ?? 0) - (onField?.e ?? 0), (door?.f ?? 0) - (onField?.f ?? 0)), key).toBeGreaterThan(50);
      }
      expect(area(drawOf(BAY, custom))).toBeLessThan(area(hull) / 3);
      expect(keysOf(custom)).not.toContain(SHUT);
    });

    it('slides its doors apart over 0.3 s once its hangar opens, baring a glowing bay, and shut again after', () => {
      const custom = vi.spyOn(baker, 'custom');
      const open = carrier({ vulnerable: true });
      pass.advance(0.15, open);
      pass.draw(open, 1, LOOK);
      const half = turn(drawOf(DOORS[0], custom));
      const halfLit = drawOf(BAY, custom)?.alpha ?? 0;
      pass.advance(0.3, open);
      pass.draw(open, 1, LOOK);
      const wide = turn(drawOf(DOORS[0], custom));
      const wideLit = drawOf(BAY, custom)?.alpha ?? 0;
      expect(half).toBeCloseTo(Math.sin(0.25), 6);
      expect(wide).toBeCloseTo(Math.sin(0.5), 6);
      expect(turn(drawOf(DOORS[1], custom))).toBeCloseTo(Math.sin(0.5), 6);
      expect(halfLit).toBeGreaterThan(0);
      expect(wideLit).toBeGreaterThan(halfLit);
      const shut = carrier();
      pass.advance(0.3, shut);
      custom.mockClear();
      pass.draw(shut, 1, LOOK);
      expect(keysOf(custom)).toEqual([SHUT]);
    });

    it('keeps its doors shut outside the fight, and shuts them for a new fight', () => {
      const custom = vi.spyOn(baker, 'custom');
      pass.advance(1, carrier({ vulnerable: true, state: 'dying' }));
      pass.draw(carrier({ vulnerable: true, state: 'dying' }), 1, LOOK);
      expect(keysOf(custom)).not.toContain(BAY);
      pass.advance(1, carrier({ vulnerable: true }));
      pass.handle([{ type: 'bossIntro', id: 'hiveCarrier' }]);
      custom.mockClear();
      pass.draw(carrier({ vulnerable: true }), 1, LOOK);
      expect(keysOf(custom)).not.toContain(BAY);
      pass.advance(1, carrier({ vulnerable: true }));
      pass.reset();
      custom.mockClear();
      pass.draw(carrier({ vulnerable: true }), 1, LOOK);
      expect(keysOf(custom)).not.toContain(BAY);
    });

    it('holds the bay light steady under reduced motion', () => {
      const custom = vi.spyOn(baker, 'custom');
      const open = carrier({ vulnerable: true });
      const still = { ...LOOK, still: true };
      const alphas: number[] = [];
      pass.advance(0.5, open);
      for (let i = 0; i < 4; i++) {
        pass.advance(0.07, open);
        pass.draw(open, 1, still);
        alphas.push(drawOf(BAY, custom)?.alpha ?? 0);
      }
      expect(new Set(alphas).size).toBe(1);
      expect(alphas[0]).toBe(1);
    });

    it('rings its launch, broadside and retreat windups', () => {
      const custom = vi.spyOn(baker, 'custom');
      for (const windup of ['launch', 'broadside', 'retreat'] as const) pass.draw(carrier({ windup }), 1, LOOK);
      expect(keysOf(custom)).toEqual(expect.arrayContaining(['boss|drift|ring|launch|100', 'boss|drift|ring|broadside|100', 'boss|drift|ring|retreat|100']));
    });
  });

  it('forgets the last fight on reset', () => {
    pass.handle([{ type: 'bossHit', x: 640, y: 200, hp: 19 }]);
    pass.reset();
    expect(pass.flash).toBe(0);
  });
});
