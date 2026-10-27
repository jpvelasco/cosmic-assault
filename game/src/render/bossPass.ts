import type { AttackId, BossId, PaletteId } from '../content/types';
import type { BossState, BossView } from '../sim/boss/behaviour';
import { DYING_SECONDS } from '../sim/boss/bossRunner';
import type { SimEvent } from '../sim/events';
import { TAU } from '../sim/math';
import { createAimLine } from './boss/aimLine';
import { radial, type BossDrawer, type BossFrame, type BossLook, type DrawerFactory } from './boss/drawer';
import { hiveCarrierDrawer } from './boss/hiveCarrier';
import { leviathanDrawer } from './boss/leviathan';
import { monolithDrawer } from './boss/monolith';
import { sentinelDrawer } from './boss/sentinel';
import { wardenDrawer } from './boss/warden';
import { mix, rgba } from './color';
import type { FieldPen } from './fieldPen';
import { HIT_FLASH_SECONDS } from './hitFlash';
import type { Palette } from './palette';
import { easeOut } from './scene';
import type { SpriteBaker } from './sprites';

export type { BossLook } from './boss/drawer';

/** How long the glow flashes white after a hit. The core itself shows white for its first HIT_FLASH_SECONDS. */
export const BOSS_FLASH_SECONDS = 0.12;

export interface BossPass {
  /** A `bossHit` flashes the core; the boss's drawer hears every event too (a `bossPartHit` flashes the part it struck). */
  handle(events: readonly SimEvent[]): void;
  /**
   * Advances the flash, the clocks of the boss's state and attack, and its drawer, by `dt` seconds of real time, and the
   * windup's clock by the boss's own time, which runs at `timeScale` of real time (Time Warp slows it).
   */
  advance(dt: number, boss: Readonly<BossView> | null, timeScale?: number): void;
  /**
   * Draws the boss `alpha` of the way from its previous position: glow, windup ring or shockwave, its drawer's body, and
   * hit flash. Expects the field pen aimed for the frame and `source-over`, which it leaves as it found them, with alpha 1.
   */
  draw(boss: Readonly<BossView> | null, alpha: number, look: BossLook): void;
  /** How bright the hit flash is now, 1 just after a hit down to 0. */
  readonly flash: number;
  /** Forgets the last fight, for a new run. */
  reset(): void;
}

/** Each boss's look. */
const DRAWERS: Readonly<Record<BossId, DrawerFactory>> = { sentinel: sentinelDrawer, monolith: monolithDrawer, hiveCarrier: hiveCarrierDrawer, warden: wardenDrawer, leviathan: leviathanDrawer };

const WHITE = '#ffffff';
/** The core shows white while the flash is above this, the share of BOSS_FLASH_SECONDS left after HIT_FLASH_SECONDS. */
const TINT_ABOVE = 1 - HIT_FLASH_SECONDS / BOSS_FLASH_SECONDS;
const INTRO_FADE_SECONDS = 0.8;
const GLOW_SCALE = 3.2;
const GLOW_ALPHA = 0.4;
const FLASH_SCALE = 2.4;
const FLASH_ALPHA = 0.75;
/** The ring's outer edge, as a multiple of the core radius. */
const RING_REACH = 1.6;
/** The ring closes in from this much larger as a windup starts, so its shrinking tells when the attack lands. */
const RING_CLOSE = 0.35;
const RING_CLOSE_SECONDS = 0.5;
const RING_PULSE_HZ = 6;
/** The pulse's shockwave: from the windup ring's size out to this many times it, over the pulse. */
const SHOCKWAVE_REACH = 3.4;
const SHOCKWAVE_SECONDS = 0.3;

