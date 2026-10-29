import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WRAP_MARGIN } from '../../src/sim/config';
import { NO_CONTROLS, type Controls, type Stick } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import { createFixedStepLoop } from '../../src/sim/loop';
import { createShip, stepShip, type Ship, type Shot } from '../../src/sim/ship';

interface FixtureFrame {
  input: { keys: string[]; stick: Stick | null };
  ship: { x: number; y: number; vx: number; vy: number; angle: number; thrusting: boolean; invulnerable: boolean };
  shots: Shot[];
}

interface Point {
  x: number;
  y: number;
}

interface Fixture {
  scenario: string;
  dt: number;
  field: Field;
  start: { x: number; y: number; angle: number };
  frames: FixtureFrame[];
}

const FIXTURE_DIR = new URL('../fixtures/parity/', import.meta.url);
const FIXTURES: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8')) as Fixture);

const DECIMALS = 9;

function controlsFor(input: FixtureFrame['input']): Controls {
  const left = input.keys.includes('ArrowLeft');
  const right = input.keys.includes('ArrowRight');
  return {
    ...NO_CONTROLS,
    turn: left === right ? 0 : left ? -1 : 1,
    thrust: input.keys.includes('ArrowUp'),
    fire: input.keys.includes(' '),
    stick: input.stick,
  };
}

function startShip(fixture: Fixture): Ship {
  const ship = createShip(fixture.start.x, fixture.start.y);
  ship.angle = fixture.start.angle;
  // A fresh 3 s timer cannot expire within one frame, so the ship starts
  // invulnerable exactly when the recorded first frame is still invulnerable.
  if (fixture.frames[0]?.ship.invulnerable !== true) {
    ship.invulnerable = false;
    ship.invulnerableFor = 0;
  }
  return ship;
}

/** Distance on the wrapped field: the two runs may cross a wrap edge on adjacent frames. */
function wrappedDistance(a: Point, b: Point, field: Field): number {
  const axis = (delta: number, size: number): number => {
    const d = Math.abs(delta);
    const period = size + 2 * WRAP_MARGIN;
    return Math.min(d, period - d);
  };
  return Math.hypot(axis(a.x - b.x, field.width), axis(a.y - b.y, field.height));
}

function expectShotsClose(actual: readonly Shot[], expected: readonly Shot[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((want, i) => {
    const got = actual[i];
    expect(got).toBeDefined();
    for (const key of ['x', 'y', 'vx', 'vy'] as const) {
      expect(got?.[key]).toBeCloseTo(want[key], DECIMALS);
    }
  });
}

describe('trace parity with the classic game', () => {
  it('loads every recorded scenario', () => {
    expect(FIXTURES.map((f) => f.scenario)).toEqual([
      'fire-held',
      'idle',
      'invulnerability',
      'max-speed',
      'stick-deadzone',
      'stick',
      'thrust-coast',
      'turn-thrust',
      'wrap',
    ]);
  });

  describe.each(FIXTURES.map((f) => [f.scenario, f] as const))('%s', (_name, fixture) => {
    it('matches the recorded frames exactly at the recorded rate', () => {
      const ship = startShip(fixture);
      fixture.frames.forEach((frame, index) => {
        const shots = stepShip(ship, controlsFor(frame.input), fixture.dt, fixture.field);
        const label = `frame ${String(index)}`;
        for (const key of ['x', 'y', 'vx', 'vy', 'angle'] as const) {
          expect(ship[key], `${label} ${key}`).toBeCloseTo(frame.ship[key], DECIMALS);
        }
        expect(ship.thrusting, `${label} thrusting`).toBe(frame.ship.thrusting);
        expect(ship.invulnerable, `${label} invulnerable`).toBe(frame.ship.invulnerable);
        expectShotsClose(shots, frame.shots);
      });
    });

    it('stays close to the recorded frames at the 1/120 simulation rate', () => {
      const ship = startShip(fixture);
      const loop = createFixedStepLoop();
      const replayed: { frame: number; shot: Shot }[] = [];

      fixture.frames.forEach((frame, index) => {
        const controls = controlsFor(frame.input);
        const steps = loop.advance(fixture.dt, (dt) => {
          for (const shot of stepShip(ship, controls, dt, fixture.field)) {
            replayed.push({ frame: index, shot });
          }
        });
        expect(steps, `frame ${String(index)} steps`).toBe(2);

        const label = `frame ${String(index)}`;
        expect(ship.invulnerable, `${label} invulnerable`).toBe(frame.ship.invulnerable);
        expect(Math.abs(ship.angle - frame.ship.angle), `${label} angle`).toBeLessThanOrEqual(1e-9);
        const speed = Math.hypot(ship.vx, ship.vy);
        const wantSpeed = Math.hypot(frame.ship.vx, frame.ship.vy);
        expect(Math.abs(speed - wantSpeed), `${label} speed`).toBeLessThanOrEqual(
          Math.max(0.01 * wantSpeed, 0.5),
        );
        expect(wrappedDistance(ship, frame.ship, fixture.field), `${label} position`).toBeLessThanOrEqual(2);
      });

      const recorded = fixture.frames.flatMap((frame, index) =>
        frame.shots.map((shot) => ({ frame: index, shot })),
      );
      expect(replayed).toHaveLength(recorded.length);
      recorded.forEach((want, i) => {
        const got = replayed[i];
        expect(got).toBeDefined();
        expect(Math.abs((got?.frame ?? Infinity) - want.frame), `shot ${String(i)} timing`).toBeLessThanOrEqual(1);
        expect(
          got ? wrappedDistance(got.shot, want.shot, fixture.field) : Infinity,
          `shot ${String(i)} position`,
        ).toBeLessThanOrEqual(2);
      });
    });
  });
});
