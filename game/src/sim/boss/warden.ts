import { BOLT } from '../../content/foes';
import { outAndBack } from '../math';
import { aimedBolts, crosses, radialBolts } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossSetup } from './behaviour';
import { nearestParts, TurretRing, type TurretRingOptions } from './turretRing';

/**
 * The Warden's ring: 14 turrets of 3 HP on 16 slots at radius 120, slots 0 and 8 left open as its two gaps, turning
 * faster each phase and growing a turret back every 8 s.
 */
export const WARDEN_RING: TurretRingOptions = {
  slots: 16,
  gaps: [0, 8],
  radius: 120,
  turretRadius: 16,
  hp: 3,
  speeds: { 1: 0.35, 2: 0.5, 3: 0.65 },
  regrowSeconds: 8,
};
const DRIFT_SPEED = 10;

/** Phase 3's volley fires again this long after the first. */
export const VOLLEY_REPEAT = 0.3;
/** How long a volley runs: past its repeat by a beat, so the second volley lands inside it. */
const VOLLEY_SECONDS = 0.4;
/** A lock-on fires from this many of the turrets nearest the ship, this many bolts each, fanned across this many radians. */
export const LOCK_TURRETS = 2;
export const LOCK_BOLTS = 3;
const LOCK_SPREAD = 0.3;
/**
 * How far either side of the line from the core to where the ship was the lock-on reaches, declared to the bots: its fan's
 * half-width about 235 units out from the turret that fires it, plus a bolt.
 */
const LOCK_REACH = Math.sin(LOCK_SPREAD / 2) * 235 + BOLT.radius;
/** A spin turns the ring backward at this multiple of its speed, for this long. */
export const SPIN_FACTOR = 2;
export const SPIN_SECONDS = 2;
/** A ring pulse eases the ring out to this radius and back over this long. */
export const PULSE_RADIUS = 220;
export const PULSE_SECONDS = 2.4;

/** The Warden's windups, in seconds. */
const WINDUPS = { turretVolley: 0.6, lockOn: 0.7, spin: 0.5, ringPulse: 0.7 } as const;
export type WardenAttack = keyof typeof WINDUPS;

/**
 * The Warden, Dimension 3's boss: a small core inside a `TurretRing` with two gaps to shoot and fly through. The core
 * can always be hurt, but a shot strikes the first turret it meets, and the ring and core kill a ship that touches
 * them. Its turrets fire bolts outward in volleys and lock on to the ship in pairs; the ring spins back on itself and
 * pulses outward through the space around it.
 */
class Warden implements BossBehaviour {
  readonly driftSpeed = DRIFT_SPEED;
  /** Its ring turns and stretches about the core but moves with it, so the drift keeps the whole ring inside the field. */
  readonly rigidParts = true;
  readonly reach: number;
  readonly parts: readonly BossPart[];
  readonly attacks: Readonly<Record<WardenAttack, AttackSpec>>;
  private readonly ring: TurretRing;
  /** The turrets a lock-on fires from; reused. */
  private readonly locked: number[] = [];

  constructor(setup: BossSetup) {
    const ring = new TurretRing(WARDEN_RING, setup);
    const { radius, turretRadius } = WARDEN_RING;
    this.ring = ring;
    this.parts = ring.parts;
    this.reach = ring.reach;
    this.attacks = {
      turretVolley: { windup: WINDUPS.turretVolley, active: VOLLEY_SECONDS, run: (ctx) => { this.volley(ctx); } },
      lockOn: { windup: WINDUPS.lockOn, active: 0, run: (ctx) => { this.lockOn(ctx); }, threat: { kind: 'lane', reach: LOCK_REACH } },
      spin: {
        windup: WINDUPS.spin,
        active: SPIN_SECONDS,
        run: () => { ring.turn(-SPIN_FACTOR); },
        threat: { kind: 'ring', radius, reach: turretRadius, around: 'core' },
      },
      ringPulse: {
        windup: WINDUPS.ringPulse,
        active: PULSE_SECONDS,
        run: (ctx) => { ring.stretch(radius + (PULSE_RADIUS - radius) * outAndBack(Math.min(1, (ctx.age + ctx.dt) / PULSE_SECONDS))); },
        // The band the turrets sweep, from the ring's own radius out to the pulse's and back.
        threat: { kind: 'ring', radius: (radius + PULSE_RADIUS) / 2, reach: (PULSE_RADIUS - radius) / 2 + turretRadius, around: 'core' },
      },
    };
  }

  step(ctx: AttackContext): void {
    this.ring.step(ctx);
  }

  /** Every live turret fires one bolt outward as the volley starts, and in phase 3 again `VOLLEY_REPEAT` later. */
  private volley(ctx: AttackContext): void {
    if (crosses(ctx, 0) || (ctx.boss.phase === 3 && crosses(ctx, VOLLEY_REPEAT))) radialBolts(ctx, this.parts);
  }

  /** The `LOCK_TURRETS` live turrets nearest the ship each fire `LOCK_BOLTS` bolts at where it was as the windup began. */
  private lockOn(ctx: AttackContext): void {
    const { ship } = ctx.arena;
    for (const i of nearestParts(this.parts, ship.x, ship.y, LOCK_TURRETS, this.locked)) aimedBolts(ctx, this.parts[i] as BossPart, LOCK_BOLTS, LOCK_SPREAD);
  }
}

/** The Warden's behaviour, with its attacks spelled out. */
export type WardenBehaviour = BossBehaviour & { readonly attacks: Readonly<Record<WardenAttack, AttackSpec>> };

/** Makes the Warden for one fight: its ring's bearing is drawn from the fight's stream. */
export const createWarden = (setup: BossSetup): WardenBehaviour => new Warden(setup);
