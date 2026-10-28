import { describe, expect, it } from 'vitest';
import { FOES } from '../../src/content/foes';
import { BLACK_HOLE, HAZARD_RULES, MAX_SHIP_PULL, WARP_RIFT } from '../../src/content/hazards';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyEvent } from '../../src/content/types';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { Asteroid } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import type { Bolt } from '../../src/sim/foes/bolts';
import { Bolts } from '../../src/sim/foes/bolts';
import type { Foe } from '../../src/sim/foes/foe';
import { BlackHole } from '../../src/sim/hazards/blackHole';
import { holeAcceleration, holeShare } from '../../src/sim/hazards/pull';
import { zoneClearance } from '../../src/sim/hazards/dangerZone';
import type { HazardState } from '../../src/sim/hazards/hazard';
import { HazardField, hazardStreamName } from '../../src/sim/hazards/hazardField';
import { shipPullAt, type ShipPull } from '../../src/sim/hazards/shipPull';
import { respawnBand, RESPAWN_MARGIN } from '../../src/sim/respawn';
import { createRng } from '../../src/sim/rng';
import { wrappedDistance } from '../../src/sim/wrap';
import { foeAt, hazardFoes } from '../helpers/foeAt';
import { clearTime, CONTACT, flyOut, shipAt } from '../helpers/holeEscape';
import { foeRig, placeFoe } from '../helpers/foeRig';

const FIELD: Field = { width: 1280, height: FIELD_HEIGHT };
const DT = STEP_SECONDS;
const CENTRE = { x: FIELD.width / 2, y: FIELD.height / 2 };
const HORIZON = BLACK_HOLE.horizon;
const START_AT = 5;
const LENGTH = 75;

const hole = (at = START_AT, intensity: GalaxyEvent['intensity'] = 1): GalaxyEvent => ({ at, type: 'blackHole', intensity });

/** A HazardField of one black hole starting at `START_AT`, stepped to `elapsed`. */
function holeField(elapsed: number, intensity: GalaxyEvent['intensity'] = 1, out: SimEvent[] = []): HazardField {
  let last = 0;
  const field = new HazardField([hole(START_AT, intensity)], () => createRng(1), () => ++last);
  field.step(elapsed, FIELD, out);
  return field;
}

function rockAt(id: number, x: number, y: number, radius = ASTEROID.radii[2] as number): Asteroid {
  return { id, x, y, px: x, py: y, vx: 0, vy: 0, radius, size: 2, rotation: 0, protation: 0, spin: 0, transient: false } as unknown as Asteroid;
}

/** Bolts in a pool of its own, whose events go to `events`. */
function boltsFor(events: SimEvent[]): Bolts {
  let id = 0;
  return new Bolts({ events, field: () => FIELD, nextId: () => ++id });
}

