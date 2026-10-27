import { describe, expect, it } from 'vitest';
import { eventsOfType } from '../../src/content/curves';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyDef, GalaxyId } from '../../src/content/types';
import type { AsteroidSize } from '../../src/sim/asteroid';
import { ASTEROID, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { fieldBudget, SIZE_COST } from '../../src/sim/galaxy/director';
import { EDGE_BEARINGS, showerCap } from '../../src/sim/galaxy/showers';
import { World, type WorldOptions } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const CENTRE = { x: FIELD.width / 2, y: FIELD.height / 2 };
const STEPS_PER_SECOND = Math.round(1 / STEP_SECONDS);
const FIRE: Controls = { ...NO_CONTROLS, fire: true };
const WARP_SECONDS = 1.5;
/** The most rocks seen at once in the seed-6 3-5 run below, recorded for the curves the bots were tuned to. */
const PINNED_3_5_PEAK = 44;

/** A galaxy whose director never spawns; `events` keeps or drops its showers. */
function calm(id: GalaxyId, keepShowers = false): GalaxyDef {
  const g = galaxyById(id);
  return { ...g, kinds: MUTED_KINDS, events: keepShowers ? g.events : [] };
}

type Scenario = Omit<WorldOptions, 'field' | 'seed' | 'rules'> & { readonly seed?: number; readonly mode?: 'rank' | 'free' };

function galaxyWorld(galaxy: GalaxyDef, opts: Scenario = {}): World {
  const { mode = 'free', seed = 1, ...rest } = opts;
  return new World({ seed, field: FIELD, rules: { kind: 'galaxy', galaxy, mode }, ...rest });
}

function still(x: number, y: number, size: AsteroidSize) {
  return { x, y, size, angle: 0, speedMultiplier: 0 };
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

interface Logged {
  readonly event: SimEvent;
  readonly elapsed: number;
}

/** Steps until the run stops or `seconds` pass, logging every event with the elapsed time after its step. */
function play(w: World, seconds: number, controls: Controls = NO_CONTROLS, onStep?: (events: readonly SimEvent[]) => void): Logged[] {
  const log: Logged[] = [];
  for (let i = 0; i < seconds * STEPS_PER_SECOND && (w.status === 'playing' || w.status === 'warping'); i++) {
    const events = w.step(STEP_SECONDS, controls);
    for (const e of events) log.push({ event: { ...e }, elapsed: w.elapsed });
    onStep?.(events);
  }
  return log;
}

const eventsOf = (log: readonly Logged[]): SimEvent[] => log.map((l) => l.event);

describe('a galaxy run', () => {
  it('a statue in 1-1 (seed 3) ends gameOver or cleared, and never before 90 s while it has lives', () => {
    const w = galaxyWorld(galaxyById('1-1'), { seed: 3 });
    play(w, 100, NO_CONTROLS, () => {
      if (w.status !== 'playing' && w.lives > 0) expect(w.elapsed).toBeGreaterThanOrEqual(90 - 1e-9);
    });
    expect(['gameOver', 'cleared']).toContain(w.status);
    if (w.status === 'cleared') expect(w.elapsed).toBeGreaterThanOrEqual(90 + WARP_SECONDS - 1e-9);
    else expect(w.lives).toBe(0);
  });

  it('announces the galaxy once, on the first step', () => {
    const w = galaxyWorld(calm('1-2'));
    expect(ofType(w.step(STEP_SECONDS, NO_CONTROLS), 'galaxyStart')).toEqual([{ type: 'galaxyStart', id: '1-2' }]);
    expect(ofType(eventsOf(play(w, 10)), 'galaxyStart')).toEqual([]);
  });

  it('counts the timer down to 0 and walks the pacing phases', () => {
    const w = galaxyWorld(calm('1-1'));
    expect(w.galaxy?.id).toBe('1-1');
    expect(w.timeLeft).toBe(90);
    expect(w.phase).toBe('opening');
    play(w, 30);
    expect(w.timeLeft).toBeCloseTo(60, 6);
    expect(w.phase).toBe('build');
    play(w, 35);
    expect(w.phase).toBe('lull');
    play(w, 10);
    expect(w.phase).toBe('surge');
    play(w, 20);
    expect(w.timeLeft).toBe(0);
    expect(w.phase).toBe('warp');
  });

  it('takes 1 to 5 start lives in Rank, defaulting to 3', () => {
    expect(galaxyWorld(calm('1-1'), { mode: 'rank' }).lives).toBe(3);
    expect(galaxyWorld(calm('1-1'), { mode: 'rank', startLives: 1 }).lives).toBe(1);
    expect(galaxyWorld(calm('1-1'), { mode: 'rank', startLives: 5 }).lives).toBe(5);
    expect(() => galaxyWorld(calm('1-1'), { mode: 'rank', startLives: 6 })).toThrow(/startLives must be an integer from 1 to 5/);
  });

  it.each([1, 2, 4, 5])('always starts Free play with 3 lives, refusing startLives %i', (startLives) => {
    expect(galaxyWorld(calm('1-1'), { mode: 'free' }).lives).toBe(3);
    expect(galaxyWorld(calm('1-1'), { mode: 'free', startLives: 3 }).lives).toBe(3);
    expect(() => galaxyWorld(calm('1-1'), { mode: 'free', startLives })).toThrow(/Free play always starts with 3 lives.*rank/);
  });

  it('refuses rules and practiceLevel together, saying which to keep', () => {
    expect(() => galaxyWorld(calm('1-1'), { practiceLevel: 2 })).toThrow(/rules.*practiceLevel/);
  });

  it('replays the same seed identically, and differs for another', () => {
    const run = (seed: number) => eventsOf(play(galaxyWorld(galaxyById('2-4'), { seed, mode: 'rank', startLives: 5 }), 40, FIRE));
    const a = run(4);
    expect(ofType(a, 'asteroidDestroyed').length).toBeGreaterThan(0);
    expect(run(4)).toEqual(a);
    expect(run(5)).not.toEqual(a);
  });
});

describe('a galaxy run on resize', () => {
  it('budgets for the new field, exactly as a run started on it', () => {
    const narrow: Field = { width: 960, height: 720 };
    const wide: Field = { width: 1680, height: 720 };
    const resized = new World({ seed: 8, field: narrow, rules: { kind: 'galaxy', galaxy: galaxyById('3-3'), mode: 'rank' }, startLives: 5 });
    resized.resize(wide);
    const native = new World({ seed: 8, field: wide, rules: { kind: 'galaxy', galaxy: galaxyById('3-3'), mode: 'rank' }, startLives: 5 });
    const log = eventsOf(play(native, 40));
    expect(ofType(log, 'asteroidDestroyed').length + native.asteroids.length + ofType(log, 'foeSpawned').length).toBeGreaterThan(8);
    expect(eventsOf(play(resized, 40))).toEqual(log);
  });
});

describe('practice rules', () => {
  it('report no galaxy, timer, phase or shower, and a flat multiplier', () => {
    const w = new World({ seed: 1, field: FIELD, rules: { kind: 'practice', level: 4 } });
    expect(w.practiceLevel).toBe(4);
    expect([w.galaxy, w.timeLeft, w.phase, w.shower]).toEqual([null, null, null, null]);
    expect([w.combo, w.multiplier, w.deaths]).toEqual([0, 1, 0]);
  });
});

describe('warp-out', () => {
  it('clears every rock for 0 points at the end of the timer and reports the clear on that step; the status clears 1.5 s later', () => {
    const rocks = [still(100, 100, 0), still(1100, 600, 2), still(200, 650, 3)];
    const w = galaxyWorld(calm('1-1'), { initialAsteroids: rocks });
    const ids = w.asteroids.map((a) => a.id);
    const log = play(w, 95);
    const warp = log.filter((l) => l.event.type === 'warpOut');
    expect(warp).toHaveLength(1);
    const at = warp[0]?.elapsed ?? 0;
    expect(at).toBeGreaterThanOrEqual(90 - 1e-9);
    expect(at).toBeLessThan(90 + STEP_SECONDS);
    const cleared = log.filter((l) => l.elapsed === at && l.event.type === 'asteroidDestroyed').map((l) => l.event);
    expect(cleared.map((e) => (e.type === 'asteroidDestroyed' ? [e.id, e.points] : null))).toEqual(ids.map((id) => [id, 0]));
    expect(w.score).toBe(250 + 500); // 1-1 scores only its clear and no-death bonus
    // The outcome is final once the warp starts (the ship cannot be hit, warp kills score 0), so it is reported then.
    const done = log.filter((l) => l.event.type === 'galaxyCleared');
    expect(done.map((l) => l.elapsed)).toEqual([at]);
    const types = log.filter((l) => l.elapsed === at).map((l) => l.event.type);
    expect(types.indexOf('warpOut')).toBeLessThan(types.indexOf('galaxyCleared'));
    expect(w.status).toBe('cleared');
  });

  it('is already scored when the warp starts, and turns cleared 1.5 s later with no second event', () => {
    const w = galaxyWorld(calm('1-1'));
    const log = play(w, 90.01);
    expect(w.status).toBe('warping');
    expect(ofType(eventsOf(log), 'galaxyCleared')).toEqual([{ type: 'galaxyCleared', score: 750, deaths: 0, stars: 3, bonus: 750 }]);
    expect(w.score).toBe(750);
    const after = play(w, WARP_SECONDS + 0.1);
    expect(w.status).toBe('cleared');
    expect(eventsOf(after)).toEqual([]);
    expect(w.score).toBe(750);
  });

  it('holds the ship safe from a rock sitting on it as the timer runs out, on the very step its shield drops', () => {
    // The step the ship's opening invulnerability ends on...
    const probe = galaxyWorld(calm('1-1'));
    while (probe.ship.invulnerable) probe.step(STEP_SECONDS, NO_CONTROLS);
    const vulnerableAt = probe.elapsed;
    const lurker = [still(CENTRE.x, CENTRE.y, 3)];
    // ...hits a ship the timer has not run out on...
    const control = galaxyWorld({ ...calm('1-1'), duration: vulnerableAt + 1 }, { initialAsteroids: lurker });
    expect(ofType(eventsOf(play(control, 5)), 'shipHit')).toHaveLength(1);
    // ...but not when the galaxy ends on that same step: the warp clears the field before anything collides.
    const w = galaxyWorld({ ...calm('1-1'), duration: vulnerableAt }, { initialAsteroids: lurker });
    const log = play(w, 5);
    expect(log.find((l) => l.event.type === 'warpOut')?.elapsed).toBe(vulnerableAt);
    expect(ofType(eventsOf(log), 'shipHit')).toEqual([]);
    expect(w.lives).toBe(3);
    expect(w.status).toBe('cleared');
  });

  it('spawns nothing and leaves the field empty while warping', () => {
    const w = galaxyWorld(galaxyById('1-1'), { seed: 3, mode: 'rank', startLives: 5 });
    const log = play(w, 95);
    const warpAt = log.find((l) => l.event.type === 'warpOut')?.elapsed;
    expect(warpAt).toBeDefined();
    const during = log.filter((l) => l.elapsed > (warpAt ?? 0));
    expect(ofType(eventsOf(during), 'shipHit')).toEqual([]);
    expect(ofType(eventsOf(during), 'asteroidDestroyed')).toEqual([]);
    expect(w.status).toBe('cleared');
    expect(w.asteroids).toEqual([]);
  });

  it('reports warping, then cleared, after which step is a no-op', () => {
    const w = galaxyWorld(calm('1-1'));
    play(w, 90.01);
    expect(w.status).toBe('warping');
    play(w, 2);
    expect(w.status).toBe('cleared');
    const elapsed = w.elapsed;
    expect(w.step(STEP_SECONDS, FIRE)).toEqual([]);
    expect(w.elapsed).toBe(elapsed);
  });
});

describe('galaxyCleared', () => {
  const clear = (opts: Scenario) => {
    const w = galaxyWorld(calm('2-1'), opts);
    const cleared = ofType(eventsOf(play(w, 110)), 'galaxyCleared');
    return { w, cleared };
  };

  it('fires once with 3 stars and both bonuses after a deathless run', () => {
    const { w, cleared } = clear({});
    expect(cleared).toEqual([{ type: 'galaxyCleared', score: 1500, deaths: 0, stars: 3, bonus: 1500 }]);
    expect(w.score).toBe(1500);
  });

  it('gives 2 stars and only the clear bonus after one death', () => {
    const { w, cleared } = clear({ initialAsteroids: [still(CENTRE.x, CENTRE.y, 3)] });
    expect(cleared).toEqual([{ type: 'galaxyCleared', score: 500, deaths: 1, stars: 2, bonus: 500 }]);
    expect(w.deaths).toBe(1);
  });

  it('gives 1 star after two deaths', () => {
    const tiny = still(CENTRE.x, CENTRE.y, 3);
    expect(clear({ initialAsteroids: [tiny, tiny] }).cleared[0]).toMatchObject({ deaths: 2, stars: 1, bonus: 500 });
  });

  it('applies the Dimension multiplier in Rank only', () => {
    expect(clear({ mode: 'rank' }).cleared[0]).toMatchObject({ score: 1650, bonus: 1500 });
    expect(clear({ mode: 'free' }).cleared[0]).toMatchObject({ score: 1500, bonus: 1500 });
  });
});

describe('galaxy combos', () => {
  /** Twelve tiny rocks in a row in front of a ship facing +x. */
  const row = Array.from({ length: 12 }, (_, i) => still(260 + 40 * i, 360, 3));

  it('multiplies kill points by the combo and announces each change of multiplier', () => {
    const w = galaxyWorld(calm('1-1'), { initialShip: { x: 200, y: 360, angle: 0 }, initialAsteroids: row });
    const multipliers: number[] = [];
    const log = eventsOf(play(w, 8, FIRE, () => multipliers.push(w.multiplier)));
    const kills = ofType(log, 'asteroidDestroyed');
    expect(kills).toHaveLength(12);
    expect(kills.map((k) => k.points)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3].map((m) => ASTEROID.scores[3] * m));
    expect(w.score).toBe(kills.reduce((sum, k) => sum + k.points, 0));
    expect(ofType(log, 'combo')).toEqual([
      { type: 'combo', multiplier: 2 },
      { type: 'combo', multiplier: 3 },
      { type: 'combo', multiplier: 1 },
    ]);
    expect(w.combo).toBe(0);
  });

  it('resets the combo on a death', () => {
    // Overlaps the ship but sits clear of its line of fire, so it hits once the 3 s of invulnerability end.
    const lurker = still(195, 375, 3);
    const w = galaxyWorld(calm('1-1'), { initialShip: { x: 200, y: 360, angle: 0 }, initialAsteroids: [...row.slice(0, 6), lurker] });
    const log = play(w, 3.5, FIRE);
    const hit = log.filter((l) => l.event.type === 'shipHit');
    expect(hit).toHaveLength(1);
    expect(log.filter((l) => l.event.type === 'combo')).toEqual([
      { event: { type: 'combo', multiplier: 2 }, elapsed: expect.any(Number) as number },
      { event: { type: 'combo', multiplier: 1 }, elapsed: hit[0]?.elapsed },
    ]);
    expect(w.combo).toBe(0);
  });
});

describe('meteor showers in a run', () => {
  it('drops every shower rock from the telegraphed edge, heading in', () => {
    const w = galaxyWorld(calm('1-4', true), { seed: 6, mode: 'rank', startLives: 5 });
    const seen = new Set(w.asteroids.map((a) => a.id));
    let angle: number | null = null;
    let fresh = 0;
    play(w, 60, NO_CONTROLS, (events) => {
      const warning = ofType(events, 'showerWarning')[0];
      if (warning !== undefined) angle = warning.angle;
      for (const a of w.asteroids) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        fresh++;
        expect(a.transient).toBe(true);
        expect(w.shower?.stage).toBe('active');
        expect(w.shower?.angle).toBe(angle);
        const [top, right, bottom] = EDGE_BEARINGS;
        if (angle === top) expect([a.y, a.vy > 0]).toEqual([-WRAP_MARGIN, true]);
        else if (angle === right) expect([a.x, a.vx < 0]).toEqual([FIELD.width + WRAP_MARGIN, true]);
        else if (angle === bottom) expect([a.y, a.vy < 0]).toEqual([FIELD.height + WRAP_MARGIN, true]);
        else expect([a.x, a.vx > 0]).toEqual([-WRAP_MARGIN, true]);
      }
    });
    expect(angle).not.toBeNull();
    expect(fresh).toBeGreaterThanOrEqual(5);
  });
});

