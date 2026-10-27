import { describe, expect, it } from 'vitest';
import { PICKUPS } from '../../src/content/pickups';
import type { PickupId } from '../../src/content/types';
import { PICKUP, PLAYER } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import { chooseKind, PickupField, type DropContext } from '../../src/sim/pickups/pickups';
import { createRng, type Rng } from '../../src/sim/rng';

const FIELD = { width: 1280, height: 720 };
const POOL: readonly PickupId[] = ['weaponCore', 'doubleShot', 'shield', 'rapidFire', 'spreadLaser'];
const DT = 1 / 120;
const PLAIN: DropContext = { lastLife: false, weaponTier: 0 };
const FAR = { x: -9999, y: -9999 };

/** An Rng that answers `next()` from a script, then 0.5 forever, so a test chooses each roll. */
function scripted(...values: number[]): Rng {
  const queue = [...values];
  const base = createRng(1);
  const next = (): number => queue.shift() ?? 0.5;
  return { ...base, next, chance: (p) => next() < p, pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T, range: (a, b) => a + next() * (b - a) };
}

function field(rng: Rng = createRng(1), pool: readonly PickupId[] = POOL, tier = 0): PickupField {
  return new PickupField(pool, tier, rng);
}

describe('chooseKind', () => {
  it('picks by weight across the pool, in pool order', () => {
    const total = POOL.reduce((sum, id) => sum + PICKUPS[id].weight, 0);
    let from = 0;
    for (const id of POOL) {
      const share = PICKUPS[id].weight / total;
      expect(chooseKind(POOL, scripted(from + share / 2), PLAIN)).toBe(id);
      from += share;
    }
  });

  it('never picks a kind outside the pool', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) expect(['weaponCore', 'doubleShot', 'shield']).toContain(chooseKind(['weaponCore', 'doubleShot', 'shield'], rng, PLAIN));
  });

  it('triples the Shield weight on the last life', () => {
    const count = (lastLife: boolean): number => {
      const rng = createRng(11);
      let shields = 0;
      for (let i = 0; i < 20_000; i++) if (chooseKind(POOL, rng, { ...PLAIN, lastLife }) === 'shield') shields++;
      return shields / 20_000;
    };
    const total = POOL.reduce((sum, id) => sum + PICKUPS[id].weight, 0);
    const shield = PICKUPS.shield.weight;
    expect(count(false)).toBeCloseTo(shield / total, 1);
    expect(count(true)).toBeCloseTo((3 * shield) / (total + 2 * shield), 1);
    expect(count(true)).toBeGreaterThan(2 * count(false));
  });
});

