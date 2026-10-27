import type { AttackId, PaletteId } from '../../content/types';
import type { BossPart, BossView } from '../../sim/boss/behaviour';
import { nearestParts } from '../../sim/boss/turretRing';
import { LOCK_TURRETS, PULSE_RADIUS, WARDEN_RING } from '../../sim/boss/warden';
import { TAU } from '../../sim/math';
import { blitCore, partOffset, RIM_PAD, type BossFrame, type DrawerFactory } from './drawer';
import { PartClocks } from './partClocks';
import { BARREL_REACH, paintGhostRing, paintReticle, paintTrack, paintTurret, paintWardenCore, paintWardenEye, WARDEN_ART_REACH } from './wardenArt';

/** How long a regrown turret takes to grow to full size. */
const GROW_SECONDS = 0.4;
/** Turret sprites by damage, whole to one blow from breaking. */
const DAMAGE_STATES = 3;
/** Warnings pulse at this rate unless held still. */
const WARN_PULSE_HZ = 5;
/** A muzzle charging for a volley or a lock-on: its glow's diameter in turret radii, and how bright it ends. */
const MUZZLE_GLOW_SCALE = 3.2;
const MUZZLE_GLOW_ALPHA = 0.95;
/** The halo round a turret about to lock on, in turret radii across. */
const LOCK_GLOW_SCALE = 4.5;
/** How bright a warning starts as its windup begins, as a share of full. */
const CHARGE_FLOOR = 0.35;
/** The eye's bloom, dim between attacks, bright as one winds up. */
const EYE_IDLE = 0.35;
const EYE_WINDUP = 0.9;
const RETICLE_RADIUS = 22;
/** How far the track's sprite reaches past the ring: its gap markers and outline. */
const TRACK_PAD = 10;
/** How far past its radius the ghost ring's glow reaches. */
const GHOST_PAD = 14;

const SLOT = TAU / WARDEN_RING.slots;

/** The cache keys of the Warden's sprites, made once per size so drawing builds no strings. */
const coreKeys = (radius: number, palette: PaletteId) => ({
  core: `boss|${palette}|warden|core|${String(radius)}`,
  eye: `boss|${palette}|warden|eye|${String(radius)}`,
});
const turretKeys = (radius: number, palette: PaletteId): readonly string[] => Array.from({ length: DAMAGE_STATES }, (_, d) => `boss|${palette}|warden|turret|${String(d)}|${String(radius)}`);
const ringKeys = (palette: PaletteId) => ({
  track: `boss|${palette}|warden|track|${String(WARDEN_RING.radius)}`,
  ghost: `boss|${palette}|warden|ghost|${String(PULSE_RADIUS)}`,
  spin: `boss|${palette}|warden|spinBand|${String(WARDEN_RING.radius)}`,
  reticle: `boss|${palette}|warden|reticle`,
});

/** Which of a part's damage sprites shows: 0 whole, up to `DAMAGE_STATES - 1` one blow from breaking. */
const damageOf = (part: Readonly<BossPart>): number => Math.min(DAMAGE_STATES - 1, Math.max(0, part.maxHp - part.hp));

/**
 * The Warden: a steel sphere with one glowing eye, inside a ring of glossy turrets riding a track that is open across
 * its two gaps, a bright marker either side of each. Its warnings are its own shapes in their own colours on top of the
 * pass's closing ring: muzzles charging for a volley; the turrets about to lock on lit, with a reticle on the ship; a
 * hot band along the track before and through a spin; and a ghost ring where a pulse will sweep. Turrets crack as they
 * are hurt, flash white when hit and grow back in. Sprites are looked up by key as they are drawn.
 */