describe('the black hole\'s pull', () => {
  it('pulls at min(100, 9000 · intensity / max(r, 80)), so a single hole is 100 units/s² from 90 out', () => {
    expect(BLACK_HOLE).toMatchObject({ horizon: 32, strength: 9000, maxAccel: 100, minRadius: 80 });
    expect(holeAcceleration(90, 1)).toBe(100);
    expect(holeAcceleration(180, 1)).toBe(50);
    expect(holeAcceleration(180, 2)).toBe(100);
    expect(holeAcceleration(300, 3)).toBeCloseTo(90, 9);
    expect(holeAcceleration(0, 3)).toBe(100);
  });

  it('gives a velocity change of the acceleration times dt, inward, and nothing at the centre itself', () => {
    expect(holeShare(180, 1, DT) * 180).toBeCloseTo(50 * DT, 12);
    expect(holeShare(0, 3, DT)).toBe(0);
  });

  it('sums into the ship\'s pull through shipPullAt, capped at MAX_SHIP_PULL with every other hazard', () => {
    const states: HazardState[] = [
      { id: 1, type: 'blackHole', stage: 'active', x: CENTRE.x, y: CENTRE.y, intensity: 1, remaining: 9 },
      { id: 2, type: 'repulsionField', stage: 'active', x: CENTRE.x + 300, y: CENTRE.y, intensity: 3, remaining: 9 },
    ];
    const out: ShipPull = { x: 0, y: 0 };
    shipPullAt(states.slice(0, 1), CENTRE.x + 100, CENTRE.y, 1, out);
    expect(out.x).toBeCloseTo(-90, 9);
    expect(out.y).toBeCloseTo(0, 9);
    // The repulsion field beyond the ship pushes it toward the hole, and the sum is capped.
    shipPullAt(states, CENTRE.x + 100, CENTRE.y, 1, out);
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(MAX_SHIP_PULL + 1e-9);
    expect(out.x).toBeLessThan(0);
  });

  it('pulls a rock inward, speeding it no further than the hole\'s rock cap', () => {
    const rock = rockAt(3, CENTRE.x + 200, CENTRE.y);
    const field = holeField(START_AT + 1);
    field.move(DT, shipAt(60, 60), [rock], hazardFoes(), []);
    expect(rock.vx).toBeLessThan(0);
    expect(Math.hypot(rock.vx, rock.vy)).toBeLessThanOrEqual(BLACK_HOLE.rockSpeedCap);
  });

  it('pulls a foe that is pulled, and not one that steers itself', () => {
    const pulled = foeAt('splitter', CENTRE.x + 200, CENTRE.y, { id: 4 });
    const steering = foeAt('phaser', CENTRE.x - 200, CENTRE.y, { id: 5 });
    holeField(START_AT + 1).move(DT, shipAt(60, 60), [], hazardFoes(pulled, steering), []);
    expect(pulled.vx).toBeLessThan(0);
    expect(steering.vx).toBe(0);
  });
});

/** A reaction a player takes to a warning, in seconds, after which the ship must already be turning for the way out. */
const REACTION_SECONDS = 1;

const FIELDS: readonly Field[] = [MIN_ASPECT, MAX_ASPECT].map((aspect) => ({ width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT }));

describe('the black hole\'s escape', () => {
  it('lets a ship at rest, facing the hole, escape from every spot at or beyond its warning ring, at every intensity, on 4:3 and 21:9 fields', () => {
    const failures: string[] = [];
    for (const field of FIELDS)
      for (const intensity of [1, 2, 3] as const)
        for (let x = 20; x < field.width; x += 40)
          for (let y = 20; y < field.height; y += 40) {
            if (Math.hypot(x - field.width / 2, y - field.height / 2) < BLACK_HOLE.warnRadius) continue;
            const run = flyOut({ x, y }, intensity, field);
            if (run.contact || run.escapedAt === null) failures.push(`${String(field.width)}×${String(field.height)} i${String(intensity)} at ${String(x)},${String(y)}`);
          }
    expect(failures).toEqual([]);
  }, 60_000);

  it('gives a ship inside its warning ring time to fly out of it, with a reaction to spare, from any spot and any way it faces', () => {
    const field = FIELDS[0] as Field;
    let worst = 0;
    for (const r of [5, 25, 50, 70])
      for (let h = 0; h < 8; h++) {
        const angle = (h * Math.PI) / 4;
        worst = Math.max(worst, clearTime(field.width / 2 + r * Math.cos(angle), field.height / 2 + r * Math.sin(angle), BLACK_HOLE.warnRadius, field));
      }
    expect(worst + REACTION_SECONDS).toBeLessThanOrEqual(HAZARD_RULES.blackHole.telegraph);
  }, 60_000);

  it('still lets a ship escape in the active phase from 40 units beyond the contact, under the strongest other pull that can coexist', () => {
    const failures: string[] = [];
    for (const field of FIELDS)
      for (const intensity of [1, 2, 3] as const)
        for (let x = 20; x < field.width; x += 40)
          for (let y = 20; y < field.height; y += 40) {
            if (Math.hypot(x - field.width / 2, y - field.height / 2) < CONTACT + 40) continue;
            const run = flyOut({ x, y }, intensity, field, { adversary: true });
            if (run.contact || run.escapedAt === null) failures.push(`${String(field.width)}×${String(field.height)} i${String(intensity)} at ${String(x)},${String(y)}`);
          }
    expect(failures).toEqual([]);
  }, 60_000);

  it('does hold the contact edge to its pull: a ship at the contact edge, facing in with the same pull, is lost', () => {
    const run = flyOut({ x: CENTRE.x + CONTACT + 2, y: CENTRE.y }, 1, FIELD);
    expect(run.contact).toBe(true);
  });
});

