import { describe, expect, it } from 'vitest';
import { createHitFlash, HIT_FLASH_SECONDS, SQUASH_SCALE, SQUASH_SECONDS } from '../../src/render/hitFlash';
import type { Sprite } from '../../src/render/sprites';
import type { SimEvent } from '../../src/sim/events';

const SPRITE = { canvas: {}, halfW: 10, halfH: 10 } as unknown as Sprite;
const destroyed = (id: number, points = 20): SimEvent => ({ type: 'asteroidDestroyed', id, x: 300, y: 200, size: 0, points });
const hit: SimEvent = { type: 'shipHit', x: 640, y: 360, livesLeft: 2 };
const FRAME = 1 / 60;

function make(whiteRock: (id: number) => Sprite | undefined = () => SPRITE) {
  return createHitFlash({ whiteRock });
}

/** Steps `flash` for `seconds` in 60 Hz frames. */
function run(flash: ReturnType<typeof make>, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) flash.step(FRAME);
}

describe('createHitFlash: a destroyed rock', () => {
  it('flashes its white sprite where it broke, for 60 ms', () => {
    const asked: number[] = [];
    const flash = make((id) => {
      asked.push(id);
      return SPRITE;
    });
    flash.handle([destroyed(7)]);
    expect(asked).toEqual([7]);
    expect(flash.rocks).toHaveLength(1);
    expect(flash.rocks[0]).toMatchObject({ sprite: SPRITE, x: 300, y: 200 });
    run(flash, 0.05);
    expect(flash.rocks).toHaveLength(1);
    run(flash, 0.02);
    expect(flash.rocks).toHaveLength(0);
    expect(HIT_FLASH_SECONDS).toBe(0.06);
  });

  it('counts down how much of the flash is left', () => {
    const flash = make();
    flash.handle([destroyed(7)]);
    expect(flash.rocks[0]?.left).toBeCloseTo(HIT_FLASH_SECONDS);
    flash.step(HIT_FLASH_SECONDS / 2);
    expect(flash.rocks[0]?.left).toBeCloseTo(HIT_FLASH_SECONDS / 2);
  });

  it('keeps one flash per rock, each on its own clock', () => {
    const flash = make();
    flash.handle([destroyed(1)]);
    run(flash, 0.04);
    flash.handle([destroyed(2)]);
    run(flash, 0.04);
    expect(flash.rocks).toHaveLength(1);
    run(flash, 0.04);
    expect(flash.rocks).toHaveLength(0);
  });

  it('skips a rock the warp cleared, one never drawn, and every other event', () => {
    const flash = make((id) => (id === 3 ? undefined : SPRITE));
    flash.handle([destroyed(1, 0), destroyed(3), { type: 'shot', x: 0, y: 0 }, { type: 'asteroidLeft', id: 4 }, { type: 'bossHit', x: 0, y: 0, hp: 5 }]);
    expect(flash.rocks).toHaveLength(0);
  });

  it('forgets every flash on reset', () => {
    const flash = make();
    flash.handle([destroyed(1), hit]);
    flash.reset();
    expect(flash.rocks).toHaveLength(0);
    expect(flash.shipScale).toBe(1);
  });
});

describe('createHitFlash: the ship squash', () => {
  it('rests at full size', () => {
    expect(make().shipScale).toBe(1);
  });

  it('drops to 0.9 on a hit, eases back over 80 ms, and rests', () => {
    const flash = make();
    flash.handle([hit]);
    expect(flash.shipScale).toBe(SQUASH_SCALE);
    expect(SQUASH_SCALE).toBe(0.9);
    flash.step(SQUASH_SECONDS / 2);
    expect(flash.shipScale).toBeCloseTo(0.95);
    run(flash, 0.04);
    expect(flash.shipScale).toBe(1);
    expect(SQUASH_SECONDS).toBe(0.08);
  });

  it('never leaves the 0.9 to 1 range, and eases back without going the other way', () => {
    const flash = make();
    flash.handle([hit]);
    let last = flash.shipScale;
    for (let i = 0; i < 8; i++) {
      flash.step(FRAME);
      expect(flash.shipScale).toBeGreaterThanOrEqual(last);
      expect(flash.shipScale).toBeLessThanOrEqual(1);
      last = flash.shipScale;
    }
  });

  it('starts over on a second hit', () => {
    const flash = make();
    flash.handle([hit]);
    run(flash, 0.06);
    flash.handle([hit]);
    expect(flash.shipScale).toBe(SQUASH_SCALE);
  });
});
