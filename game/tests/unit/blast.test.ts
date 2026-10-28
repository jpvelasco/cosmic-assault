import { describe, expect, it, vi } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import type { BlastKind } from '../../src/content/pickups';
import type { GalaxyDef } from '../../src/content/types';
import type { AsteroidSize } from '../../src/sim/asteroid';
import { ASTEROID, BLAST, PICKUP, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { comboMultiplier } from '../../src/sim/scoring';
import { World } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';
import { placeFoe } from '../helpers/foeRig';

const FIELD = { width: 1280, height: 720 };
const CENTRE = { x: 640, y: 360, angle: -Math.PI / 2 };
const calm = (galaxy: GalaxyDef = galaxyById('5-2')): GalaxyDef => ({ ...galaxy, kinds: MUTED_KINDS, events: [] });
const still = (x: number, y: number, size: AsteroidSize) => ({ x, y, size, angle: 0, speedMultiplier: 0 });

function world(rocks: ReturnType<typeof still>[] = [], ship: { x: number; y: number; angle: number } = CENTRE): World {
  return new World({ seed: 1, field: FIELD, rules: { kind: 'galaxy', galaxy: calm(), mode: 'free' }, initialShip: ship, initialAsteroids: rocks });
}

function run(w: World) {
  const r = w['run'];
  if (r === null) throw new Error('not a galaxy run');
  return r;
}

/** Lays a pickup of `kind` on the ship and takes the step that collects it; returns that step's events. */
function collectAtShip(w: World, kind: BlastKind): readonly SimEvent[] {
  const field = run(w)['pickupField'];
  const { x, y } = w.ship;
  field.list.push({ id: 99, kind, x, y, px: x, py: y, vx: 0, vy: 0, expiresIn: PICKUP.lifespan });
  return w.step(STEP_SECONDS, NO_CONTROLS).map((e) => ({ ...e }));
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) => events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** A rock of `size` whose edge sits `gap` units outside (positive) or inside (negative) a blast of `radius` at the centre. */
const atEdge = (radius: number, size: AsteroidSize, gap: number, side = 1) => still(640 + side * (radius + ASTEROID.radii[size] + gap), 360, size);

describe('a Field Bomb', () => {
  it('goes off at the ship as it is collected, reaching 220 units', () => {
    const w = world();
    const events = collectAtShip(w, 'fieldBomb');
    expect(ofType(events, 'blast')).toEqual([{ type: 'blast', kind: 'fieldBomb', x: w.ship.x, y: w.ship.y, radius: 220 }]);
    expect(BLAST.fieldBomb.radius).toBe(220);
    expect(w.weaponTier).toBe(0);
  });

  it('destroys every rock it reaches whole, and leaves the ones just out of reach', () => {
    const inside = [atEdge(220, 0, -1), atEdge(220, 1, -1, -1), still(640, 300, 2), still(700, 400, 3)];
    const outside = [atEdge(220, 2, 1), still(640, 360 + 220 + 15 + 1, 3)];
    const w = world([...inside, ...outside]);
    const events = collectAtShip(w, 'fieldBomb');
    expect(ofType(events, 'asteroidDestroyed')).toHaveLength(inside.length);
    // Whole: nothing it destroys splits.
    expect(w.asteroids.map((a) => [a.x, a.y])).toEqual(outside.map((a) => [a.x, a.y]));
  });

  it('scores each kill through the combo, which it chains', () => {
    const rocks = Array.from({ length: 6 }, (_, i) => still(600 + i * 15, 300, 3));
    const w = world(rocks);
    const events = collectAtShip(w, 'fieldBomb');
    const points = ofType(events, 'asteroidDestroyed').map((e) => e.points);
    expect(points).toEqual(rocks.map((_, i) => ASTEROID.scores[3] * comboMultiplier(i + 1)));
    expect(w.score).toBe(points.reduce((a, b) => a + b, 0));
    expect(w.combo).toBe(6);
  });

  it('drops no pickup from anything it kills, and splits no rock', () => {
    const w = world(Array.from({ length: 30 }, (_, i) => still(500 + (i % 10) * 25, 330 + Math.floor(i / 10) * 30, 1)));
    const roll = vi.spyOn(run(w)['pickupField'], 'roll');
    const killed = vi.spyOn(run(w), 'rockKilled');
    const events = collectAtShip(w, 'fieldBomb');
    expect(ofType(events, 'asteroidDestroyed')).toHaveLength(30);
    expect(roll).not.toHaveBeenCalled();
    expect(killed).not.toHaveBeenCalled();
    expect(ofType(events, 'pickupDropped')).toEqual([]);
    expect(w.asteroids).toEqual([]);
  });

  it('destroys the foes it reaches for score, leaving no fragments and dropping nothing, and spares the rest', () => {
    const w = world();
    const foes = run(w)['foes'];
    const roll = vi.spyOn(run(w)['pickupField'], 'roll');
    for (const x of [700, 640 + 220 + 30 - 1, 640 + 220 + 30 + 1]) placeFoe(foes, 'splitter', x, 360);
    const events = collectAtShip(w, 'fieldBomb');
    const destroyed = ofType(events, 'foeDestroyed');
    expect(destroyed.map((e) => e.x)).toEqual([700, 640 + 220 + 30 - 1]);
    expect(destroyed.every((e) => e.points > 0)).toBe(true);
    expect(w.foes.map((f) => f.x)).toEqual([640 + 220 + 30 + 1]);
    expect(w.asteroids).toEqual([]);
    expect(roll).not.toHaveBeenCalled();
  });
});

describe('a blast across the wrap', () => {
  it('reaches a rock and a foe just across the field\'s edges from a ship beside them, as the wrap measures them', () => {
    // The ship sits 20 in from the right edge; the rock 40 past the left edge is 80 away across the wrap band.
    const w = world([still(-40, 360, 3), still(640, 360, 3)], { x: 1260, y: 360, angle: 0 });
    const foes = run(w)['foes'];
    placeFoe(foes, 'drone', 1260, -30);
    const events = collectAtShip(w, 'fieldBomb');
    expect(ofType(events, 'asteroidDestroyed').map((e) => e.x)).toEqual([-40]);
    expect(w.asteroids.map((a) => a.x)).toEqual([640]);
    expect(w.foes).toHaveLength(1);
    // 20 above the bottom edge, the foe 30 past the top edge is 90 away.
    w['shipState'].y = 700;
    collectAtShip(w, 'fieldBomb');
    expect(w.foes).toEqual([]);
  });
});

describe('a Nova', () => {
  it('reaches 520 units: rocks a Field Bomb would leave', () => {
    const far = [atEdge(220, 3, 10), atEdge(520, 3, -1, -1)];
    const bomb = world(far);
    collectAtShip(bomb, 'fieldBomb');
    expect(bomb.asteroids).toHaveLength(2);
    const nova = world([...far, atEdge(520, 3, 1)]);
    const events = collectAtShip(nova, 'nova');
    expect(ofType(events, 'blast')).toEqual([{ type: 'blast', kind: 'nova', x: 640, y: 360, radius: 520 }]);
    expect(nova.asteroids).toHaveLength(1);
    expect(BLAST.nova.radius).toBe(520);
  });
});
