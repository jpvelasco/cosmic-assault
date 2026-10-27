import type { PaletteId } from '../../content/types';
import { launchSlot, launchSlotsFor } from '../../sim/boss/attacks';
import type { BossPart, BossView, Point } from '../../sim/boss/behaviour';
import { ECLIPSE_REACH, ECLIPSE_WAVES, GROW_SECONDS } from '../../sim/boss/eclipse';
import { TAU } from '../../sim/math';
import { blitCore, partOffset, RIM_PAD, type BossFrame, type DrawerFactory } from './drawer';
import { ECLIPSE_ART_REACH, paintCoronaShard, paintEclipseCore, paintSpoke, paintWarnRing } from './eclipseArt';
import { PartClocks } from './partClocks';

/** Warnings pulse at this rate unless held still. */
const WARN_PULSE_HZ = 5;
/** How bright a warning starts as its windup begins, as a share of full: bright enough to read from the first frame. */
const CHARGE_FLOOR = 0.7;
/** The corona's halo, its diameter as a multiple of the reach, dim while shielded and blazing once bare. */
const HALO_SCALE = 2.2;
const HALO_SHIELDED = 0.35;
const HALO_BARE = 0.9;
/** Shard tumble, radians per second, unless held still. */
const SHARD_TUMBLE = 0.9;
/** A warning's shapes, in shard radii: a ring about each shard, a spoke out from it, and the ring at a drone's mouth. */
const RING_REACH = 1.6;
const RING_HALF = 2;
const SPOKE_HALF = 3;
const MOUTH_RADIUS = 18;

/** The cache keys of the Eclipse's sprites, made once per size so drawing builds no strings. */
const coreKeys = (radius: number, palette: PaletteId): { readonly core: string } => ({ core: `boss|${palette}|eclipse|core|${String(radius)}` });
const shardKeys = (
  radius: number,
  palette: PaletteId,
): { readonly whole: string; readonly cracked: string; readonly ring: string; readonly spoke: string } => ({
  whole: `boss|${palette}|eclipse|shard|${String(radius)}`,
  cracked: `boss|${palette}|eclipse|shardCracked|${String(radius)}`,
  ring: `boss|${palette}|eclipse|warnRing|${String(radius)}`,
  spoke: `boss|${palette}|eclipse|warnSpoke|${String(radius)}`,
});

/**
 * The Eclipse: a dark disc with a bright limb, ringed by a corona of lit shards that orbit it. The corona's halo is dim
 * while the core is shielded and blazes once it is bare. Its warnings are solid shapes in colour, drawn over the body: a
 * ring about every shard for a shard volley; a spoke out from every shard for a turret volley; and a ring at each drone's
 * mouth where a launch will send them out, in the Eclipse's gold. A dive's aim line is the pass's. Shards crack as they
 * are hurt, flash white when hit and grow back in.
 */
