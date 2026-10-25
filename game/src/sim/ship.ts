import { PLAYER, STICK, WEAPON_SPREAD } from './config';
import type { Controls, Stick } from './controls';
import type { Field } from './field';
import { wrapPosition } from './wrap';

export interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrusting: boolean;
  invulnerable: boolean;
  invulnerableFor: number;
  fireCooldown: number;
  tier: 1 | 2 | 3 | 4;
}

export interface Shot {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

const NO_SHOTS: readonly Shot[] = Object.freeze([]);
const FRAMES_PER_SECOND_REFERENCE = 60;
const COOLDOWN_EPSILON = 1e-9;

export function createShip(x: number, y: number): Ship {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    thrusting: false,
    invulnerable: true,
    invulnerableFor: PLAYER.invulnerableSeconds,
    fireCooldown: 0,
    tier: 1,
  };
}

export function respawnShip(ship: Ship, field: Field): void {
  ship.x = field.width / 2;
  ship.y = field.height / 2;
  ship.vx = 0;
  ship.vy = 0;
  ship.invulnerable = true;
  ship.invulnerableFor = PLAYER.invulnerableSeconds;
}

/**
 * Scales per-step thrust so any step size follows the same per-1/60 s linear
 * map (thrust then drag) as the live 60 Hz game; exactly 1 at dt = 1/60.
 */
export function thrustCompensation(
  drag: number,
  dt: number,
  perStepDrag: number = Math.pow(drag, FRAMES_PER_SECOND_REFERENCE * dt),
): number {
  const frames = FRAMES_PER_SECOND_REFERENCE * dt;
  if (drag >= 1 || frames <= 0) {
    return 1;
  }
  return (drag * (1 - perStepDrag)) / (frames * perStepDrag * (1 - drag));
}

function thrustAlong(ship: Ship, magnitude: number, compensation: number, dt: number): void {
  ship.vx += Math.cos(ship.angle) * PLAYER.thrust * magnitude * compensation * dt;
  ship.vy += Math.sin(ship.angle) * PLAYER.thrust * magnitude * compensation * dt;
}

function steerWithStick(ship: Ship, stick: Stick, compensation: number, dt: number): void {
  if (stick.distance <= STICK.deadZone) {
    return;
  }
  ship.angle = stick.angle;
  ship.thrusting = true;
  thrustAlong(ship, Math.min(stick.distance / STICK.fullThrust, 1), compensation, dt);
}

function steerWithKeyboard(ship: Ship, controls: Controls, compensation: number, dt: number): void {
  ship.angle += PLAYER.turnSpeed * dt * controls.turn;
  if (controls.thrust) {
    ship.thrusting = true;
    thrustAlong(ship, 1, compensation, dt);
  }
}

function fireShots(ship: Ship): readonly Shot[] {
  ship.fireCooldown = PLAYER.fireInterval;
  const x = ship.x + Math.cos(ship.angle) * PLAYER.noseOffset;
  const y = ship.y + Math.sin(ship.angle) * PLAYER.noseOffset;
  const baseVx = ship.vx * PLAYER.inheritVelocity;
  const baseVy = ship.vy * PLAYER.inheritVelocity;
  return (WEAPON_SPREAD[ship.tier - 1] ?? []).map((offset) => ({
    x,
    y,
    vx: baseVx + Math.cos(ship.angle + offset) * PLAYER.projectileSpeed,
    vy: baseVy + Math.sin(ship.angle + offset) * PLAYER.projectileSpeed,
  }));
}

/** Per-reference-frame (60 Hz) drag, relieved while a stick pushes the ship. */
function dragPerFrame(stick: Stick | null): number {
  const base = PLAYER.dragPerFrame60;
  if (stick === null || stick.distance <= STICK.deadZone) {
    return base;
  }
  const relief = Math.min(stick.distance / STICK.fullDragRelief, STICK.maxDragReliefFactor);
  return Math.min(base + relief * (1 - base), STICK.maxDrag);
}

function applyPhysics(ship: Ship, stepDrag: number, dt: number): void {
  ship.vx *= stepDrag;
  ship.vy *= stepDrag;

  const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  if (speed > PLAYER.maxSpeed) {
    const scale = PLAYER.maxSpeed / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
}

export function stepShip(ship: Ship, controls: Controls, dt: number, field: Field): readonly Shot[] {
  if (ship.invulnerable) {
    ship.invulnerableFor -= dt;
    if (ship.invulnerableFor <= 0) {
      ship.invulnerable = false;
    }
  }
  if (ship.fireCooldown > 0) {
    ship.fireCooldown -= dt;
  }

  const frameDrag = dragPerFrame(controls.stick);
  const stepDrag = Math.pow(frameDrag, FRAMES_PER_SECOND_REFERENCE * dt);
  const compensation = thrustCompensation(frameDrag, dt, stepDrag);
  ship.thrusting = false;
  if (controls.stick === null) {
    steerWithKeyboard(ship, controls, compensation, dt);
  } else {
    steerWithStick(ship, controls.stick, compensation, dt);
  }

  const shots = controls.fire && ship.fireCooldown <= COOLDOWN_EPSILON ? fireShots(ship) : NO_SHOTS;

  applyPhysics(ship, stepDrag, dt);
  wrapPosition(ship, field);
  return shots;
}
