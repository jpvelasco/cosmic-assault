import { describe, expect, it } from 'vitest';
import { PLAYER, WEAPON_SPREAD, WRAP_MARGIN } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import { createFixedStepLoop } from '../../src/sim/loop';
import { createShip, respawnShip, stepShip, thrustCompensation, type Ship } from '../../src/sim/ship';
import { weaponFor } from '../../src/sim/pickups/volley';
import { wrapPosition } from '../../src/sim/wrap';

const NO_EFFECTS = { doubleShot: false, rapidFire: false, spreadLaser: false };

const FIELD: Field = { width: 1280, height: 720 };
const DT = 1 / 60;

function idleShip(x = 640, y = 360): Ship {
  const ship = createShip(x, y);
  ship.invulnerable = false;
  ship.invulnerableFor = 0;
  return ship;
}

function withControls(overrides: Partial<Controls>): Controls {
  return { ...NO_CONTROLS, ...overrides };
}

function turnThrustAt(seconds: number): Controls {
  return withControls({ turn: -1, thrust: seconds >= 1 });
}

function runTurnThrust(frameSeconds: number, totalSeconds: number): Ship {
  const ship = idleShip();
  const loop = createFixedStepLoop();
  const frames = Math.round(totalSeconds / frameSeconds);
  for (let frame = 0; frame < frames; frame++) {
    const controls = turnThrustAt(frame * frameSeconds);
    loop.advance(frameSeconds, (dt) => {
      stepShip(ship, controls, dt, FIELD);
    });
  }
  return ship;
}

describe('createShip', () => {
  it('faces up and is invulnerable for 3 seconds', () => {
    const ship = createShip(10, 20);
    expect(ship).toMatchObject({
      x: 10,
      y: 20,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      thrusting: false,
      invulnerable: true,
      invulnerableFor: PLAYER.invulnerableSeconds,
      fireCooldown: 0,
    });
  });
});