export const eclipseDrawer: DrawerFactory = (kit) => {
  const { ctx, pen, baker, palette } = kit;
  /** What is hostile and telegraphed, as the palette names it. */
  const hostile = palette.hostile;
  const corona = palette.spark;
  const mouthKey = `boss|${palette.id}|eclipse|warnMouth|${String(MOUTH_RADIUS)}`;
  let radius = 0;
  let keys = coreKeys(radius, palette.id);
  let shardRadius = 0;
  let shards = shardKeys(shardRadius, palette.id);
  const paintCoreAt = (c: CanvasRenderingContext2D): void => {
    paintEclipseCore(c, radius, palette);
  };
  const shardPainter = (cracked: boolean) => (c: CanvasRenderingContext2D): void => {
    paintCoronaShard(c, shardRadius, palette, cracked);
  };
  const paintWholeShard = shardPainter(false);
  const paintCrackedShard = shardPainter(true);
  const paintMouth = (c: CanvasRenderingContext2D): void => {
    paintWarnRing(c, MOUTH_RADIUS, hostile);
  };
  /** The mouth slots a launch shows, and where the live ship is for them; reused. */
  const marks: number[] = [];
  const ship: Point = { x: 0, y: 0 };
  // Warning painters, one per size, made on first use so a frame of drawing allocates nothing.
  const ringPainters = new Map<number, (c: CanvasRenderingContext2D) => void>();
  const spokePainters = new Map<number, (c: CanvasRenderingContext2D) => void>();
  const ringPainter = (r: number): ((c: CanvasRenderingContext2D) => void) => {
    let painter = ringPainters.get(r);
    if (painter === undefined) {
      painter = (c) => {
        paintWarnRing(c, r * RING_REACH, hostile);
      };
      ringPainters.set(r, painter);
    }
    return painter;
  };
  const spokePainter = (r: number): ((c: CanvasRenderingContext2D) => void) => {
    let painter = spokePainters.get(r);
    if (painter === undefined) {
      painter = (c) => {
        paintSpoke(c, r, hostile);
      };
      spokePainters.set(r, painter);
    }
    return painter;
  };
  const clocks = new PartClocks(GROW_SECONDS);
  /** Real seconds of the fight so far, for the shards' tumble and the warnings' pulse. */
  let time = 0;
  /** A part's place from the core, and a launch slot's place; one point each, reused. */
  const offset = { x: 0, y: 0 };
  const slot: Point = { x: 0, y: 0 };

  /** How far the windup under way has come, 0 to 1, over its declared length. */
  const charge = (boss: Readonly<BossView>, windupAge: number): number => Math.min(1, windupAge / (boss.threat?.windup ?? 1));
  /** A warning's flicker, steady under reduced motion. */
  const flicker = (still: boolean): number => (still ? 1 : 0.75 + 0.25 * Math.sin(time * TAU * WARN_PULSE_HZ));

  /** Blits the warning sprite `key` at (x, y), turned to `turn`, `size` times the field's scale, at `strength` of full. */
  function warn(key: string, paint: (c: CanvasRenderingContext2D) => void, half: number, x: number, y: number, size: number, turn: number, strength: number): void {
    ctx.globalAlpha = strength;
    pen.place(x, y, Math.cos(turn) * size, Math.sin(turn) * size);
    pen.blit(baker.custom(key, half, paint));
  }

  /** The warnings: a ring about every live shard for a shard volley, a spoke out from each for a turret volley, or a ring at each drone's mouth for a launch. */
  function drawCharge(boss: Readonly<BossView>, frame: Readonly<BossFrame>, cx: number, cy: number): void {
    const strength = Math.min(1, (CHARGE_FLOOR + (1 - CHARGE_FLOOR) * charge(boss, frame.windupAge)) * flicker(frame.look.still));
    const { size } = frame;
    if (boss.windup === 'shardVolley' || boss.windup === 'turretVolley') {
      for (const part of boss.parts) {
        if (part.hp <= 0) continue;
        const at = partOffset(part, frame, cx, cy, offset);
        const x = frame.x + at.x * size;
        const y = frame.y + at.y * size;
        if (boss.windup === 'shardVolley') warn(shards.ring, ringPainter(part.radius), part.radius * RING_HALF, x, y, size, 0, strength);
        else warn(shards.spoke, spokePainter(part.radius), part.radius * SPOKE_HALF, x, y, size, Math.atan2(at.y, at.x), strength);
      }
    } else if (boss.windup === 'launch') {
      // The slots the launch will form its drones in, against the ship as the frame shows it.
      const wave = ECLIPSE_WAVES[boss.phase];
      ship.x = frame.look.aimX;
      ship.y = frame.look.aimY;
      for (const mark of launchSlotsFor(boss, frame.look.field, ship, wave, wave, marks)) {
        launchSlot(boss, mark, wave, slot);
        warn(mouthKey, paintMouth, MOUTH_RADIUS * 2, slot.x, slot.y, size, 0, strength);
      }
    }
    ctx.globalAlpha = frame.shown;
  }

  /** A live shard, interpolated, placed about the core at its scale, turned with its tumble, cracked by its damage, white when hit. */
  function drawShard(part: Readonly<BossPart>, i: number, frame: Readonly<BossFrame>, cx: number, cy: number): void {
    if (part.hp <= 0) return;
    if (part.radius !== shardRadius) {
      shardRadius = part.radius;
      shards = shardKeys(shardRadius, palette.id);
    }
    const { size } = frame;
    const at = partOffset(part, frame, cx, cy, offset);
    const x = frame.x + at.x * size;
    const y = frame.y + at.y * size;
    const turn = frame.look.still ? 0 : time * SHARD_TUMBLE;
    const scale = size * clocks.grown(i);
    pen.place(x, y, Math.cos(turn) * scale, Math.sin(turn) * scale);
    const cracked = part.hp < part.maxHp;
    const key = cracked ? shards.cracked : shards.whole;
    const sprite = baker.custom(key, shardRadius + RIM_PAD, cracked ? paintCrackedShard : paintWholeShard);
    pen.blit(clocks.flashing(i) ? (baker.white(key) ?? sprite) : sprite);
  }

  return {
    glow: corona,
    underglow(boss, { x, y, size, shown, look }) {
      ctx.globalAlpha = (boss.vulnerable ? HALO_BARE : HALO_SHIELDED) * look.glow * shown;
      pen.place(x, y, size, 0);
      pen.blit(baker.glow(corona, ECLIPSE_REACH * HALO_SCALE));
    },
    body(boss, frame) {
      const { x, y, size, shown } = frame;
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        keys = coreKeys(r, palette.id);
      }
      pen.place(x, y, size, 0);
      blitCore(kit, keys.core, r * ECLIPSE_ART_REACH + RIM_PAD, paintCoreAt, frame.tinted);
      ctx.globalAlpha = shown;
      // Parts are placed about the core's own interpolated centre, so they keep their orbit as it scales.
      const cx = boss.px + (boss.x - boss.px) * frame.alpha;
      const cy = boss.py + (boss.y - boss.py) * frame.alpha;
      const { parts } = boss;
      for (let i = 0; i < parts.length; i++) drawShard(parts[i] as BossPart, i, frame, cx, cy);
      if (boss.state === 'fighting' && boss.windup !== null) drawCharge(boss, frame, cx, cy);
    },
    advance(dt, boss) {
      time += dt;
      clocks.advance(dt, boss.parts);
    },
    handle(event) {
      clocks.handle(event);
      if (event.type === 'bossIntro') time = 0;
    },
    reset() {
      time = 0;
      clocks.reset();
    },
  };
};