describe('meteors pass through', () => {
  it('never wraps a meteor, and removes it once it has left the field, for no score', () => {
    const w = galaxyWorld(calm('1-4', true), { seed: 6, mode: 'rank', startLives: 5 });
    const meteors = new Set<number>();
    let score = 0;
    const log = play(w, 80, NO_CONTROLS, () => {
      for (const a of w.asteroids) {
        if (a.transient === true) meteors.add(a.id);
        // A wrap would jump the rock across the field in one step.
        if (a.transient === true) expect(Math.abs(a.x - a.px) + Math.abs(a.y - a.py)).toBeLessThan(10);
      }
      expect(w.score).toBeGreaterThanOrEqual(score);
      score = w.score;
    });
    const left = ofType(eventsOf(log), 'asteroidLeft').map((e) => e.id);
    expect(meteors.size).toBeGreaterThanOrEqual(5);
    expect(left.length).toBeGreaterThan(meteors.size / 2);
    for (const id of left) expect(meteors.has(id)).toBe(true);
    expect(ofType(eventsOf(log), 'asteroidDestroyed').filter((e) => left.includes(e.id))).toEqual([]);
    expect(w.asteroids.filter((a) => a.transient === true)).toEqual([]);
    expect(w.score).toBe(0);
  });

  it('marks no director rock as a meteor', () => {
    const w = galaxyWorld(galaxyById('1-2'), { seed: 2, mode: 'rank', startLives: 5 });
    play(w, 40, NO_CONTROLS, () => {
      for (const a of w.asteroids) expect(a.transient).toBeUndefined();
    });
    expect(w.asteroids.length).toBeGreaterThan(0);
  });

  it('keeps a 3-5 run within its budget plus the shower cap through both showers, and pins the peak', () => {
    // The drop pool, the kinds and the schedule are held at the ones 3-5 had when the peak was pinned (rocks alone, and
    // showers), so the run pins the director, not which pickups fall or what Crimson Nebula brought in since.
    const pinned = galaxyById('3-5');
    const g = { ...pinned, pickups: galaxyById('2-5').pickups, kinds: galaxyById('1-1').kinds, events: eventsOfType(pinned.events, 'meteorShower') };
    const area = FIELD.width * FIELD.height;
    const peakBudget = Math.max(...Array.from({ length: g.duration * 10 }, (_, i) => fieldBudget(g, i / 10, 1, area)));
    const meteorCap = Math.floor(showerCap(3, area));
    const w = galaxyWorld(g, { seed: 6, mode: 'rank', startLives: 5 });
    let peak = 0;
    const turnAndFire: Controls = { ...FIRE, turn: 1 };
    const log = play(w, g.duration + 2, turnAndFire, () => {
      const meteors = w.asteroids.filter((a) => a.transient === true);
      const rocks = w.asteroids.filter((a) => a.transient !== true);
      expect(meteors.length).toBeLessThanOrEqual(meteorCap);
      expect(rocks.reduce((sum, a) => sum + SIZE_COST[a.size], 0)).toBeLessThanOrEqual(peakBudget + 1e-9);
      peak = Math.max(peak, w.asteroids.length);
    });
    expect(ofType(eventsOf(log), 'showerStart')).toHaveLength(2);
    expect(peak).toBe(PINNED_3_5_PEAK);
  });
});

