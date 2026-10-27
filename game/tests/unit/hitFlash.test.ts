import { describe, expect, it } from 'vitest';
import { createHitFlash, HIT_FLASH_SECONDS, SQUASH_SCALE, SQUASH_SECONDS } from '../../src/render/hitFlash';
import type { SimEvent } from '../../src/sim/events';

const KEY = 'white|rock';
const destroyed = (id: number, points = 20): SimEvent => ({ type: 'asteroidDestroyed', id, x: 300, y: 200, size: 0, points });
const hit: SimEvent = { type: 'shipHit', x: 640, y: 360, livesLeft: 2 };
const FRAME = 1 / 60;

function make(whiteRock: (id: number) => string | undefined = () => KEY) {
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
      return KEY;
    });
    flash.handle([destroyed(7)]);
    expect(asked).toEqual([7]);
    expect(flash.rocks).toHaveLength(1);
    expect(flash.rocks[0]).toMatchObject({ key: KEY, x: 300, y: 200 });
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
    const flash = make((id) => (id === 3 ? undefined : KEY));
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

describe('createHitFlash: a foe', () => {
  const spawned = (id: number, kind: 'splitter' | 'drone' = 'drone'): SimEvent => ({ type: 'foeSpawned', id, kind, x: 100, y: 100 });
  const hurt = (id: number): SimEvent => ({ type: 'foeHit', id, x: 120, y: 90, hp: 1 });
  const slain = (id: number, kind: 'splitter' | 'drone' = 'drone', points = 100): SimEvent => ({ type: 'foeDestroyed', id, kind, x: 130, y: 80, points });

  it('flashes its kind where it was hit, for 60 ms, remembering the kind from its arrival', () => {
    const flash = make();
    flash.handle([spawned(4, 'splitter')]);
    flash.handle([hurt(4)]);
    expect(flash.foes).toEqual([{ kind: 'splitter', x: 120, y: 90, left: HIT_FLASH_SECONDS }]);
    run(flash, 0.05);
    expect(flash.foes).toHaveLength(1);
    run(flash, 0.02);
    expect(flash.foes).toHaveLength(0);
  });

  it('flashes a foe that was destroyed, by the kind the event carries, and forgets it', () => {
    const flash = make();
    flash.handle([spawned(4), slain(4)]);
    expect(flash.foes).toMatchObject([{ kind: 'drone', x: 130, y: 80 }]);
    // Its id is forgotten: a late hit on it has no kind to flash.
    flash.handle([hurt(4)]);
    expect(flash.foes).toHaveLength(1);
  });

  it('skips a foe the warp cleared or the ship rammed (0 points), a hit on one it never saw arrive, and the cap', () => {
    const flash = make();
    flash.handle([spawned(1), slain(1, 'drone', 0), hurt(2)]);
    expect(flash.foes).toHaveLength(0);
    for (let id = 10; id < 50; id++) flash.handle([spawned(id), slain(id)]);
    expect(flash.foes).toHaveLength(24);
  });

  it('keeps foe and rock flashes apart, and drops both on reset', () => {
    const flash = make();
    flash.handle([destroyed(1), spawned(2), hurt(2)]);
    expect(flash.rocks).toHaveLength(1);
    expect(flash.foes).toHaveLength(1);
    flash.reset();
    expect(flash.rocks).toHaveLength(0);
    expect(flash.foes).toHaveLength(0);
    flash.handle([hurt(2)]);
    expect(flash.foes).toHaveLength(0);
  });
});
