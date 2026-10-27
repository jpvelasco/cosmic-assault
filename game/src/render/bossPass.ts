import type { AttackId } from '../content/types';
import { DYING_SECONDS, type BossPart, type BossPhase, type BossState, type BossView } from '../sim/boss/bossRunner';
import type { SimEvent } from '../sim/events';
import { TAU } from '../sim/math';
import { mix, rgba } from './color';
import type { FieldPen } from './fieldPen';
import { HIT_FLASH_SECONDS } from './hitFlash';
import { MONOLITH_ART_REACH, paintFissures, paintMonolithCore, paintShard } from './monolithArt';
import type { Palette } from './palette';
import { easeOut } from './scene';
import type { SpriteBaker } from './sprites';

/** How long the glow flashes white after a hit. The core itself shows white for its first HIT_FLASH_SECONDS. */
export const BOSS_FLASH_SECONDS = 0.12;

/** What the boss is drawn with this frame: the quality's glow strength, reduced motion, and where its eye looks. */
export interface BossLook {
  readonly glow: number;
  /** Holds the windup ring steady, for reduced motion. */
  readonly still: boolean;
  readonly aimX: number;
  readonly aimY: number;
}

export interface BossPass {
  /** A `bossHit` flashes the core, a `bossPartHit` the part it struck. */
  handle(events: readonly SimEvent[]): void;
  /** Advances the flash, and the clocks of the boss's state and windup, by `dt` seconds of real time. */
  advance(dt: number, boss: Readonly<BossView> | null): void;
  /**
   * Draws the boss `alpha` of the way from its previous position: glow, windup ring, its body (the Sentinel's core and
   * eye, the Monolith's rock and shards) and hit flash. Expects the field pen aimed for the frame and `source-over`,
   * which it leaves as it found them, with alpha 1.
   */
  draw(boss: Readonly<BossView> | null, alpha: number, look: BossLook): void;
  /** How bright the hit flash is now, 1 just after a hit down to 0. */
  readonly flash: number;
  /** Forgets the last fight, for a new run. */
  reset(): void;
}

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
/** How far the eye looks toward the ship, as a share of the core radius. */
const EYE_REACH = 0.2;
const EYE_SIZE = 0.3;
const STUDS = 8;
/** Room around the core's rim for its stroke. */
const RIM_PAD = 2;
/** The Monolith's fissures, dim behind its shield and blazing once it is bare, pulsing at this rate unless held still. */
const FISSURE_SHIELDED = 0.3;
const FISSURE_EXPOSED = 1;
const FISSURE_PULSE_HZ = 2.2;
/** The bare core's heat: a wide haze behind it and a bloom over it, as diameters in core radii. */
const EXPOSED_HAZE_SCALE = 6.5;
const EXPOSED_HAZE_ALPHA = 0.9;
const EXPOSED_BLOOM_SCALE = 2.4;
const EXPOSED_BLOOM_ALPHA = 0.4;
/** How long a regrown shard takes to grow to full size. */
const GROW_SECONDS = 0.4;
/** How fast a shard tumbles on its orbit, radians per second, unless held still. */
const SHARD_TUMBLE = 1.4;
/** The pulse's shockwave: from the windup ring's size out to this many times it, over the pulse. */
const SHOCKWAVE_REACH = 3.4;
const SHOCKWAVE_SECONDS = 0.3;

