import { describe, expect, it } from 'vitest';
import { BOLT, FOES, GUNSHIP, MINE } from '../../src/content/foes';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, PROJECTILE, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import type { Foe } from '../../src/sim/foes/foe';
import { FoeField, type FoeHooks } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { createShip, makeInvulnerable } from '../../src/sim/ship';
import { wrapDelta } from '../../src/sim/wrap';
import { ofType, stubArena, type StubArena } from '../helpers/bossArena';

const FIELD_43: Field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
const FIELD_169: Field = { width: 1280, height: 720 };
const FIELD_219: Field = { width: FIELD_HEIGHT * MAX_ASPECT, height: FIELD_HEIGHT };
const DT = STEP_SECONDS;

interface Rig {
  readonly arena: StubArena;
  readonly foes: FoeField;
  readonly bolts: Bolts;
  readonly killed: { x: number; y: number }[];
}

function rig(opts: { seed?: number; field?: Field; shipX?: number; shipY?: number } = {}): Rig {
  const { seed = 1, field = FIELD_169, shipX = field.width / 2, shipY = field.height / 2 } = opts;
  const ship = createShip(shipX, shipY);
  // Past its start-of-run invulnerability: these foes spare an invulnerable ship.
  ship.invulnerable = false;
  const arena = stubArena(ship, field);
  const killed: { x: number; y: number }[] = [];
  const hooks: FoeHooks = { score: (points) => points, killed: (x, y) => killed.push({ x, y }) };
  const bolts = new Bolts(arena);
  return { arena, foes: new FoeField(arena, createRng(seed), hooks, bolts), bolts, killed };
}

/** Steps the field `seconds` on, clearing each step's events first like a World; returns every event with its time. */
function run(r: Rig, seconds: number, each?: (t: number) => void): { t: number; event: Rig['arena']['events'][number] }[] {
  const log: { t: number; event: Rig['arena']['events'][number] }[] = [];
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    r.arena.events.length = 0;
    r.foes.step(DT);
    r.bolts.step(DT);
    for (const event of r.arena.events) log.push({ t: i * DT, event: { ...event } });
    each?.(i * DT);
    r.foes.sweep();
  }
  return log;
}

const only = (r: Rig): Foe => {
  const foe = r.foes.list[0];
  if (foe === undefined) throw new Error('a foe should have arrived');
  return foe;
};