describe('chooseKind at the top weapon tier', () => {
  const TOP: DropContext = { lastLife: false, weaponTier: 3 };

  it('never picks the weapon core, even with a roll that lands on it', () => {
    for (const value of [0, 0.01, 0.1, 0.2, 0.5, 0.99]) expect(chooseKind(POOL, scripted(value), TOP)).not.toBe('weaponCore');
    expect(chooseKind(POOL, scripted(0), PLAIN)).toBe('weaponCore');
  });

  it('can pick it at any lower tier', () => {
    for (const weaponTier of [0, 1, 2] as const) expect(chooseKind(POOL, scripted(0), { lastLife: false, weaponTier })).toBe('weaponCore');
  });

  it('reduces the D1 pool to Double Shot and Shield, splitting the roll by their weights', () => {
    const d1 = POOL.slice(0, 3);
    const total = PICKUPS.doubleShot.weight + PICKUPS.shield.weight;
    expect(chooseKind(d1, scripted(0.01), TOP)).toBe('doubleShot');
    expect(chooseKind(d1, scripted(PICKUPS.doubleShot.weight / total - 0.01), TOP)).toBe('doubleShot');
    expect(chooseKind(d1, scripted(PICKUPS.doubleShot.weight / total + 0.01), TOP)).toBe('shield');
  });

  it('still triples the Shield on the last life', () => {
    const d1 = POOL.slice(0, 3);
    const total = PICKUPS.doubleShot.weight + 3 * PICKUPS.shield.weight;
    expect(chooseKind(d1, scripted(PICKUPS.doubleShot.weight / total + 0.01), { ...TOP, lastLife: true })).toBe('shield');
    expect(chooseKind(d1, scripted(PICKUPS.doubleShot.weight / total - 0.01), { ...TOP, lastLife: true })).toBe('doubleShot');
  });

  it('draws exactly once whatever the tier, so the stream does not shift', () => {
    for (const weaponTier of [0, 1, 2, 3] as const) {
      const rng = createRng(4);
      let draws = 0;
      const counting: Rng = { ...rng, next: () => (draws++, rng.next()) };
      chooseKind(POOL, counting, { lastLife: false, weaponTier });
      expect(draws).toBe(1);
    }
  });

  it('gives nothing when nothing in the pool can drop, still after its one draw', () => {
    expect(chooseKind([], scripted(0.5), PLAIN)).toBeNull();
    expect(chooseKind(['weaponCore'], scripted(0.5), TOP)).toBeNull();
  });

  it('drops nothing from an empty pool, with the field left alone', () => {
    const f = field(scripted(0, 0.1, 0), []);
    const events: SimEvent[] = [];
    f.roll(10, 10, PLAIN, events);
    expect(f.list).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('PickupField drops', () => {
  it('drops at the kill with probability dropChance(tier): 6% at tier 0', () => {
    const events: SimEvent[] = [];
    const f = field(scripted(0.059, 0.1, 0.25), POOL, 0);
    f.roll(300, 200, PLAIN, events);
    expect(f.list).toHaveLength(1);
    expect(events).toEqual([{ type: 'pickupDropped', id: 1, kind: 'weaponCore', x: 300, y: 200 }]);
    const miss = field(scripted(0.061), POOL, 0);
    const none: SimEvent[] = [];
    miss.roll(300, 200, PLAIN, none);
    expect(miss.list).toEqual([]);
    expect(none).toEqual([]);
  });

  it('uses the tier: 11% at tier 5, still capped at 12%', () => {
    const roll = (tier: number, value: number): number => {
      const f = field(scripted(value, 0.1, 0.1), POOL, tier);
      f.roll(0, 0, PLAIN, []);
      return f.list.length;
    };
    expect(roll(5, 0.109)).toBe(1);
    expect(roll(5, 0.111)).toBe(0);
    expect(roll(50, 0.119)).toBe(1);
    expect(roll(50, 0.121)).toBe(0);
  });

  it('drops about dropChance of kills over many rolls', () => {
    const f = field(createRng(3), POOL, 0);
    let drops = 0;
    for (let i = 0; i < 20_000; i++) {
      f.roll(0, 0, PLAIN, []);
      drops += f.list.length;
      f.list.length = 0;
    }
    expect(drops / 20_000).toBeCloseTo(0.06, 1);
  });

  it('holds at most 2 on the field, and a full field draws nothing from the stream', () => {
    const base = createRng(9);
    let draws = 0;
    const next = (): number => {
      draws++;
      return base.next();
    };
    const rng: Rng = { ...base, next, chance: (p) => next() < p, range: (a, b) => a + next() * (b - a) };
    const f = field(rng, POOL, 5);
    const events: SimEvent[] = [];
    while (f.list.length < PICKUP.maxOnField) f.roll(100, 100, PLAIN, events);
    const drawn = draws;
    for (let i = 0; i < 100; i++) f.roll(100, 100, PLAIN, events);
    expect(f.list).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect(draws).toBe(drawn);
  });

  it('gives each pickup its own id, a 20 unit/s drift and 8 s to live', () => {
    const f = field(scripted(0, 0.1, 0, 0, 0.1, 0.5), POOL, 0);
    f.roll(10, 20, PLAIN, []);
    f.roll(30, 40, PLAIN, []);
    const [a, b] = f.list;
    expect([a?.id, b?.id]).toEqual([1, 2]);
    expect(Math.hypot(a?.vx ?? 0, a?.vy ?? 0)).toBeCloseTo(PICKUP.drift, 9);
    expect(a?.expiresIn).toBe(PICKUP.lifespan);
    expect([a?.x, a?.y, a?.px, a?.py]).toEqual([10, 20, 10, 20]);
  });
});

describe('PickupField stepping', () => {
  function dropped(): { f: PickupField; id: number } {
    const f = field(scripted(0, 0.1, 0), POOL, 0);
    f.roll(640, 360, PLAIN, []);
    return { f, id: f.list[0]?.id ?? 0 };
  }

  it('drifts at 20 units per second, remembering where it was', () => {
    const { f } = dropped();
    const p = f.list[0];
    const [x, y] = [p?.x ?? 0, p?.y ?? 0];
    f.step(0.5, FIELD, FAR, () => undefined, []);
    expect(Math.hypot((p?.x ?? 0) - x, (p?.y ?? 0) - y)).toBeCloseTo(10, 9);
    expect([p?.px, p?.py]).toEqual([x, y]);
  });

  it('wraps at the edge of the field like a rock', () => {
    const f = field(scripted(0, 0.1, 0), POOL, 0);
    f.roll(FIELD.width + 49, 360, PLAIN, []);
    f.step(0.5, FIELD, FAR, () => undefined, []);
    expect(f.list[0]?.x).toBeLessThan(0);
  });

  it('is collected by a ship within 14 + the ship radius, reporting once and handing the kind on', () => {
    const { f, id } = dropped();
    const p = f.list[0];
    const got: PickupId[] = [];
    const events: SimEvent[] = [];
    f.step(DT, FIELD, { x: (p?.x ?? 0) + PICKUP.radius + PLAYER.radius - 0.5, y: p?.y ?? 0 }, (k) => got.push(k), events);
    expect(got).toEqual(['weaponCore']);
    expect(events).toEqual([{ type: 'pickupCollected', id, kind: 'weaponCore' }]);
    expect(f.list).toEqual([]);
  });

  it('is missed by a ship just outside that', () => {
    const { f } = dropped();
    const p = f.list[0];
    const events: SimEvent[] = [];
    f.step(DT, FIELD, { x: (p?.x ?? 0) + PICKUP.radius + PLAYER.radius + 0.5, y: p?.y ?? 0 }, () => {
      throw new Error('collected');
    }, events);
    expect(events).toEqual([]);
    expect(f.list).toHaveLength(1);
  });

  it('expires after 8 s with one pickupExpired, blinking only in the last 2 s', () => {
    const { f, id } = dropped();
    const p = f.list[0];
    const events: SimEvent[] = [];
    for (let t = 0; t < 5.9; t += DT) f.step(DT, FIELD, FAR, () => undefined, events);
    expect(p?.expiresIn).toBeGreaterThan(PICKUP.blinkSeconds);
    for (let t = 5.9; t < 6.1; t += DT) f.step(DT, FIELD, FAR, () => undefined, events);
    expect(p?.expiresIn).toBeLessThan(PICKUP.blinkSeconds);
    expect(events).toEqual([]);
    for (let t = 6.1; t < 8.1; t += DT) f.step(DT, FIELD, FAR, () => undefined, events);
    expect(events).toEqual([{ type: 'pickupExpired', id }]);
    expect(f.list).toEqual([]);
  });

  it('frees a slot when one expires or is collected, so another can drop', () => {
    const f = field(scripted(0, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0), POOL, 0);
    f.roll(100, 100, PLAIN, []);
    f.roll(900, 500, PLAIN, []);
    f.roll(500, 500, PLAIN, []);
    expect(f.list).toHaveLength(2);
    f.step(DT, FIELD, { x: 100, y: 100 }, () => undefined, []);
    expect(f.list).toHaveLength(1);
    f.roll(500, 500, PLAIN, []);
    expect(f.list).toHaveLength(2);
  });
});

describe('PickupField resize', () => {
  it('keeps its fraction of the wrap band, like every entity', () => {
    const f = field(scripted(0, 0.1, 0), POOL, 0);
    f.roll(640, 360, PLAIN, []);
    f.resize(FIELD, { width: 2560, height: 1440 });
    expect([f.list[0]?.x, f.list[0]?.y]).toEqual([1280, 720]);
    expect([f.list[0]?.px, f.list[0]?.py]).toEqual([1280, 720]);
  });
});