/** A radial gradient lit from (x, y) out to radius `r1` around the origin. */
function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, r0, 0, 0, r1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The Sentinel's armoured shell, lit from the upper left: a glossy violet sphere with a dark socket and a ring of studs. */
function paintCore(ctx: CanvasRenderingContext2D, r: number, p: Palette): void {
  const armour = p.accent[1];
  const deep = p.skyStops[0];
  disc(ctx, 0, 0, r, radial(ctx, -0.35 * r, -0.4 * r, 0.05 * r, r, [[0, mix(armour, WHITE, 0.55)], [0.45, armour], [1, mix(armour, deep, 0.78)]]));
  // The groove between the shell and its socket, and the studs around it.
  ctx.beginPath();
  ctx.arc(0, 0, 0.64 * r, 0, TAU);
  ctx.strokeStyle = rgba(deep, 0.65);
  ctx.lineWidth = 0.05 * r;
  ctx.stroke();
  for (let i = 0; i < STUDS; i++) {
    const a = ((i + 0.5) / STUDS) * TAU;
    ctx.save();
    ctx.translate(Math.cos(a) * 0.82 * r, Math.sin(a) * 0.82 * r);
    disc(ctx, 0, 0, 0.06 * r, radial(ctx, -0.02 * r, -0.02 * r, 0, 0.06 * r, [[0, mix(p.accent[2], WHITE, 0.6)], [1, p.accent[2]]]));
    ctx.restore();
  }
  disc(ctx, 0, 0, 0.5 * r, radial(ctx, 0.1 * r, 0.12 * r, 0, 0.5 * r, [[0, mix(deep, '#000000', 0.2)], [1, mix(deep, '#000000', 0.6)]]));
  // The gloss: a soft white sheen over the upper left of the shell.
  ctx.save();
  ctx.translate(-0.32 * r, -0.46 * r);
  ctx.rotate(-0.55);
  ctx.scale(1, 0.5);
  disc(ctx, 0, 0, 0.42 * r, radial(ctx, 0, 0, 0, 0.42 * r, [[0, rgba(WHITE, 0.6)], [1, rgba(WHITE, 0)]]));
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.strokeStyle = rgba(WHITE, 0.35);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** The eye in the socket: a lit iris of `color` with a dark pupil and a glint. */
function paintEye(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  disc(ctx, 0, 0, r, radial(ctx, -0.2 * r, -0.2 * r, 0, r, [[0, WHITE], [0.35, color], [1, mix(color, '#000000', 0.55)]]));
  disc(ctx, 0, 0, 0.38 * r, rgba('#000000', 0.75));
  disc(ctx, -0.3 * r, -0.32 * r, 0.16 * r, rgba(WHITE, 0.85));
}

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

/** A record of `make(id)` for every attack, in `ATTACK_IDS` order. */
function perAttack<T>(make: (id: AttackId) => T): Record<AttackId, T> {
  return Object.fromEntries(ATTACK_IDS.map((id) => [id, make(id)])) as Record<AttackId, T>;
}

/** Every attack, once: the `satisfies` makes a new one fail to compile until it is listed. */
const ATTACK_ID_SET = { shardRing: 0, lunge: 0, shardVolley: 0, quake: 0, pulse: 0 } as const satisfies Record<AttackId, 0>;
const ATTACK_IDS = Object.keys(ATTACK_ID_SET) as AttackId[];

interface ArtKeys {
  readonly core: string;
  readonly eyes: Record<BossPhase, string>;
  readonly rings: Record<AttackId, string>;
  readonly monolith: string;
  readonly fissures: string;
}

/** The cache keys of a boss's sprites at `radius`, made once per radius so drawing builds no strings. */
function artKeys(radius: number): ArtKeys {
  const size = String(radius);
  return {
    core: `boss|core|${size}`,
    eyes: { 1: `boss|eye|1|${size}`, 2: `boss|eye|2|${size}`, 3: `boss|eye|3|${size}` },
    rings: perAttack((id) => `boss|ring|${id}|${size}`),
    monolith: `boss|monolith|core|${size}`,
    fissures: `boss|monolith|fissures|${size}`,
  };
}

/** The cache keys of a Monolith shard at `radius`, whole and cracked. */
const shardKeys = (radius: number): { readonly whole: string; readonly cracked: string } => ({ whole: `boss|monolith|shard|${String(radius)}`, cracked: `boss|monolith|shardCracked|${String(radius)}` });

/** Grows `list` to `length` with `fill`, or cuts it down, so it has one slot per part. */
function fit(list: number[], length: number, fill: number): void {
  while (list.length < length) list.push(fill);
  list.length = length;
}

/**
 * Draws the boss from baked sprites (no `shadowBlur`): a glow, its body (the Sentinel's core and an eye that follows
 * the ship; the Monolith's rock, its cracks lit by whether it is bare, and its shards, each flashing white when hit and
 * growing in when it grows back), a closing ring while an attack winds up, a shockwave as it pulses, and a white flash on each hit (the core's silhouette for 60 ms, with a glow that
 * lingers). The core fades in through the intro and out, whitening, as it dies. Its own sprite keys and painters are made once per radius, and `baker.glow` looks its key up in the
 * baker's key table (built once per colour and size bucket), so a frame of drawing builds no strings or closures.
 */
export function createBossPass(ctx: CanvasRenderingContext2D, pen: FieldPen, baker: SpriteBaker, palette: Palette): BossPass {
  const eyeColors: Readonly<Record<BossPhase, string>> = { 1: palette.accent[0], 2: palette.ring, 3: palette.shot };
  const ringColors: Readonly<Record<AttackId, string>> = { shardRing: palette.shot, lunge: palette.ring, shardVolley: palette.accent[0], quake: palette.ring, pulse: palette.accent[2] };
  /** The Monolith's cracks and bare-core glow: molten, against its cool rock. */
  const fissureColor = palette.ring;
  /** The radius the sprites below are keyed and painted for; a boss keeps one, so they are made once a fight. */
  let radius = 0;
  let keys = artKeys(radius);
  const paintCoreAt = (c: CanvasRenderingContext2D): void => {
    paintCore(c, radius, palette);
  };
  const eyePainter = (phase: BossPhase) => (c: CanvasRenderingContext2D): void => {
    paintEye(c, radius * EYE_SIZE, eyeColors[phase]);
  };
  const ringPainter = (attack: AttackId) => (c: CanvasRenderingContext2D): void => {
    paintRing(c, radius, ringColors[attack]);
  };
  const eyePainters = { 1: eyePainter(1), 2: eyePainter(2), 3: eyePainter(3) };
  const ringPainters = perAttack(ringPainter);
  const paintMonolithAt = (c: CanvasRenderingContext2D): void => {
    paintMonolithCore(c, radius, palette);
  };
  const paintFissuresAt = (c: CanvasRenderingContext2D): void => {
    paintFissures(c, radius, fissureColor);
  };
  /** The shard radius the shard sprites are keyed and painted for. */
  let shardRadius = 0;
  let shards = shardKeys(shardRadius);
  const shardPainter = (cracked: boolean) => (c: CanvasRenderingContext2D): void => {
    paintShard(c, shardRadius, palette, fissureColor, cracked);
  };
  const paintWholeShard = shardPainter(false);
  const paintCrackedShard = shardPainter(true);
  let flash = 0;
  let state: BossState | null = null;
  let stateClock = 0;
  let windup: AttackId | null = null;
  let windupClock = 0;
  let active: AttackId | null = null;
  let activeClock = 0;
  /** Real seconds of the fight so far, for the fissures' pulse and the shards' tumble. */
  let time = 0;
  /** Per part: seconds of hit flash left, seconds since it last grew back, and whether it was live last frame. */
  const partFlash: number[] = [];
  const partGrowth: number[] = [];
  const partLive: number[] = [];

  /** How visible the core is: fading in through the intro, out through dying. */
  function presence(current: BossState): number {
    if (current !== state) return current === 'intro' ? 0 : 1;
    if (current === 'intro') return easeOut(Math.min(1, stateClock / INTRO_FADE_SECONDS));
    return current === 'dying' ? Math.max(0, 1 - stateClock / DYING_SECONDS) : 1;
  }

  function blitRing(attack: AttackId, x: number, y: number, r: number, size: number): void {
    pen.place(x, y, size, 0);
    pen.blit(baker.custom(keys.rings[attack], r * RING_REACH, ringPainters[attack]));
  }

  function drawRing(attack: AttackId, x: number, y: number, r: number, still: boolean): void {
    const closing = Math.max(0, 1 - windupClock / RING_CLOSE_SECONDS);
    ctx.globalAlpha = still ? 0.85 : (0.7 + 0.3 * Math.sin(windupClock * TAU * RING_PULSE_HZ)) * (1 - 0.5 * closing);
    blitRing(attack, x, y, r, still ? 1.1 : 1 + RING_CLOSE * closing);
  }

  /** The pulse's ring racing outward and fading; held at one size, dimmer, under reduced motion. */
  function drawShockwave(x: number, y: number, r: number, shown: number, still: boolean): void {
    const t = Math.min(1, activeClock / SHOCKWAVE_SECONDS);
    ctx.globalAlpha = shown * (still ? 0.5 : 1 - t);
    blitRing('pulse', x, y, r, still ? SHOCKWAVE_REACH / 2 : 1 + (SHOCKWAVE_REACH - 1) * easeOut(t));
  }

  /** A core's sprite, or its white silhouette for the first moments of a hit's flash. */
  function blitCore(key: string, half: number, paint: (c: CanvasRenderingContext2D) => void): void {
    const core = baker.custom(key, half, paint);
    pen.blit(flash > TINT_ABOVE ? (baker.white(key) ?? core) : core);
  }

  /** The Sentinel's armoured core and its eye, which looks toward the ship. */
  function drawSentinel(boss: Readonly<BossView>, x: number, y: number, size: number, look: BossLook): void {
    const r = boss.radius;
    pen.place(x, y, size, 0);
    blitCore(keys.core, r + RIM_PAD, paintCoreAt);
    const dx = look.aimX - x;
    const dy = look.aimY - y;
    const reach = (EYE_REACH * r * size) / Math.max(1, Math.hypot(dx, dy));
    pen.place(x + dx * reach, y + dy * reach, size, 0);
    pen.blit(baker.custom(keys.eyes[boss.phase], r * EYE_SIZE + RIM_PAD, eyePainters[boss.phase]));
  }

  /** The Monolith's rock, its cracks lit dim or blazing by whether it is bare, and its shards. */
  function drawMonolith(boss: Readonly<BossView>, x: number, y: number, size: number, shown: number, alpha: number, look: BossLook): void {
    const r = boss.radius;
    pen.place(x, y, size, 0);
    blitCore(keys.monolith, r * MONOLITH_ART_REACH + RIM_PAD, paintMonolithAt);
    const pulse = look.still ? 1 : 0.8 + 0.2 * Math.sin(time * TAU * FISSURE_PULSE_HZ);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = shown * (boss.vulnerable ? FISSURE_EXPOSED * pulse : FISSURE_SHIELDED);
    pen.blit(baker.custom(keys.fissures, r + RIM_PAD, paintFissuresAt));
    if (boss.vulnerable) {
      ctx.globalAlpha = shown * EXPOSED_BLOOM_ALPHA * pulse * look.glow;
      pen.blit(baker.glow(fissureColor, r * EXPOSED_BLOOM_SCALE));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = shown;
    const { parts } = boss;
    for (let i = 0; i < parts.length; i++) drawShard(parts[i] as BossPart, i, alpha, x, y, look.still);
  }

  /** A live shard `alpha` of the way from its previous position, turned outward from the core and tumbling. */
  function drawShard(part: Readonly<BossPart>, i: number, alpha: number, coreX: number, coreY: number, still: boolean): void {
    if (part.hp <= 0) return;
    if (part.radius !== shardRadius) {
      shardRadius = part.radius;
      shards = shardKeys(shardRadius);
    }
    const x = part.px + (part.x - part.px) * alpha;
    const y = part.py + (part.y - part.py) * alpha;
    const turn = Math.atan2(y - coreY, x - coreX) + (still ? 0 : time * SHARD_TUMBLE);
    const scale = easeOut(Math.min(1, (partGrowth[i] ?? GROW_SECONDS) / GROW_SECONDS));
    pen.place(x, y, Math.cos(turn) * scale, Math.sin(turn) * scale);
    const cracked = part.hp < part.maxHp;
    const key = cracked ? shards.cracked : shards.whole;
    const sprite = baker.custom(key, shardRadius + RIM_PAD, cracked ? paintCrackedShard : paintWholeShard);
    pen.blit((partFlash[i] ?? 0) > 0 ? (baker.white(key) ?? sprite) : sprite);
  }

  /** Counts each part's flash down and its growth up, starting the growth afresh for a part that has just grown back. */
  function advanceParts(dt: number, parts: readonly Readonly<BossPart>[]): void {
    const fresh = partLive.length !== parts.length;
    fit(partFlash, parts.length, 0);
    fit(partGrowth, parts.length, GROW_SECONDS);
    fit(partLive, parts.length, 1);
    for (let i = 0; i < parts.length; i++) {
      const live = (parts[i]?.hp ?? 0) > 0 ? 1 : 0;
      if (live === 1 && partLive[i] === 0 && !fresh) partGrowth[i] = 0;
      partLive[i] = live;
      partGrowth[i] = (partGrowth[i] ?? 0) + dt;
      partFlash[i] = Math.max(0, (partFlash[i] ?? 0) - dt);
    }
  }

  return {
    handle(events) {
      for (const event of events) {
        if (event.type === 'bossHit') flash = 1;
        else if (event.type === 'bossPartHit') {
          fit(partFlash, Math.max(partFlash.length, event.part + 1), 0);
          partFlash[event.part] = HIT_FLASH_SECONDS;
        }
      }
    },
    advance(dt, boss) {
      flash = Math.max(0, flash - dt / BOSS_FLASH_SECONDS);
      if (boss === null) {
        state = null;
        windup = null;
        active = null;
        return;
      }
      time += dt;
      stateClock = boss.state === state ? stateClock + dt : 0;
      state = boss.state;
      windupClock = boss.windup === windup ? windupClock + dt : 0;
      windup = boss.windup;
      activeClock = boss.active === active ? activeClock + dt : 0;
      active = boss.active;
      advanceParts(dt, boss.parts);
    },
    draw(boss, alpha, look) {
      if (boss === null || boss.state === 'down') return;
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        keys = artKeys(r);
      }
      const x = boss.px + (boss.x - boss.px) * alpha;
      const y = boss.py + (boss.y - boss.py) * alpha;
      const shown = presence(boss.state);
      const dying = boss.state === 'dying' && boss.state === state ? stateClock / DYING_SECONDS : 0;
      const size = boss.state === 'intro' ? 0.7 + 0.3 * shown : 1 + 0.12 * dying;
      const monolith = boss.id === 'monolith';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = GLOW_ALPHA * look.glow * shown;
      pen.place(x, y, size, 0);
      pen.blit(baker.glow(monolith ? palette.accent[0] : palette.accent[1], r * GLOW_SCALE));
      if (monolith && boss.vulnerable && boss.state === 'fighting') {
        ctx.globalAlpha = EXPOSED_HAZE_ALPHA * look.glow * shown;
        pen.blit(baker.glow(fissureColor, r * EXPOSED_HAZE_SCALE));
      }
      if (boss.windup !== null) drawRing(boss.windup, x, y, r, look.still);
      if (boss.active === 'pulse' && active === 'pulse') drawShockwave(x, y, r, shown, look.still);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = shown;
      if (monolith) drawMonolith(boss, x, y, size, shown, alpha, look);
      else drawSentinel(boss, x, y, size, look);
      const white = Math.max(flash * FLASH_ALPHA, dying);
      if (white > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = white * Math.max(shown, flash);
        pen.place(x, y, size, 0);
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
      time = 0;
      partFlash.length = 0;
      partGrowth.length = 0;
      partLive.length = 0;
    },
  };
}