describe('stepShip', () => {
  it('ends within 2 px regardless of frame rate (30, 60 and 144 fps)', () => {
    const [a, b, c] = [1 / 30, 1 / 60, 1 / 144].map((frame) => runTurnThrust(frame, 3));
    for (const [p, q] of [
      [a, b],
      [a, c],
      [b, c],
    ] as const) {
      expect(p).toBeDefined();
      expect(Math.hypot((p?.x ?? Infinity) - (q?.x ?? 0), (p?.y ?? Infinity) - (q?.y ?? 0))).toBeLessThanOrEqual(2);
    }
  });

  it('gives no thrust inside the stick dead zone and keeps the angle', () => {
    const ship = idleShip();
    const shots = stepShip(ship, withControls({ stick: { angle: 1, distance: 10 } }), DT, FIELD);
    expect(shots).toHaveLength(0);
    expect(ship.thrusting).toBe(false);
    expect(ship.angle).toBe(-Math.PI / 2);
    expect(ship.vx).toBe(0);
    expect(ship.vy).toBe(0);
  });

  it('ignores keyboard turn and thrust while a stick is present', () => {
    const ship = idleShip();
    stepShip(ship, withControls({ turn: 1, thrust: true, stick: { angle: 1, distance: 5 } }), DT, FIELD);
    expect(ship.angle).toBe(-Math.PI / 2);
    expect(ship.thrusting).toBe(false);
    expect(ship.vx).toBe(0);
    expect(ship.vy).toBe(0);
  });

  it('steers to the stick angle and scales thrust by distance', () => {
    const half = idleShip();
    const full = idleShip();
    stepShip(half, withControls({ stick: { angle: 0, distance: 30 } }), DT, FIELD);
    stepShip(full, withControls({ stick: { angle: 0, distance: 60 } }), DT, FIELD);
    expect(half.angle).toBe(0);
    expect(half.thrusting).toBe(true);
    expect(half.vx / full.vx).toBeCloseTo(0.5 * (0.985 / 0.99), 9);
  });

  it.each([
    [30, 0.985],
    [90, 0.99],
    [500, 0.99],
  ])('applies per-frame drag %#: stick distance %f gives %f', (distance, expectedDrag) => {
    const ship = idleShip();
    ship.vx = 100;
    // Thrust along +y so vx only feels drag.
    stepShip(ship, withControls({ stick: { angle: Math.PI / 2, distance } }), DT, FIELD);
    expect(ship.vx).toBeCloseTo(100 * expectedDrag, 9);
  });

  it('uses the base drag without a stick', () => {
    const ship = idleShip();
    ship.vx = 100;
    stepShip(ship, NO_CONTROLS, DT, FIELD);
    expect(ship.vx).toBeCloseTo(98, 9);
  });

  it('turns by turnSpeed * dt and thrusts along the angle', () => {
    const ship = idleShip();
    stepShip(ship, withControls({ turn: 1, thrust: true }), DT, FIELD);
    expect(ship.angle).toBeCloseTo(-Math.PI / 2 + PLAYER.turnSpeed * DT, 12);
    expect(ship.thrusting).toBe(true);
    expect(ship.vy).toBeLessThan(0);
  });

  it('caps speed at 350 even when started far above it (ruling R8)', () => {
    const ship = idleShip();
    ship.vx = 400;
    ship.vy = 300;
    stepShip(ship, NO_CONTROLS, DT, FIELD);
    expect(Math.hypot(ship.vx, ship.vy)).toBeCloseTo(PLAYER.maxSpeed, 9);
  });

  it('clears invulnerability once the timer runs out', () => {
    const ship = createShip(640, 360);
    let steps = 0;
    while (ship.invulnerable) {
      stepShip(ship, NO_CONTROLS, DT, FIELD);
      steps++;
    }
    expect(steps).toBe(181);
    expect(ship.invulnerableFor).toBeLessThanOrEqual(0);
  });

  it('returns a shared frozen empty array when nothing fires', () => {
    const first = stepShip(idleShip(), NO_CONTROLS, DT, FIELD);
    const second = stepShip(idleShip(), NO_CONTROLS, DT, FIELD);
    expect(first).toHaveLength(0);
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).toBe(first);
  });

  it('fires one shot from the nose, then waits out the cooldown', () => {
    const ship = idleShip();
    const fire = withControls({ fire: true });
    const [shot] = stepShip(ship, fire, DT, FIELD);
    expect(shot?.x).toBeCloseTo(640, 9);
    expect(shot?.y).toBeCloseTo(360 - PLAYER.noseOffset, 9);
    expect(shot?.vy).toBeCloseTo(-PLAYER.projectileSpeed, 9);
    expect(ship.fireCooldown).toBe(PLAYER.fireInterval);
    expect(stepShip(ship, fire, DT, FIELD)).toHaveLength(0);
  });

  it('fires a shot per spread offset for every weapon tier', () => {
    for (const tier of [0, 1, 2, 3] as const) {
      const ship = idleShip();
      ship.vx = 20;
      const shots = stepShip(ship, withControls({ fire: true }), DT, FIELD, weaponFor(tier, NO_EFFECTS));
      const offsets = WEAPON_SPREAD[tier] ?? [];
      expect(shots).toHaveLength(offsets.length);
      offsets.forEach((offset, i) => {
        const angle = -Math.PI / 2 + offset;
        expect(shots[i]?.vx).toBeCloseTo(20 * 0.5 + Math.cos(angle) * PLAYER.projectileSpeed, 6);
        expect(shots[i]?.vy).toBeCloseTo(Math.sin(angle) * PLAYER.projectileSpeed, 6);
      });
    }
    expect(WEAPON_SPREAD[3]).toHaveLength(5);
  });
});