describe('swallowing', () => {
  it('takes a rock inside the horizon for 0 points, with no drop: asteroidLeft, not asteroidDestroyed', () => {
    const out: SimEvent[] = [];
    const inside = rockAt(10, CENTRE.x + 20, CENTRE.y, 15);
    const outside = rockAt(11, CENTRE.x + 200, CENTRE.y, 15);
    const rocks = [inside, outside];
    holeField(START_AT + 1).move(DT, shipAt(60, 60), rocks, hazardFoes(), out);
    expect(rocks).toEqual([outside]);
    expect(out).toContainEqual({ type: 'asteroidLeft', id: 10 });
    expect(out.some((e) => e.type === 'asteroidDestroyed')).toBe(false);
  });

  it('destroys a foe inside the horizon through the foe field for 0 points, leaving nothing behind: foeDestroyed at 0, and its hp at 0', () => {
    const { foes, arena } = foeRig({ field: FIELD });
    const inside = placeFoe(foes, 'splitter', CENTRE.x, CENTRE.y + 10);
    const outside = placeFoe(foes, 'drone', CENTRE.x + 200, CENTRE.y);
    arena.events.length = 0;
    holeField(START_AT + 1).move(DT, shipAt(60, 60), [], foes, arena.events);
    expect(inside.hp).toBe(0);
    expect(outside.hp).toBeGreaterThan(0);
    // A splitter broken by a shot leaves fragments; one the horizon takes leaves none.
    expect(arena.events).toEqual([{ type: 'foeDestroyed', id: inside.id, kind: 'splitter', x: inside.x, y: inside.y, points: 0 }]);
  });

  it('clears a bolt inside the horizon, silently, and leaves the bolts outside it flying', () => {
    const out: SimEvent[] = [];
    const bolts = boltsFor(out);
    bolts.fire(CENTRE.x + 20, CENTRE.y, 0, 230, 'drone');
    bolts.fire(CENTRE.x + 200, CENTRE.y, 0, 230, 'drone');
    holeField(START_AT + 1).move(DT, shipAt(60, 60), [], hazardFoes(), out, bolts);
    expect(bolts.list.map((b: Readonly<Bolt>) => b.x)).toEqual([CENTRE.x + 200]);
  });

  it('spends a player shot that reaches the horizon, and leaves one outside it', () => {
    const field = holeField(START_AT + 1);
    expect(field.swallows(CENTRE.x + HORIZON - 1, CENTRE.y, 3)).toBe(true);
    expect(field.swallows(CENTRE.x + HORIZON + 10, CENTRE.y, 3)).toBe(false);
  });

  it('touches the ship and costs it a life inside the contact radius, and only while the hole is active', () => {
    const field = holeField(START_AT + 1);
    expect(field.strikes(CENTRE.x + CONTACT - 1, CENTRE.y, PLAYER.radius)).toBe(true);
    expect(field.strikes(CENTRE.x + CONTACT + 2, CENTRE.y, PLAYER.radius)).toBe(false);
    const warning = holeField(START_AT - 1);
    expect(warning.strikes(CENTRE.x, CENTRE.y, PLAYER.radius)).toBe(false);
  });
});

