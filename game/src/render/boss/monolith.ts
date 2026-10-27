import type { PaletteId } from '../../content/types';
import type { BossPart, BossView } from '../../sim/boss/behaviour';
import { TAU } from '../../sim/math';
import { blitCore, partOffset, RIM_PAD, type BossFrame, type DrawerFactory } from './drawer';
import { MONOLITH_ART_REACH, paintFissures, paintMonolithCore, paintShard } from './monolithArt';
import { PartClocks } from './partClocks';

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
const coreKeys = (radius: number, palette: PaletteId): { readonly core: string; readonly fissures: string } => ({
  core: `boss|${palette}|monolith|core|${String(radius)}`,
  fissures: `boss|${palette}|monolith|fissures|${String(radius)}`,
});
const shardKeys = (radius: number, palette: PaletteId): { readonly whole: string; readonly cracked: string } => ({
  whole: `boss|${palette}|monolith|shard|${String(radius)}`,
  cracked: `boss|${palette}|monolith|shardCracked|${String(radius)}`,
});

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
  let keys = coreKeys(radius, palette.id);
  let shardRadius = 0;
  let shards = shardKeys(shardRadius, palette.id);
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
  const clocks = new PartClocks(GROW_SECONDS);
  /** A shard's place from the core; one point, reused. */
  const offset = { x: 0, y: 0 };

  function reset(): void {
    time = 0;
    clocks.reset();
  }

  /** A live shard, interpolated, placed about the core at its scale, turned outward and tumbling. */
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
    const turn = Math.atan2(y - frame.y, x - frame.x) + (frame.look.still ? 0 : time * SHARD_TUMBLE);
    const scale = size * clocks.grown(i);
    pen.place(x, y, Math.cos(turn) * scale, Math.sin(turn) * scale);
    const cracked = part.hp < part.maxHp;
    const key = cracked ? shards.cracked : shards.whole;
    const sprite = baker.custom(key, shardRadius + RIM_PAD, cracked ? paintCrackedShard : paintWholeShard);
    pen.blit(clocks.flashing(i) ? (baker.white(key) ?? sprite) : sprite);
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
        keys = coreKeys(r, palette.id);
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
    advance(dt, boss) {
      time += dt;
      clocks.advance(dt, boss.parts);
    },
    handle(event) {
      clocks.handle(event);
      if (event.type === 'bossIntro') time = 0;
    },
    reset,
  };
};