describe('thrustCompensation', () => {
  it('is exactly 1 at the reference 1/60 s step and for drag-free flight', () => {
    expect(thrustCompensation(0.98, 1 / 60)).toBe(1);
    expect(thrustCompensation(0.99, 1 / 60)).toBe(1);
    expect(thrustCompensation(1, 1 / 120)).toBe(1);
  });

  it.each([
    ['keyboard', withControls({ thrust: true })],
    ['stick at distance 90 (drag relieved to 0.99)', withControls({ stick: { angle: 0, distance: 90 } })],
  ])('gives the same 5 s of %s speed as 1/60 at any step size', (_name, controls) => {
    const speedAfter = (step: number): number => {
      const ship = idleShip();
      ship.angle = 0;
      const steps = Math.round(5 / step);
      for (let i = 0; i < steps; i++) {
        stepShip(ship, controls, step, { width: 1e9, height: 1e9 });
      }
      return ship.vx;
    };
    expect(speedAfter(1 / 120)).toBeCloseTo(speedAfter(1 / 60), 9);
    expect(speedAfter(1 / 144)).toBeCloseTo(speedAfter(1 / 60), 9);
  });

  it('is 1 for a zero-length step so velocity stays finite', () => {
    expect(thrustCompensation(0.98, 0)).toBe(1);
    const ship = idleShip();
    ship.vx = 12;
    ship.vy = -7;
    stepShip(ship, withControls({ thrust: true }), 0, FIELD);
    expect(ship.vx).toBe(12);
    expect(ship.vy).toBe(-7);
  });
});

describe('firing while moving', () => {
  it('uses the pre-physics position and half the post-thrust, pre-drag velocity', () => {
    const ship = idleShip(100, 200);
    ship.angle = 0.5;
    ship.vx = 30;
    ship.vy = -40;
    const [shot] = stepShip(ship, withControls({ thrust: true, fire: true }), DT, FIELD);

    const thrustedVx = 30 + Math.cos(0.5) * PLAYER.thrust * DT;
    const thrustedVy = -40 + Math.sin(0.5) * PLAYER.thrust * DT;
    expect(shot?.x).toBeCloseTo(100 + Math.cos(0.5) * PLAYER.noseOffset, 9);
    expect(shot?.y).toBeCloseTo(200 + Math.sin(0.5) * PLAYER.noseOffset, 9);
    expect(shot?.vx).toBeCloseTo(thrustedVx * 0.5 + Math.cos(0.5) * PLAYER.projectileSpeed, 9);
    expect(shot?.vy).toBeCloseTo(thrustedVy * 0.5 + Math.sin(0.5) * PLAYER.projectileSpeed, 9);
    expect(ship.x).not.toBeCloseTo(100, 1);
  });
});

describe('fire cadence', () => {
  it.each([
    [1 / 60, 19],
    [1 / 120, 38],
  ])('fires every 19/60 s: dt %f takes %i steps between shots', (dt, expectedSteps) => {
    const ship = idleShip();
    const fire = withControls({ fire: true });
    expect(stepShip(ship, fire, dt, FIELD)).toHaveLength(1);
    let steps = 0;
    do {
      steps++;
    } while (stepShip(ship, fire, dt, FIELD).length === 0 && steps < 100);
    expect(steps).toBe(expectedSteps);
  });
});

describe('respawnShip', () => {
  it('centres the ship, zeroes velocity and grants 3 seconds of invulnerability', () => {
    const ship = idleShip(5, 6);
    ship.vx = 50;
    ship.vy = -70;
    respawnShip(ship, FIELD);
    expect(ship).toMatchObject({
      x: 640,
      y: 360,
      vx: 0,
      vy: 0,
      invulnerable: true,
      invulnerableFor: PLAYER.invulnerableSeconds,
    });
  });
});

describe('wrapPosition', () => {
  it('wraps past the margin to the opposite margin on each axis', () => {
    const p = { x: FIELD.width + WRAP_MARGIN + 1, y: -WRAP_MARGIN - 1 };
    wrapPosition(p, FIELD);
    expect(p).toEqual({ x: -WRAP_MARGIN, y: FIELD.height + WRAP_MARGIN });
    const q = { x: -WRAP_MARGIN - 1, y: FIELD.height + WRAP_MARGIN + 1 };
    wrapPosition(q, FIELD);
    expect(q).toEqual({ x: FIELD.width + WRAP_MARGIN, y: -WRAP_MARGIN });
  });

  it('leaves positions on or inside the margin alone', () => {
    const p = { x: FIELD.width + WRAP_MARGIN, y: -WRAP_MARGIN };
    wrapPosition(p, FIELD);
    expect(p).toEqual({ x: FIELD.width + WRAP_MARGIN, y: -WRAP_MARGIN });
  });

  it('honours a custom margin', () => {
    const p = { x: -6, y: 0 };
    wrapPosition(p, FIELD, 5);
    expect(p).toEqual({ x: FIELD.width + 5, y: 0 });
  });
});