describe('the hole\'s life', () => {
  it('warns for 3 s at the field centre, starts, and ends after 75 s, each event carrying its id', () => {
    const out: SimEvent[] = [];
    let last = 0;
    const field = new HazardField([hole(12)], () => createRng(1), () => ++last);
    field.step(9, FIELD, out);
    expect(out).toEqual([{ type: 'holeWarning', id: 1, x: CENTRE.x, y: CENTRE.y, at: 12 }]);
    out.length = 0;
    field.step(12, FIELD, out);
    expect(out).toEqual([{ type: 'holeStart', id: 1, x: CENTRE.x, y: CENTRE.y }]);
    out.length = 0;
    field.step(12 + LENGTH, FIELD, out);
    expect(out).toEqual([{ type: 'holeEnd', id: 1 }]);
  });

  it('pulls nothing and strikes nothing while it only warns', () => {
    const rock = rockAt(3, CENTRE.x + 200, CENTRE.y);
    const field = holeField(START_AT - 1);
    field.move(DT, shipAt(60, 60), [rock], hazardFoes(), []);
    expect(rock.vx).toBe(0);
  });

  it('returns a respawn point from its warning until it ends, and nothing before or after', () => {
    expect(holeField(START_AT - 1).respawnPoint()).not.toBeNull();
    expect(holeField(START_AT + 1).respawnPoint()).not.toBeNull();
    expect(holeField(START_AT - 4).respawnPoint()).toBeNull();
    expect(holeField(START_AT + LENGTH + 1).respawnPoint()).toBeNull();
  });

  /** How far a respawn point must lie from the hole: a ship's safe radius outside the reach it survives a reaction from. */
  const SAFE_FROM_HOLE = BLACK_HOLE.exitReach + RESPAWN_MARGIN;

  it.each([MIN_ASPECT, 16 / 9, MAX_ASPECT])('puts the respawn point a safe radius outside its exit reach and no farther, inside the field, at aspect %d', (aspect) => {
    const field: Field = { width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT };
    let last = 0;
    const hazards = new HazardField([hole(START_AT, 3)], () => createRng(1), () => ++last);
    hazards.step(START_AT + 1, field, []);
    const spot = hazards.respawnPoint();
    if (spot === null) throw new Error('the hole is active, so it has a respawn point');
    // As far from the hole on every field shape, so an idle ship falls back in as fast on each.
    const distance = Math.hypot(spot.x - field.width / 2, spot.y - field.height / 2);
    expect(distance).toBeGreaterThanOrEqual(SAFE_FROM_HOLE);
    expect(distance).toBeLessThanOrEqual(SAFE_FROM_HOLE + 2);
    expect(spot.x).toBeGreaterThan(0);
    expect(spot.x).toBeLessThan(field.width);
    expect(spot.y).toBeGreaterThan(0);
    expect(spot.y).toBeLessThan(field.height);
  });

  it('moves the respawn point off a swarm gathered on it, to a spot clear of every live foe and of the hole, the same for the same foes', () => {
    const hazards = holeField(START_AT + 1);
    const ship = shipAt(60, 60);
    hazards.move(DT, ship, [], hazardFoes(), []);
    const first = hazards.respawnPoint();
    if (first === null) throw new Error('the hole is active, so it has a respawn point');
    const swarm = [foeAt('drone', first.x, first.y, { id: 1 }), foeAt('drone', first.x + 30, first.y, { id: 2 }), foeAt('drone', first.x, first.y - 30, { id: 3 })];
    hazards.move(DT, ship, [], hazardFoes(...swarm), []);
    const moved = hazards.respawnPoint();
    if (moved === null) throw new Error('the hole is active, so it has a respawn point');
    for (const foe of swarm) expect(Math.hypot(moved.x - foe.x, moved.y - foe.y) - foe.radius).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
    expect(Math.hypot(moved.x - CENTRE.x, moved.y - CENTRE.y)).toBeGreaterThanOrEqual(SAFE_FROM_HOLE);
    expect(hazards.respawnPoint()).toEqual(moved);
    // A spent foe is no swarm: the first choice comes back.
    for (const foe of swarm) foe.hp = 0;
    expect(hazards.respawnPoint()).toEqual(first);
  });

  describe('with other hazards in play', () => {
    /** A hole beside `inPlay`, built alone so a test sets the hazards in play; active on `FIELD` unless `stepped` is false. */
    function holeAmong(inPlay: readonly HazardState[], stepped = true): BlackHole {
      const made = new BlackHole({ events: [hole()], rng: createRng(1), nextId: () => 1, keepOuts: () => [], inPlay: () => inPlay });
      if (stepped) made.step(START_AT + 1, FIELD, []);
      return made;
    }
    /** Where a ship respawns beside `inPlay` with `foes` about. */
    function respawnAmong(inPlay: readonly HazardState[], foes: readonly Foe[] = []): { x: number; y: number } {
      const spot = holeAmong(inPlay).respawnPoint(foes);
      if (spot === null) throw new Error('the hole is active, so it has a respawn point');
      return spot;
    }
    const zoneOn = (spot: { x: number; y: number }, stage: HazardState['stage']): HazardState => ({ id: 7, type: 'dangerZone', stage, x: spot.x, y: spot.y, w: 160, h: 160, intensity: 1, remaining: 5 });
    const riftOn = (spot: { x: number; y: number }, stage: HazardState['stage']): HazardState => ({ id: 8, type: 'warpRift', stage, x: 100, y: 100, toX: spot.x, toY: spot.y, intensity: 1, remaining: 5 });
    /** How far `spot` lies outside every zone and rift mouth in `states`, across the wrap. */
    function hazardClearance(states: readonly HazardState[], spot: { x: number; y: number }): number {
      return Math.min(
        ...states.map((s) => {
          if (s.type === 'dangerZone') return zoneClearance(FIELD, s, spot.x, spot.y);
          if (s.type === 'warpRift') return Math.min(wrappedDistance(spot, s, FIELD), wrappedDistance(spot, { x: s.toX, y: s.toY }, FIELD)) - WARP_RIFT.radius;
          return Infinity;
        }),
      );
    }

    it.each([
      ['a warning zone', zoneOn, 'warning'],
      ['an active zone', zoneOn, 'active'],
      ['a warning rift mouth', riftOn, 'warning'],
      ['an open rift mouth', riftOn, 'active'],
    ] as const)('moves the respawn point off %s over its first spot, to one a safe radius clear of it and of the hole', (_name, make, stage) => {
      const states = [make(respawnAmong([]), stage)];
      const spot = respawnAmong(states);
      expect(hazardClearance(states, spot)).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
      expect(Math.hypot(spot.x - CENTRE.x, spot.y - CENTRE.y)).toBeGreaterThanOrEqual(SAFE_FROM_HOLE);
    });

    it('keeps a respawn out of a zone and a rift mouth on the next spots when foes crowd the first', () => {
      const first = respawnAmong([]);
      const swarm = [foeAt('drone', first.x, first.y, { id: 1 })];
      const second = respawnAmong([], swarm);
      const third = respawnAmong([zoneOn(second, 'active')], swarm);
      const states = [zoneOn(second, 'active'), riftOn(third, 'active')];
      const spot = respawnAmong(states, swarm);
      expect(hazardClearance(states, spot)).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
      expect(Math.hypot(spot.x - first.x, spot.y - first.y) - FOES.drone.radius).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
    });

    /**
     * A hole active on `field`, and where a respawn lands once a drone sits on each of the four ring spots, past the ring and
     * into the respawn search; with `hazards`, a zone, then a rift mouth, also covers each of the next two spots it would take.
     */
    function crowdedRespawn(field: Field, hazards: boolean): { spot: { x: number; y: number }; ring: { x: number; y: number }[]; swarm: Foe[]; states: HazardState[] } {
      const states: HazardState[] = [];
      const made = new BlackHole({ events: [hole()], rng: createRng(1), nextId: () => 1, keepOuts: () => [], inPlay: () => states });
      made.step(START_AT + 1, field, []);
      const respawn = (foes: readonly Foe[]): { x: number; y: number } => {
        const spot = made.respawnPoint(foes);
        if (spot === null) throw new Error('the hole is active, so it has a respawn point');
        return spot;
      };
      const swarm: Foe[] = [];
      const ring: { x: number; y: number }[] = [];
      for (let i = 0; i < 4; i++) {
        const spot = respawn(swarm);
        ring.push(spot);
        swarm.push(foeAt('drone', spot.x, spot.y, { id: 10 + i }));
      }
      if (hazards) {
        states.push(zoneOn(respawn(swarm), 'active'));
        states.push(riftOn(respawn(swarm), 'active'));
      }
      return { spot: respawn(swarm), ring, swarm, states };
    }

    /** How far `spot` lies outside each thing a respawn keeps clear of: the hole's exit reach, the foes, the zone and the mouths. */
    function clearances(field: Field, { spot, swarm, states }: ReturnType<typeof crowdedRespawn>): { hole: number; others: number } {
      const centre = { x: field.width / 2, y: field.height / 2 };
      const others = states.flatMap((s) =>
        s.type === 'dangerZone' ? [zoneClearance(field, s, spot.x, spot.y)] : s.type === 'warpRift' ? [s, { x: s.toX, y: s.toY }].map((m) => wrappedDistance(spot, m, field) - WARP_RIFT.radius) : [],
      );
      for (const foe of swarm) others.push(Math.hypot(spot.x - foe.x, spot.y - foe.y) - foe.radius);
      return { hole: Math.hypot(spot.x - centre.x, spot.y - centre.y) - BLACK_HOLE.exitReach, others: Math.min(...others) };
    }

    it('falls back past its four crowded ring spots to the respawn grid on a wide field, a safe radius clear of the hole, the foes, a zone and a rift mouth', () => {
      const field: Field = { width: FIELD_HEIGHT * MAX_ASPECT, height: FIELD_HEIGHT };
      const crowded = crowdedRespawn(field, true);
      expect(new Set(crowded.ring.map((p) => `${String(p.x)},${String(p.y)}`)).size).toBe(4);
      expect(crowded.ring).not.toContainEqual(crowded.spot);
      const { left, right, top, bottom } = respawnBand(field);
      expect(crowded.spot.x).toBeGreaterThanOrEqual(left);
      expect(crowded.spot.x).toBeLessThanOrEqual(right);
      expect(crowded.spot.y).toBeGreaterThanOrEqual(top);
      expect(crowded.spot.y).toBeLessThanOrEqual(bottom);
      const { hole, others } = clearances(field, crowded);
      expect(hole).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
      expect(others).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
    });

    it('takes the clearest spot on a 4:3 field, where no grid spot clears the full margin past four crowded ring spots: outside the hole\'s exit reach, and a safe radius clear of the foes', () => {
      const field: Field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
      const crowded = crowdedRespawn(field, false);
      expect(crowded.ring).not.toContainEqual(crowded.spot);
      const { hole, others } = clearances(field, crowded);
      // The escape holds from the exit reach; the margin past it is what the crowd leaves of the field.
      expect(hole).toBeGreaterThan(0);
      expect(hole).toBeLessThan(RESPAWN_MARGIN);
      expect(others).toBeGreaterThanOrEqual(RESPAWN_MARGIN);
    });

    it('offers the spot it respawns at with nothing in the way, whatever the foes and hazards, for placed hazards to keep out of', () => {
      const first = respawnAmong([]);
      const made = holeAmong([zoneOn(first, 'active')]);
      expect(made.respawnSpot(FIELD)).toEqual(first);
      expect(made.respawnPoint([foeAt('drone', first.x, first.y, { id: 1 })])).not.toEqual(first);
      expect(holeAmong([], false).respawnSpot(FIELD), 'no hole yet').toBeNull();
    });
  });

  it('draws from a stream of its own, \'hazards:blackHole\', so the other hazards\' draws do not move', () => {
    expect(hazardStreamName('blackHole')).toBe('hazards:blackHole');
  });

  it('is scheduled in Singularity only, and never in a boss galaxy', () => {
    expect(galaxyById('5-1').events.filter((e) => e.type === 'blackHole')).toEqual([{ at: 12, type: 'blackHole', intensity: 1 }]);
    for (const id of ['5-6', '4-6', '3-6'] as const) expect(galaxyById(id).events).toEqual([]);
  });
});