export const wardenDrawer: DrawerFactory = (kit) => {
  const { ctx, pen, baker, palette } = kit;
  const hostile = palette.accent[0];
  const spinColor = palette.accent[1];
  const pulseColor = palette.accent[2];
  const lockColor = palette.ring;
  const rings = ringKeys(palette.id);
  let radius = 0;
  let keys = coreKeys(radius, palette.id);
  let turretRadius = 0;
  let turrets = turretKeys(turretRadius, palette.id);
  const paintCoreAt = (c: CanvasRenderingContext2D): void => {
    paintWardenCore(c, radius, palette);
  };
  const paintEyeAt = (c: CanvasRenderingContext2D): void => {
    paintWardenEye(c, radius, palette);
  };
  const turretPainters = Array.from({ length: DAMAGE_STATES }, (_, d) => (c: CanvasRenderingContext2D): void => {
    paintTurret(c, turretRadius, palette, d);
  });
  const paintTrackAt = (c: CanvasRenderingContext2D): void => {
    paintTrack(c, WARDEN_RING.radius, WARDEN_RING.slots, WARDEN_RING.gaps, palette);
  };
  const paintGhostAt = (c: CanvasRenderingContext2D): void => {
    paintGhostRing(c, PULSE_RADIUS, pulseColor);
  };
  const paintSpinAt = (c: CanvasRenderingContext2D): void => {
    paintGhostRing(c, WARDEN_RING.radius, spinColor);
  };
  const paintReticleAt = (c: CanvasRenderingContext2D): void => {
    paintReticle(c, RETICLE_RADIUS, hostile);
  };
  const clocks = new PartClocks(GROW_SECONDS);
  /** A part's place from the core; one point, reused. */
  const offset = { x: 0, y: 0 };
  /** The turrets a lock-on winding up will fire from; reused. */
  const locking: number[] = [];
  let time = 0;
  /** The attack winding up and for how long, in real seconds. */
  let windup: AttackId | null = null;
  let windupClock = 0;

  /** How far the windup under way has come, 0 to 1, over its declared length. */
  const charge = (boss: Readonly<BossView>): number => Math.min(1, windupClock / (boss.threat?.windup ?? 1));
  /** A warning's flicker, steady under reduced motion. */
  const flicker = (still: boolean): number => (still ? 1 : 0.75 + 0.25 * Math.sin(time * TAU * WARN_PULSE_HZ));

  /** Places the pen on the ring about the core's interpolated centre, turned with the ring (`first`, its turret 0) and scaled by `scale`. */
  function placeRing(first: Readonly<BossPart>, frame: Readonly<BossFrame>, cx: number, cy: number, scale: number): void {
    const { x, y } = partOffset(first, frame, cx, cy, offset);
    // Turret 0 sits one slot on from slot 0, the first gap, which the track's art lays along +x.
    const turn = Math.atan2(y, x) - SLOT;
    const s = scale * frame.size;
    pen.place(frame.x, frame.y, Math.cos(turn) * s, Math.sin(turn) * s);
  }

  /** The track at the ring's radius in force, and the hot band of a spin over it while one winds up or runs. */
  function drawTrack(boss: Readonly<BossView>, first: Readonly<BossPart>, frame: Readonly<BossFrame>, cx: number, cy: number): void {
    placeRing(first, frame, cx, cy, Math.hypot(first.x - boss.x, first.y - boss.y) / WARDEN_RING.radius);
    pen.blit(baker.custom(rings.track, WARDEN_RING.radius + TRACK_PAD, paintTrackAt));
    const spinning = boss.windup === 'spin' || boss.active === 'spin';
    if (!spinning) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = frame.shown * (boss.active === 'spin' ? 1 : charge(boss)) * flicker(frame.look.still);
    pen.blit(baker.custom(rings.spin, WARDEN_RING.radius + GHOST_PAD, paintSpinAt));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = frame.shown;
  }

  /** A live turret, interpolated, about the core at its scale, its barrel outward, cracked by its damage, white when hit. */
  function drawTurret(part: Readonly<BossPart>, i: number, frame: Readonly<BossFrame>, cx: number, cy: number): void {
    if (part.radius !== turretRadius) {
      turretRadius = part.radius;
      turrets = turretKeys(turretRadius, palette.id);
    }
    const at = partOffset(part, frame, cx, cy, offset);
    const x = frame.x + at.x * frame.size;
    const y = frame.y + at.y * frame.size;
    const turn = Math.atan2(at.y, at.x);
    const scale = frame.size * clocks.grown(i);
    pen.place(x, y, Math.cos(turn) * scale, Math.sin(turn) * scale);
    const damage = damageOf(part);
    const key = turrets[damage] as string;
    const sprite = baker.custom(key, turretRadius * BARREL_REACH + RIM_PAD, turretPainters[damage] as (c: CanvasRenderingContext2D) => void);
    pen.blit(clocks.flashing(i) ? (baker.white(key) ?? sprite) : sprite);
  }

  /**
   * A charging glow of `color`, `diameter` across, `reach` out past turret `part`'s centre along its barrel, at `strength`
   * of full.
   */
  function drawCharging(part: Readonly<BossPart>, frame: Readonly<BossFrame>, cx: number, cy: number, reach: number, color: string, diameter: number, strength: number): void {
    const { x: dx, y: dy } = partOffset(part, frame, cx, cy, offset);
    const out = (Math.hypot(dx, dy) + reach) / Math.max(1, Math.hypot(dx, dy));
    ctx.globalAlpha = frame.shown * strength * frame.look.glow;
    pen.place(frame.x + dx * out * frame.size, frame.y + dy * out * frame.size, frame.size, 0);
    pen.blit(baker.glow(color, diameter));
  }

  /** The warnings over the ring: every muzzle charging for a volley, or the lock-on's turrets and the reticle on the ship. */
  function drawCharge(boss: Readonly<BossView>, first: Readonly<BossPart>, frame: Readonly<BossFrame>, cx: number, cy: number): void {
    const { parts } = boss;
    const still = frame.look.still;
    // Every warning shows from the windup's first frame, and brightens to full as it nears.
    const strength = (CHARGE_FLOOR + (1 - CHARGE_FLOOR) * charge(boss)) * flicker(still);
    ctx.globalCompositeOperation = 'lighter';
    if (boss.windup === 'turretVolley') {
      for (const part of parts) if (part.hp > 0) drawCharging(part, frame, cx, cy, part.radius * BARREL_REACH, hostile, part.radius * MUZZLE_GLOW_SCALE, strength * MUZZLE_GLOW_ALPHA);
    } else if (boss.windup === 'lockOn') {
      for (const i of nearestParts(parts, frame.look.aimX, frame.look.aimY, LOCK_TURRETS, locking)) {
        const part = parts[i] as BossPart;
        drawCharging(part, frame, cx, cy, 0, lockColor, part.radius * LOCK_GLOW_SCALE, strength);
        drawCharging(part, frame, cx, cy, part.radius * BARREL_REACH, hostile, part.radius * MUZZLE_GLOW_SCALE, strength * MUZZLE_GLOW_ALPHA);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = frame.shown * strength;
      const spin = still ? 0 : time * 2;
      pen.place(frame.look.aimX, frame.look.aimY, Math.cos(spin), Math.sin(spin));
      pen.blit(baker.custom(rings.reticle, RETICLE_RADIUS * 1.3 + RIM_PAD, paintReticleAt));
    } else if (boss.windup === 'ringPulse') {
      ctx.globalAlpha = frame.shown * strength;
      placeRing(first, frame, cx, cy, 1);
      pen.blit(baker.custom(rings.ghost, PULSE_RADIUS + GHOST_PAD, paintGhostAt));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = frame.shown;
  }

  return {
    glow: palette.accent[1],
    body(boss, frame) {
      const { x, y, size, shown, look } = frame;
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        keys = coreKeys(r, palette.id);
      }
      // Parts are placed about the core's own interpolated centre, so they keep their ring as it scales.
      const cx = boss.px + (boss.x - boss.px) * frame.alpha;
      const cy = boss.py + (boss.y - boss.py) * frame.alpha;
      const first = boss.parts[0];
      if (first !== undefined) drawTrack(boss, first, frame, cx, cy);
      pen.place(x, y, size, 0);
      blitCore(kit, keys.core, r * WARDEN_ART_REACH + RIM_PAD, paintCoreAt, frame.tinted);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shown * look.glow * (boss.windup === null ? EYE_IDLE : EYE_WINDUP * flicker(look.still));
      pen.blit(baker.custom(keys.eye, r + RIM_PAD, paintEyeAt));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = shown;
      const { parts } = boss;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as BossPart;
        if (part.hp > 0) drawTurret(part, i, frame, cx, cy);
      }
      if (first !== undefined && boss.state === 'fighting') drawCharge(boss, first, frame, cx, cy);
    },
    advance(dt, boss) {
      time += dt;
      windupClock = boss.windup === windup ? windupClock + dt : 0;
      windup = boss.windup;
      clocks.advance(dt, boss.parts);
    },
    handle(event) {
      clocks.handle(event);
    },
    reset() {
      time = 0;
      windup = null;
      windupClock = 0;
      clocks.reset();
    },
  };
};