const gap = (field: Field, a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(wrapDelta(a.x - b.x, field.width), wrapDelta(a.y - b.y, field.height));

describe('gunship', () => {
  it('arrives alone at an edge with 3 HP and radius 18, announced, outside the safe radius', () => {
    const r = rig({ shipX: 300, shipY: 300 });
    r.foes.spawn('gunship', 1, 1);
    const ship = only(r);
    expect(ship).toMatchObject({ kind: 'gunship', hp: 3, radius: FOES.gunship.radius });
    expect(ofType(r.arena.events, 'foeSpawned')).toHaveLength(1);
    expect(Math.hypot(ship.x - 300, ship.y - 300)).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
  });

  it('circles a still ship 240 to 300 units out once it has closed in, at 80 units a second, both ways round', () => {
    const turns = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const r = rig({ seed });
      r.foes.spawn('gunship', 1, 1);
      const foe = only(r);
      const centre = r.arena.ship;
      let swept = 0;
      let last = Math.atan2(foe.y - centre.y, foe.x - centre.x);
      run(r, 30, (t) => {
        expect(Math.hypot(foe.vx, foe.vy)).toBeCloseTo(FOES.gunship.speed, 9);
        const bearing = Math.atan2(foe.y - centre.y, foe.x - centre.x);
        if (t > 12) {
          const distance = Math.hypot(foe.x - centre.x, foe.y - centre.y);
          expect(distance, `seed ${String(seed)} at ${t.toFixed(2)} s`).toBeGreaterThanOrEqual(GUNSHIP.orbit[0]);
          expect(distance, `seed ${String(seed)} at ${t.toFixed(2)} s`).toBeLessThanOrEqual(GUNSHIP.orbit[1]);
          swept += Math.atan2(Math.sin(bearing - last), Math.cos(bearing - last));
        }
        last = bearing;
      });
      // It goes round, not back and forth: most of a turn over 18 s at 80 u/s on a 270-unit circle.
      expect(Math.abs(swept), `seed ${String(seed)}`).toBeGreaterThan(4);
      turns.add(Math.sign(swept));
    }
    expect(turns).toEqual(new Set([1, -1]));
  });

  it('keeps apart from the gunship beside it, across the wrap too', () => {
    const r = rig();
    r.foes.spawn('gunship', 1, 1);
    r.foes.spawn('gunship', 1, 1);
    const [a, b] = r.foes.list as [Foe, Foe];
    b.x = a.x;
    b.y = a.y + 10;
    b.rotation = a.rotation;
    b.orbit = a.orbit;
    run(r, 3);
    expect(gap(FIELD_169, a, b)).toBeGreaterThan(30);
  });

  it('winds up every 2.6 ± 0.4 s for 0.5 s, aiming where the ship is then, and fires one bolt there as the windup ends', () => {
    const r = rig();
    r.foes.spawn('gunship', 1, 1);
    const foe = only(r);
    const log = run(r, 40, (t) => {
      // The ship drifts, so every windup aims somewhere new.
      r.arena.ship.x = 640 + 200 * Math.sin(t / 3);
    });
    // A windup begun in the run's last half second has not fired yet.
    const windups = log.filter((l) => l.event.type === 'foeWindup' && l.t <= 40 - GUNSHIP.windup);
    const shots = log.filter((l) => l.event.type === 'boltFired');
    expect(windups.length).toBeGreaterThanOrEqual(12);
    expect(shots).toHaveLength(windups.length);
    for (let i = 1; i < windups.length; i++) {
      const between = (windups[i]?.t ?? 0) - (windups[i - 1]?.t ?? 0);
      expect(between).toBeGreaterThanOrEqual(GUNSHIP.cadence - GUNSHIP.cadenceJitter - 1e-9);
      expect(between).toBeLessThanOrEqual(GUNSHIP.cadence + GUNSHIP.cadenceJitter + 1e-9);
    }
    for (const [i, windup] of windups.entries()) {
      const shot = shots[i];
      if (windup.event.type !== 'foeWindup' || shot?.event.type !== 'boltFired') throw new Error('expected a windup and its shot');
      expect(windup.event.id).toBe(foe.id);
      expect(shot.t - windup.t).toBeCloseTo(GUNSHIP.windup, 9);
      expect(shot.event).toMatchObject({ source: 'gunship', owner: foe.id });
    }
  });

  it('fires at where the ship was as the windup began, not where it is now, at bolt speed', () => {
    const r = rig();
    r.foes.spawn('gunship', 1, 1);
    const foe = only(r);
    const aims: { x: number; y: number }[] = [];
    const log = run(r, 6, () => {
      if (aims.length === 0 && foe.charging) aims.push({ x: r.arena.ship.x, y: r.arena.ship.y });
      // The ship moves away the moment the gunship starts aiming.
      if (foe.charging) r.arena.ship.y = 100;
    });
    const shot = log.find((l) => l.event.type === 'boltFired')?.event;
    const [target] = aims;
    if (shot?.type !== 'boltFired' || target === undefined) throw new Error('the gunship should have fired');
    expect(shot.angle).toBeCloseTo(Math.atan2(target.y - shot.y, target.x - shot.x), 9);
    const bolt = r.bolts.list[0];
    expect(Math.hypot(bolt?.vx ?? 0, bolt?.vy ?? 0)).toBeCloseTo(BOLT.speed, 9);
    expect(bolt?.fromAttack).toBe(false);
  });

  it('shows its aim during the windup and has no bolt in flight until it ends: the windup is at least the minimum telegraph', () => {
    const r = rig();
    r.foes.spawn('gunship', 1, 1);
    const foe = only(r);
    let sawCharging = false;
    run(r, 4, () => {
      if (foe.charging) {
        sawCharging = true;
        expect(r.bolts.list).toHaveLength(0);
        expect(foe.aimX).toBe(r.arena.ship.x);
      }
    });
    expect(sawCharging).toBe(true);
    expect(GUNSHIP.windup).toBeGreaterThanOrEqual(0.35);
  });

  it('never winds up at an invulnerable ship, and holds its shot if the ship turns invulnerable mid-windup', () => {
    const idle = rig();
    idle.foes.spawn('gunship', 1, 1);
    makeInvulnerable(idle.arena.ship);
    idle.arena.ship.invulnerableFor = 1e9;
    expect(run(idle, 20).filter((l) => l.event.type === 'foeWindup' || l.event.type === 'boltFired')).toEqual([]);

    const mid = rig();
    mid.foes.spawn('gunship', 1, 1);
    const foe = only(mid);
    const log = run(mid, 6, () => {
      if (foe.charging && !mid.arena.ship.invulnerable) {
        makeInvulnerable(mid.arena.ship);
        mid.arena.ship.invulnerableFor = 1e9;
      }
    });
    expect(log.filter((l) => l.event.type === 'foeWindup')).toHaveLength(1);
    expect(log.filter((l) => l.event.type === 'boltFired')).toEqual([]);
  });

  it('waits a short random while for a ship it may not fire at, so gunships kept waiting do not all wind up together as it can be hurt again', () => {
    const r = rig();
    for (let i = 0; i < 4; i++) r.foes.spawn('gunship', 1, 1);
    makeInvulnerable(r.arena.ship);
    r.arena.ship.invulnerableFor = 1e9;
    const lapse = 8;
    const log = run(r, lapse + 2, (t) => {
      if (t >= lapse) r.arena.ship.invulnerable = false;
    });
    const windups = log.filter((l) => l.event.type === 'foeWindup').map((l) => l.t);
    expect(windups.every((t) => t > lapse)).toBe(true);
    const first = windups.slice(0, 4);
    expect(first).toHaveLength(4);
    // Each waits at most a second past the lapse, and they come at different times.
    for (const t of first) expect(t).toBeLessThanOrEqual(lapse + 1 + DT);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('fires only from inside the field, never from the wrap margin', () => {
    const r = rig();
    r.foes.spawn('gunship', 1, 1);
    const foe = only(r);
    const log = run(r, 30, () => {
      // Hold it out past the left edge, in the margin.
      foe.x = -20;
    });
    expect(log.filter((l) => l.event.type === 'foeWindup')).toEqual([]);
  });

  it('keeps at most 4 on the field: a spawn beyond them is dropped', () => {
    const r = rig();
    for (let i = 0; i < 6; i++) r.foes.spawn('gunship', 1, 1);
    expect(r.foes.list.filter((f) => f.kind === 'gunship')).toHaveLength(GUNSHIP.maxLive);
    expect(GUNSHIP.maxLive).toBe(4);
  });

  it('takes three hits, scoring 250 for the third, and drops its pickup roll there', () => {
    const r = rig();
    r.foes.spawn('gunship', 1, 1);
    const foe = only(r);
    r.foes.step(DT);
    r.arena.events.length = 0;
    r.foes.hit(foe.x, foe.y, PROJECTILE.radius);
    r.foes.hit(foe.x, foe.y, PROJECTILE.radius);
    expect(foe.hp).toBe(1);
    r.foes.hit(foe.x, foe.y, PROJECTILE.radius);
    expect(ofType(r.arena.events, 'foeDestroyed')).toEqual([{ type: 'foeDestroyed', id: foe.id, kind: 'gunship', x: foe.x, y: foe.y, points: 250 }]);
    expect(r.killed).toHaveLength(1);
  });

  it('needs the galaxy\'s bolts to fire, and says so', () => {
    const arena = stubArena({ ...createShip(640, 360), invulnerable: false }, FIELD_169);
    const foes = new FoeField(arena, createRng(1), { score: (b) => b, killed: () => undefined });
    foes.spawn('gunship', 1, 1);
    expect(() => {
      for (let i = 0; i < 1000; i++) foes.step(DT);
    }).toThrow(/bolts/);
  });
});

describe('mine', () => {
  const ARM_REACH = MINE.armRadius + PLAYER.radius;

  /** A rig with one mine, moved to (x, y) and held still. */
  function withMine(x: number, y: number, opts: Parameters<typeof rig>[0] = {}): Rig & { mine: Foe } {
    const r = rig(opts);
    r.foes.spawn('mine', 1, 1);
    const mine = only(r);
    mine.x = mine.px = x;
    mine.y = mine.py = y;
    mine.vx = mine.vy = 0;
    return { ...r, mine };
  }

  it('drifts in slowly with 1 HP and radius 12, in ones and twos', () => {
    const r = rig();
    r.foes.spawn('mine', 2, 1);
    expect(r.foes.list).toHaveLength(2);
    for (const mine of r.foes.list) {
      expect(mine).toMatchObject({ kind: 'mine', hp: 1, radius: FOES.mine.radius, charging: false });
      expect(Math.hypot(mine.vx, mine.vy)).toBeLessThanOrEqual(FOES.mine.speed * 1.2 + 1e-9);
    }
  });

  it('arms as the ship touches its arm ring, announced, and blasts 0.6 s later, striking a ship within 80 and destroying itself for 0 points', () => {
    const r = withMine(640, 360, { shipX: 640 + ARM_REACH + 1, shipY: 360 });
    expect(run(r, 1).filter((l) => l.event.type === 'mineArmed')).toEqual([]);
    r.arena.ship.x = 640 + ARM_REACH - 1;
    const log = run(r, 0.5);
    const armed = log.filter((l) => l.event.type === 'mineArmed');
    expect(armed.map((l) => l.event)).toEqual([{ type: 'mineArmed', id: r.mine.id, x: 640, y: 360 }]);
    expect(r.mine.charging).toBe(true);
    // The ship moves into the blast while the fuse burns: nothing strikes it before the blast.
    r.arena.ship.x = 640 + 50;
    expect(r.foes.strikes(r.arena.ship.x, r.arena.ship.y, PLAYER.radius)).toBe(false);
    const rest = run(r, 0.2, () => {
      if (r.arena.events.some((e) => e.type === 'mineBlast')) expect(r.foes.strikes(r.arena.ship.x, r.arena.ship.y, PLAYER.radius)).toBe(true);
    });
    const blast = rest.find((l) => l.event.type === 'mineBlast');
    expect(blast?.event).toEqual({ type: 'mineBlast', id: r.mine.id, x: 640, y: 360, radius: MINE.blastRadius });
    const armedAt = armed[0]?.t ?? 0;
    expect((blast?.t ?? 0) + 0.5 - armedAt).toBeCloseTo(MINE.fuse, 9);
    expect(rest.find((l) => l.event.type === 'foeDestroyed')?.event).toMatchObject({ id: r.mine.id, points: 0 });
    expect(r.foes.list).toEqual([]);
    expect(r.killed).toEqual([]);
  });

  it('spares a ship beyond 80 units of its blast, and only strikes on the blast\'s step', () => {
    const r = withMine(640, 360, { shipX: 640 + ARM_REACH - 1, shipY: 360 });
    let struck = false;
    run(r, 1, () => {
      r.arena.ship.x = 640 + MINE.blastRadius + PLAYER.radius + 1;
      struck ||= r.foes.strikes(r.arena.ship.x, r.arena.ship.y, PLAYER.radius);
    });
    expect(struck).toBe(false);
    expect(r.foes.list).toEqual([]);
    // The blast is spent: a later step strikes nothing.
    r.foes.step(DT);
    expect(r.foes.strikes(640, 360, PLAYER.radius)).toBe(false);
  });

  it('arms across the wrap, as everything else measures', () => {
    const r = withMine(5, 360, { shipX: FIELD_169.width - 10, shipY: 360 });
    expect(run(r, 0.1).filter((l) => l.event.type === 'mineArmed')).toHaveLength(1);
  });

  it('never arms against an invulnerable ship', () => {
    const r = withMine(640, 360, { shipX: 660, shipY: 360 });
    makeInvulnerable(r.arena.ship);
    r.arena.ship.invulnerableFor = 1e9;
    expect(run(r, 3).filter((l) => l.event.type === 'mineArmed' || l.event.type === 'mineBlast')).toEqual([]);
  });

  it('dies to one shot, armed or not, with no blast, scoring 150', () => {
    for (const armed of [false, true]) {
      const r = withMine(640, 360, { shipX: armed ? 700 : 1000, shipY: 360 });
      run(r, 0.1);
      expect(r.mine.charging).toBe(armed);
      r.arena.events.length = 0;
      r.foes.hit(640, 360, PROJECTILE.radius);
      r.foes.sweep();
      expect(ofType(r.arena.events, 'foeDestroyed')).toMatchObject([{ kind: 'mine', points: 150 }]);
      const after = run(r, 1);
      expect(after.filter((l) => l.event.type === 'mineBlast')).toEqual([]);
    }
  });

  describe.each([
    ['4:3', FIELD_43],
    ['21:9', FIELD_219],
  ])('spawn safety at %s', (_name, field) => {
    const ships: (readonly [number, number])[] = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) ships.push([-WRAP_MARGIN + (i / 12) * (field.width + 2 * WRAP_MARGIN), -WRAP_MARGIN + (j / 8) * (field.height + 2 * WRAP_MARGIN)]);

    it('puts every mine inside the field and at least the safe radius plus its arm radius from the ship, across the wrap', () => {
      let spawned = 0;
      for (const [x, y] of ships) {
        for (let seed = 1; seed <= 8; seed++) {
          const r = rig({ seed, field, shipX: x, shipY: y });
          r.foes.spawn('mine', 2, 1);
          for (const mine of r.foes.list) {
            spawned++;
            expect(gap(field, mine, { x, y }), `ship (${String(x)}, ${String(y)}) seed ${String(seed)}`).toBeGreaterThanOrEqual(ASTEROID.safeRadius + MINE.armRadius);
            expect(mine.x).toBeGreaterThanOrEqual(0);
            expect(mine.x).toBeLessThanOrEqual(field.width);
            expect(mine.y).toBeGreaterThanOrEqual(0);
            expect(mine.y).toBeLessThanOrEqual(field.height);
          }
        }
      }
      expect(spawned).toBe(ships.length * 8 * 2);
    });

    it('brings every gunship in outside the safe radius of the ship', () => {
      for (const [x, y] of ships) {
        for (let seed = 1; seed <= 8; seed++) {
          const r = rig({ seed, field, shipX: x, shipY: y });
          r.foes.spawn('gunship', 1, 1);
          const foe = only(r);
          expect(Math.hypot(foe.x - x, foe.y - y), `ship (${String(x)}, ${String(y)}) seed ${String(seed)}`).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
        }
      }
    });
  });
});