describe('mercy after a death', () => {
  /** Ids of rocks the director placed on a wrap line between `from` and `to` seconds (split children are born mid-field). */
  function directorSpawns(w: World, from: number, to: number): number {
    const seen = new Set(w.asteroids.map((a) => a.id));
    let count = 0;
    play(w, to - w.elapsed, NO_CONTROLS, () => {
      for (const a of w.asteroids) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        const onWrapLine = a.x === -WRAP_MARGIN || a.y === -WRAP_MARGIN || a.x === FIELD.width + WRAP_MARGIN || a.y === FIELD.height + WRAP_MARGIN;
        if (onWrapLine && w.elapsed >= from) count++;
      }
    });
    return count;
  }

  it('holds the director back for the 4 s after a death, then lets it spawn again', () => {
    // Two large rocks and a medium (cost 10) fill most of 5-3's opening budget (about 14) but sit over a 0.4 budget.
    const corners = [still(100, 100, 0), still(1180, 100, 0), still(100, 620, 1)];
    let normal = 0;
    let merciful = 0;
    let after = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const calmShip = galaxyWorld(galaxyById('5-3'), { seed, mode: 'rank', initialAsteroids: [...corners, still(1180, 620, 3)] });
      const hit = galaxyWorld(galaxyById('5-3'), { seed, mode: 'rank', initialAsteroids: [...corners, still(CENTRE.x, CENTRE.y, 3)] });
      directorSpawns(hit, 0, 3.5);
      expect(hit.deaths, `seed ${String(seed)}`).toBe(1);
      directorSpawns(calmShip, 0, 3.5);
      normal += directorSpawns(calmShip, 3.5, 7);
      merciful += directorSpawns(hit, 3.5, 7);
      after += directorSpawns(hit, 7.5, 14);
    }
    expect(normal).toBeGreaterThan(0);
    expect(merciful).toBe(0);
    expect(after).toBeGreaterThan(0);
  });
});

describe('a boss galaxy', () => {
  it('runs its 20 s approach, then holds in the boss phase until the boss is beaten (see bossFixture.test.ts)', () => {
    const w = galaxyWorld(calm('1-6'));
    play(w, 19);
    expect(w.phase).toBe('opening');
    play(w, 2);
    expect(w.phase).toBe('boss');
    expect(w.status).toBe('playing');
    expect(w.timeLeft).toBe(0);
  });
});
