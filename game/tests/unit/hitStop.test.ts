import { describe, expect, it } from 'vitest';
import { HitStop, hitStopFor } from '../../src/app/hitStop';
import { STEP_SECONDS } from '../../src/sim/config';
import type { Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { createFixedStepLoop } from '../../src/sim/loop';
import { World } from '../../src/sim/world';

const SHIP_HIT: SimEvent = { type: 'shipHit', x: 1, y: 2, livesLeft: 2 };
const destroyed = (size: 0 | 1 | 2 | 3): SimEvent => ({ type: 'asteroidDestroyed', id: 1, x: 1, y: 2, size, points: 20 });
const SHOT: SimEvent = { type: 'shot', x: 1, y: 2 };

describe('hitStopFor', () => {
  it('freezes 110 ms for a ship hit and 55 ms for a large asteroid, nothing else', () => {
    expect(hitStopFor(SHIP_HIT)).toBe(0.11);
    expect(hitStopFor(destroyed(0))).toBe(0.055);
    expect(hitStopFor(destroyed(1))).toBe(0);
    expect(hitStopFor(destroyed(2))).toBe(0);
    expect(hitStopFor(destroyed(3))).toBe(0);
    expect(hitStopFor(SHOT)).toBe(0);
    expect(hitStopFor({ type: 'gameOver', score: 5 })).toBe(0);
    expect(hitStopFor({ type: 'bossHit', x: 0, y: 0, hp: 5 })).toBe(0);
  });
});

describe('HitStop', () => {
  it('passes frames through when nothing triggered', () => {
    const hs = new HitStop();
    expect(hs.frozen).toBe(false);
    expect(hs.consume(0.016)).toBe(0.016);
  });

  it('a freeze consumes frame time and returns the unfrozen remainder', () => {
    const hs = new HitStop();
    hs.trigger([destroyed(0)]);
    expect(hs.frozen).toBe(true);
    expect(hs.consume(0.02)).toBe(0);
    expect(hs.consume(0.02)).toBe(0);
    expect(hs.consume(0.02)).toBeCloseTo(0.005, 10);
    expect(hs.frozen).toBe(false);
    expect(hs.consume(0.02)).toBe(0.02);
  });

  it('overlapping freezes take the maximum remaining, not the sum', () => {
    const hs = new HitStop();
    hs.trigger([SHIP_HIT]);
    expect(hs.consume(0.05)).toBe(0);
    hs.trigger([destroyed(0)]); // 0.055 < 0.06 remaining: no extension
    expect(hs.consume(0.06)).toBeCloseTo(0, 10);
    expect(hs.frozen).toBe(false);
    hs.trigger([destroyed(0), SHIP_HIT, SHOT]);
    expect(hs.consume(0.1)).toBe(0);
    expect(hs.consume(0.02)).toBeCloseTo(0.01, 10);
  });

  it('reduced motion never freezes and clears a pending freeze', () => {
    const hs = new HitStop();
    hs.trigger([SHIP_HIT]);
    hs.reducedMotion = true;
    expect(hs.frozen).toBe(false);
    hs.trigger([SHIP_HIT]);
    expect(hs.frozen).toBe(false);
    expect(hs.consume(0.016)).toBe(0.016);
    hs.reducedMotion = false;
    expect(hs.consume(0.016)).toBe(0.016);
    hs.trigger([SHIP_HIT]);
    expect(hs.frozen).toBe(true);
  });

  it('clear drops a pending freeze', () => {
    const hs = new HitStop();
    hs.trigger([SHIP_HIT]);
    hs.clear();
    expect(hs.frozen).toBe(false);
    expect(hs.consume(0.016)).toBe(0.016);
  });

  it('ignores bad frame times without losing the freeze', () => {
    const hs = new HitStop();
    hs.trigger([SHIP_HIT]);
    expect(hs.consume(Number.NaN)).toBeNaN();
    expect(hs.consume(-1)).toBe(-1);
    expect(hs.frozen).toBe(true);
    expect(hs.consume(0.2)).toBeCloseTo(0.09, 10);
  });
});

const FIELD = { width: 1280, height: 720 };
const SIX_SECONDS_OF_STEPS = Math.round(6 / STEP_SECONDS);
const SEED = 1;

/** The same input at every step index in both runs: hold fire, no turn, no thrust. */
const CONTROLS: Controls = { turn: 0, thrust: false, fire: true, stick: null };

interface Run {
  readonly log: readonly (readonly SimEvent[])[];
  readonly state: unknown;
  readonly frozenFrames: number;
}

function snapshot(w: World): unknown {
  return {
    score: w.score,
    lives: w.lives,
    status: w.status,
    elapsed: w.elapsed,
    ship: { ...w.ship },
    asteroids: w.asteroids.map((a) => ({ ...a })),
    projectiles: w.projectiles.map((p) => ({ ...p })),
  };
}

function newWorld(): World {
  return new World({
    seed: SEED,
    field: FIELD,
    practiceLevel: 3,
    startLives: 3,
    initialShip: { x: 640, y: 360, angle: 0 },
    initialAsteroids: [
      { x: 1000, y: 360, size: 0, angle: Math.PI, speedMultiplier: 0.5 },
      { x: 640, y: 160, size: 0, angle: Math.PI / 2, speedMultiplier: 1 },
    ],
  });
}

function runUniform(): Run {
  const w = newWorld();
  const loop = createFixedStepLoop();
  const log: SimEvent[][] = [];
  for (let i = 0; i < SIX_SECONDS_OF_STEPS; i++) {
    loop.advance(STEP_SECONDS, (dt) => {
      log.push(w.step(dt, CONTROLS).map((e) => ({ ...e })));
    });
  }
  return { log, state: snapshot(w), frozenFrames: 0 };
}

/** Varied frame times (jitter, a long frame) through HitStop; stops after the same number of steps. */
function runWithHitStop(): Run {
  const w = newWorld();
  const loop = createFixedStepLoop();
  const hs = new HitStop();
  const frames = [1 / 60, 1 / 144, 1 / 30, 0.04, 1 / 75];
  const log: SimEvent[][] = [];
  let frozenFrames = 0;
  // The frame cap turns a consume() that stops spending time into a failure instead of a hang.
  for (let f = 0; log.length < SIX_SECONDS_OF_STEPS && f < 100_000; f++) {
    if (hs.frozen) frozenFrames++;
    const unfrozen = hs.consume(frames[f % frames.length] ?? 1 / 60);
    loop.advance(unfrozen, (dt) => {
      if (log.length >= SIX_SECONDS_OF_STEPS) return;
      const events = w.step(dt, CONTROLS);
      log.push(events.map((e) => ({ ...e })));
      hs.trigger(events);
    });
  }
  return { log, state: snapshot(w), frozenFrames };
}

describe('hit-stop does not change gameplay outcomes', () => {
  const uniform = runUniform();
  const stopped = runWithHitStop();
  const all = uniform.log.flat();

  it('the script produces ship hits and large-asteroid kills', () => {
    expect(all.filter((e) => e.type === 'shipHit').length).toBeGreaterThan(0);
    expect(all.filter((e) => e.type === 'asteroidDestroyed' && e.size === 0).length).toBeGreaterThan(0);
    expect(stopped.frozenFrames).toBeGreaterThan(0);
  });

  it('per-step event logs and the final state are identical', () => {
    expect(stopped.log).toHaveLength(SIX_SECONDS_OF_STEPS);
    expect(stopped.log).toEqual(uniform.log);
    expect(stopped.state).toEqual(uniform.state);
  });
});
