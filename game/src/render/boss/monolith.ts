import type { BossPart, BossView } from '../../sim/boss/bossRunner';
import { TAU } from '../../sim/math';
import { HIT_FLASH_SECONDS } from '../hitFlash';
import { easeOut } from '../scene';
import { blitCore, RIM_PAD, type BossFrame, type DrawerFactory } from './drawer';
import { MONOLITH_ART_REACH, paintFissures, paintMonolithCore, paintShard } from './monolithArt';

/** The fissures, dim behind the shield and blazing once the core is bare, pulsing at this rate unless held still. */
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

/** The cache keys of the Monolith's sprites, made once per size so drawing builds no strings. */
const coreKeys = (radius: number): { readonly core: string; readonly fissures: string } => ({ core: `boss|monolith|core|${String(radius)}`, fissures: `boss|monolith|fissures|${String(radius)}` });
const shardKeys = (radius: number): { readonly whole: string; readonly cracked: string } => ({ whole: `boss|monolith|shard|${String(radius)}`, cracked: `boss|monolith|shardCracked|${String(radius)}` });

/** Grows `list` to `length` with `fill`, or cuts it down, so it has one slot per part. */
function fit(list: number[], length: number, fill: number): void {
  while (list.length < length) list.push(fill);
  list.length = length;
}

/**
 * The Monolith: a dark slate rock whose cracks glow dimly behind its shield and blaze, with a warm haze and bloom, once it
 * is bare; and its shards, turned outward and tumbling, each flashing white when hit and growing in when it grows back.
 * Through the intro the shards ride in with the core, at its scale.
 */
export const monolithDrawer: DrawerFactory = (kit) => {
  const { ctx, pen, baker, palette } = kit;
  /** The cracks and the bare core's heat: molten, against its cool rock. */
  const heat = palette.ring;
  let radius = 0;
  let keys = coreKeys(radius);
  let shardRadius = 0;
  let shards = shardKeys(shardRadius);
  const paintCoreAt = (c: CanvasRenderingContext2D): void => {
    paintMonolithCore(c, radius, palette);
  };
  const paintFissuresAt = (c: CanvasRenderingContext2D): void => {
    paintFissures(c, radius, heat);
  };
  const shardPainter = (cracked: boolean) => (c: CanvasRenderingContext2D): void => {
    paintShard(c, shardRadius, palette, heat, cracked);
  };
  const paintWholeShard = shardPainter(false);
  const paintCrackedShard = shardPainter(true);
  /** Real seconds of the fight so far, for the fissures' pulse and the shards' tumble. */
  let time = 0;
  /** Per part: seconds of hit flash left, seconds since it last grew back, and whether it was live last frame (1 or 0). */
  const partFlash: number[] = [];
  const partGrowth: number[] = [];
  const partLive: number[] = [];

  function reset(): void {
    time = 0;
    partFlash.length = 0;
    partGrowth.length = 0;
    partLive.length = 0;
  }

  /** A live shard, interpolated, placed about the core at its scale, turned outward and tumbling. */
  function drawShard(part: Readonly<BossPart>, i: number, frame: Readonly<BossFrame>, cx: number, cy: number): void {
    if (part.hp <= 0) return;
    if (part.radius !== shardRadius) {
      shardRadius = part.radius;
      shards = shardKeys(shardRadius);
    }
    const { alpha, size } = frame;
    const x = frame.x + (part.px + (part.x - part.px) * alpha - cx) * size;
    const y = frame.y + (part.py + (part.y - part.py) * alpha - cy) * size;
    const turn = Math.atan2(y - frame.y, x - frame.x) + (frame.look.still ? 0 : time * SHARD_TUMBLE);
    const scale = size * easeOut(Math.min(1, (partGrowth[i] ?? GROW_SECONDS) / GROW_SECONDS));
    pen.place(x, y, Math.cos(turn) * scale, Math.sin(turn) * scale);
    const cracked = part.hp < part.maxHp;
    const key = cracked ? shards.cracked : shards.whole;
    const sprite = baker.custom(key, shardRadius + RIM_PAD, cracked ? paintCrackedShard : paintWholeShard);
    pen.blit((partFlash[i] ?? 0) > 0 ? (baker.white(key) ?? sprite) : sprite);
  }

  const bare = (boss: Readonly<BossView>): boolean => boss.vulnerable && boss.state === 'fighting';

  return {
    glow: palette.accent[0],
    underglow(boss, { x, y, size, shown, look }) {
      if (!bare(boss)) return;
      ctx.globalAlpha = EXPOSED_HAZE_ALPHA * look.glow * shown;
      pen.place(x, y, size, 0);
      pen.blit(baker.glow(heat, boss.radius * EXPOSED_HAZE_SCALE));
    },
    body(boss, frame) {
      const { x, y, size, shown, look } = frame;
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        keys = coreKeys(r);
      }
      pen.place(x, y, size, 0);
      blitCore(kit, keys.core, r * MONOLITH_ART_REACH + RIM_PAD, paintCoreAt, frame.tinted);
      const pulse = look.still ? 1 : 0.8 + 0.2 * Math.sin(time * TAU * FISSURE_PULSE_HZ);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shown * (boss.vulnerable ? FISSURE_EXPOSED * pulse : FISSURE_SHIELDED);
      pen.blit(baker.custom(keys.fissures, r + RIM_PAD, paintFissuresAt));
      if (bare(boss)) {
        ctx.globalAlpha = shown * EXPOSED_BLOOM_ALPHA * pulse * look.glow;
        pen.blit(baker.glow(heat, r * EXPOSED_BLOOM_SCALE));
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = shown;
      // Parts are placed about the core's own interpolated centre, so they keep their orbit as it scales.
      const cx = boss.px + (boss.x - boss.px) * frame.alpha;
      const cy = boss.py + (boss.y - boss.py) * frame.alpha;
      const { parts } = boss;
      for (let i = 0; i < parts.length; i++) drawShard(parts[i] as BossPart, i, frame, cx, cy);
    },
    /** Counts each part's flash down and its growth up, starting the growth afresh for a part that has just grown back. */
    advance(dt, boss) {
      time += dt;
      const { parts } = boss;
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
    },
    handle(event) {
      if (event.type === 'bossIntro') reset();
      else if (event.type === 'bossPartHit') {
        fit(partFlash, Math.max(partFlash.length, event.part + 1), 0);
        partFlash[event.part] = HIT_FLASH_SECONDS;
      }
    },
    reset,
  };
};