/** A soft band of `color` around the core, brightest just outside it. */
function paintRing(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  const outer = r * RING_REACH;
  const inner = r / outer;
  ctx.fillStyle = radial(ctx, 0, 0, 0, outer, [
    [inner * 0.94, rgba(color, 0)],
    [inner + (1 - inner) * 0.22, rgba(color, 0.9)],
    [inner + (1 - inner) * 0.5, rgba(color, 0.35)],
    [1, rgba(color, 0)],
  ]);
  ctx.fillRect(-outer, -outer, outer * 2, outer * 2);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.12, 0, TAU);
  ctx.strokeStyle = rgba(mix(color, WHITE, 0.5), 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Every attack, once: the `satisfies` makes a new one fail to compile until it is listed. */
const ATTACK_ID_SET = { shardRing: 0, lunge: 0, shardVolley: 0, quake: 0, pulse: 0, launch: 0, broadside: 0, retreat: 0, turretVolley: 0, lockOn: 0, spin: 0, ringPulse: 0, dive: 0, spit: 0, coil: 0 } as const satisfies Record<AttackId, 0>;
const ATTACK_IDS = Object.keys(ATTACK_ID_SET) as AttackId[];

/** A record of `make(id)` for every attack. */
function perAttack<T>(make: (id: AttackId) => T): Record<AttackId, T> {
  return Object.fromEntries(ATTACK_IDS.map((id) => [id, make(id)])) as Record<AttackId, T>;
}

/** The cache keys of the windup rings at `radius`, made once per radius so drawing builds no strings. */
const ringKeys = (radius: number, palette: PaletteId): Record<AttackId, string> => perAttack((id) => `boss|${palette}|ring|${id}|${String(radius)}`);

/**
 * Draws the boss from baked sprites (no `shadowBlur`): what every boss shares (a glow, a closing ring while an attack
 * winds up, a shockwave as it pulses, an aim line as it winds up a dive, and a white flash on each hit, the core's
 * silhouette for 60 ms with a glow that lingers), and its body through its own drawer (`render/boss/`), looked up by its
 * id. The boss fades in through the intro and out, whitening, as it dies. Sprite keys and painters are made once per
 * radius, so a frame of drawing builds no strings or closures.
 */
export function createBossPass(ctx: CanvasRenderingContext2D, pen: FieldPen, baker: SpriteBaker, palette: Palette): BossPass {
  const kit = { ctx, pen, baker, palette };
  const drawers = Object.fromEntries(Object.entries(DRAWERS).map(([id, make]) => [id, make(kit)])) as Record<BossId, BossDrawer>;
  const allDrawers = Object.values(drawers);
  const aimLine = createAimLine(kit);
  const ringColors: Readonly<Record<AttackId, string>> = {
    shardRing: palette.shot,
    lunge: palette.ring,
    shardVolley: palette.accent[0],
    quake: palette.ring,
    pulse: palette.accent[2],
    launch: palette.accent[0],
    broadside: palette.ring,
    retreat: palette.accent[2],
    turretVolley: palette.accent[0],
    lockOn: palette.ring,
    spin: palette.spark,
    ringPulse: palette.accent[2],
    dive: palette.accent[0],
    spit: palette.accent[2],
    coil: palette.ring,
  };
  /** The radius the rings are keyed and painted for; a boss keeps one, so they are made once a fight. */
  let radius = 0;
  let rings = ringKeys(radius, palette.id);
  const ringPainters = perAttack((attack) => (c: CanvasRenderingContext2D): void => {
    paintRing(c, radius, ringColors[attack]);
  });
  const frame: BossFrame = { x: 0, y: 0, size: 1, shown: 1, alpha: 1, tinted: false, windupAge: 0, look: { glow: 1, still: false, aimX: 0, aimY: 0, field: { width: 0, height: 0 } } };
  let flash = 0;
  let state: BossState | null = null;
  let stateClock = 0;
  let windup: AttackId | null = null;
  let windupClock = 0;
  let active: AttackId | null = null;
  let activeClock = 0;

  /** How visible the core is: fading in through the intro, out through dying. */
  function presence(current: BossState): number {
    if (current !== state) return current === 'intro' ? 0 : 1;
    if (current === 'intro') return easeOut(Math.min(1, stateClock / INTRO_FADE_SECONDS));
    return current === 'dying' ? Math.max(0, 1 - stateClock / DYING_SECONDS) : 1;
  }

  function blitRing(attack: AttackId, r: number, size: number): void {
    pen.place(frame.x, frame.y, size, 0);
    pen.blit(baker.custom(rings[attack], r * RING_REACH, ringPainters[attack]));
  }

  function drawRing(attack: AttackId, r: number, still: boolean): void {
    const closing = Math.max(0, 1 - windupClock / RING_CLOSE_SECONDS);
    ctx.globalAlpha = still ? 0.85 : (0.7 + 0.3 * Math.sin(windupClock * TAU * RING_PULSE_HZ)) * (1 - 0.5 * closing);
    blitRing(attack, r, still ? 1.1 : 1 + RING_CLOSE * closing);
  }

  /** The pulse's ring racing outward and fading; held at one size, dimmer, under reduced motion. */
  function drawShockwave(r: number, still: boolean): void {
    const t = Math.min(1, activeClock / SHOCKWAVE_SECONDS);
    ctx.globalAlpha = frame.shown * (still ? 0.5 : 1 - t);
    blitRing('pulse', r, still ? SHOCKWAVE_REACH / 2 : 1 + (SHOCKWAVE_REACH - 1) * easeOut(t));
  }

  return {
    handle(events) {
      for (const event of events) {
        if (event.type === 'bossHit') flash = 1;
        for (const drawer of allDrawers) drawer.handle?.(event);
      }
    },
    advance(dt, boss, timeScale = 1) {
      flash = Math.max(0, flash - dt / BOSS_FLASH_SECONDS);
      if (boss === null) {
        state = null;
        windup = null;
        active = null;
        return;
      }
      stateClock = boss.state === state ? stateClock + dt : 0;
      state = boss.state;
      windupClock = boss.windup === windup ? windupClock + dt * timeScale : 0;
      windup = boss.windup;
      activeClock = boss.active === active ? activeClock + dt : 0;
      active = boss.active;
      drawers[boss.id].advance?.(dt, boss);
    },
    draw(boss, alpha, look) {
      if (boss === null || boss.state === 'down') return;
      const drawer = drawers[boss.id];
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        rings = ringKeys(r, palette.id);
      }
      const shown = presence(boss.state);
      const dying = boss.state === 'dying' && boss.state === state ? stateClock / DYING_SECONDS : 0;
      frame.x = boss.px + (boss.x - boss.px) * alpha;
      frame.y = boss.py + (boss.y - boss.py) * alpha;
      frame.size = boss.state === 'intro' ? 0.7 + 0.3 * shown : 1 + 0.12 * dying;
      frame.shown = shown;
      frame.alpha = alpha;
      frame.tinted = flash > TINT_ABOVE;
      frame.windupAge = boss.windup !== null && boss.windup === windup ? windupClock : 0;
      frame.look = look;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = GLOW_ALPHA * look.glow * shown;
      pen.place(frame.x, frame.y, frame.size, 0);
      pen.blit(baker.glow(drawer.glow, r * GLOW_SCALE));
      drawer.underglow?.(boss, frame);
      if (boss.windup !== null) drawRing(boss.windup, r, look.still);
      if (boss.active === 'pulse' && active === 'pulse') drawShockwave(r, look.still);
      aimLine.draw(boss, frame, frame.windupAge);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = shown;
      drawer.body(boss, frame);
      const white = Math.max(flash * FLASH_ALPHA, dying);
      if (white > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = white * Math.max(shown, flash);
        pen.place(frame.x, frame.y, frame.size, 0);
        pen.blit(baker.glow(WHITE, r * FLASH_SCALE));
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    },
    get flash() {
      return flash;
    },
    reset() {
      flash = 0;
      state = null;
      windup = null;
      active = null;
      for (const drawer of allDrawers) drawer.reset?.();
      aimLine.reset();
    },
  };
}
