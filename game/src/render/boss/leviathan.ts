import type { PaletteId } from '../../content/types';
import type { BossPart, BossView } from '../../sim/boss/behaviour';
import { COIL_OPENING, tailOf } from '../../sim/boss/leviathan';
import { TAU } from '../../sim/math';
import { mix, rgba } from '../color';
import { coreSprite, partOffset, RIM_PAD, type BossFrame, type DrawerFactory } from './drawer';
import { HEAD_ART_REACH, paintHead, paintSegment, SEGMENT_ART_REACH } from './leviathanArt';
import { PartClocks } from './partClocks';

const WHITE = '#ffffff';
/** The open tail's glow, in segment radii across, pulsing at this rate unless held still. */
const TAIL_GLOW_SCALE = 3.4;
const TAIL_GLOW_ALPHA = 0.85;
const TAIL_PULSE_HZ = 2.4;
/** The heat over the open tail, in segment radii across. */
const TAIL_HEAT_SCALE = 2.6;
const TAIL_HEAT_ALPHA = 0.7;
/** The bare head's maw glow, in head radii across. */
const MAW_GLOW_SCALE = 2.6;
const MAW_GLOW_ALPHA = 0.6;
/** The coil's ring through its windup, pulsing, and fainter while it runs; its opening's edges marked this long. */
const RING_PULSE_HZ = 5;
const RING_RUNNING_ALPHA = 0.3;
const OPENING_TICK = 34;

type SegmentLook = 'armoured' | 'open' | 'cracked';
const SEGMENT_LOOKS: readonly SegmentLook[] = ['armoured', 'open', 'cracked'];

/** The cache keys of the Leviathan's sprites, made once per size so drawing builds no strings. */
const headKeys = (radius: number, palette: PaletteId): Readonly<Record<'shut' | 'bare', string>> => ({
  shut: `boss|${palette}|leviathan|head|${String(radius)}`,
  bare: `boss|${palette}|leviathan|headBare|${String(radius)}`,
});
const segmentKeys = (radius: number, palette: PaletteId): Readonly<Record<SegmentLook, string>> =>
  Object.fromEntries(SEGMENT_LOOKS.map((look) => [look, `boss|${palette}|leviathan|segment|${look}|${String(radius)}`])) as Record<SegmentLook, string>;

/**
 * The Leviathan: an indigo serpent in the Dimension's light. Its segments are drawn tail first, each turned toward the
 * one ahead of it, so the head lies over the body; the armoured ones plated over, the open tail glowing hot (cracked
 * once hurt), each flashing white when hit. The head is turned the way it faces, its jaws shut until it is bare and then
 * gaping on a glowing maw. A coil's ring is drawn round the windup's aim, open over the arc the head came from, in the
 * Dimension's hostile hue. Sprites are baked by key, the keys made once per size, and nothing is allocated as it draws.
 */
export const leviathanDrawer: DrawerFactory = (kit) => {
  const { ctx, pen, baker, palette } = kit;
  const heat = palette.ring;
  const eye = palette.accent[0];
  const ringStroke = rgba(palette.accent[0], 0.9);
  /** The ring's strokes, widest first: a soft halo, the line, and a hot core. */
  const ringPasses: readonly (readonly [string, number])[] = [[rgba(palette.accent[0], 0.28), 14], [ringStroke, 4], [rgba(mix(palette.accent[0], WHITE, 0.6), 0.95), 1.5]];
  let radius = 0;
  let heads = headKeys(radius, palette.id);
  let segmentRadius = 0;
  let segments = segmentKeys(segmentRadius, palette.id);
  const headPainter = (bare: boolean) => (c: CanvasRenderingContext2D): void => {
    paintHead(c, radius, palette, eye, heat, bare);
  };
  const paintShut = headPainter(false);
  const paintBare = headPainter(true);
  const segmentPainters = Object.fromEntries(
    SEGMENT_LOOKS.map((look) => [look, (c: CanvasRenderingContext2D): void => { paintSegment(c, segmentRadius, palette, heat, look); }]),
  ) as Record<SegmentLook, (c: CanvasRenderingContext2D) => void>;
  /** Real seconds of the fight so far, for the tail's pulse and the ring's. */
  let time = 0;
  /** Each segment's hit flash; segments never grow back, so their growth is never seen. */
  const clocks = new PartClocks(1);
  /** Where each part is drawn this frame, and the bearing it is turned to: refilled by `layout`, resized only with the body. */
  let placeX = new Float64Array(0);
  let placeY = new Float64Array(0);
  let turns = new Float64Array(0);
  const offset = { x: 0, y: 0 };
  /** The coil's ring: whether one is shown, and the bearing of its opening from its centre. */
  let coiling = false;
  let opening = 0;

  function reset(): void {
    time = 0;
    clocks.reset();
    coiling = false;
  }

  /**
   * Notes the coil's opening on its windup's first frame: the bearing from its aim to the head, which holds still
   * through the windup. Forgets it once the coil is over.
   */
  function trackCoil(boss: Readonly<BossView>, frame: Readonly<BossFrame>): void {
    if (boss.windup !== 'coil' && boss.active !== 'coil') {
      coiling = false;
      return;
    }
    if (coiling) return;
    coiling = true;
    opening = Math.atan2(frame.y - boss.aim.y, frame.x - boss.aim.x);
  }

  /**
   * The coil's ring round the windup's aim, at the radius its threat declares: the whole circle but its opening, with a
   * tick at each of the opening's edges.
   */
  function drawRing(boss: Readonly<BossView>, frame: Readonly<BossFrame>): void {
    const { shown, look } = frame;
    const { x, y } = boss.aim;
    const radius = boss.threat?.ring?.radius ?? 0;
    const half = COIL_OPENING / 2;
    const pulse = look.still ? 1 : 0.75 + 0.25 * Math.sin(time * TAU * RING_PULSE_HZ);
    pen.field();
    ctx.globalAlpha = shown * (boss.windup === 'coil' ? pulse : RING_RUNNING_ALPHA);
    for (const pass of ringPasses) {
      ctx.strokeStyle = pass[0];
      ctx.lineWidth = pass[1];
      ctx.beginPath();
      ctx.arc(x, y, radius, opening + half, opening + TAU - half);
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = ringStroke;
    for (let side = -1; side <= 1; side += 2) {
      const c = Math.cos(opening + side * half);
      const s = Math.sin(opening + side * half);
      ctx.beginPath();
      ctx.moveTo(x + c * (radius - OPENING_TICK / 2), y + s * (radius - OPENING_TICK / 2));
      ctx.lineTo(x + c * (radius + OPENING_TICK / 2), y + s * (radius + OPENING_TICK / 2));
      ctx.stroke();
    }
  }

  /**
   * Places each part this frame, interpolated and scaled with the frame about the head's own interpolated centre, and
   * turns it toward the one ahead of it, the front one toward the head.
   */
  function layout(boss: Readonly<BossView>, frame: Readonly<BossFrame>): void {
    const { parts } = boss;
    if (turns.length !== parts.length) [placeX, placeY, turns] = [new Float64Array(parts.length), new Float64Array(parts.length), new Float64Array(parts.length)];
    const cx = boss.px + (boss.x - boss.px) * frame.alpha;
    const cy = boss.py + (boss.y - boss.py) * frame.alpha;
    let aheadX = frame.x;
    let aheadY = frame.y;
    for (let i = parts.length - 1; i >= 0; i--) {
      const at = partOffset(parts[i] as BossPart, frame, cx, cy, offset);
      const x = (placeX[i] = frame.x + at.x * frame.size);
      const y = (placeY[i] = frame.y + at.y * frame.size);
      turns[i] = Math.atan2(aheadY - y, aheadX - x);
      aheadX = x;
      aheadY = y;
    }
  }

  /** How bright the open tail's glow is now, from 0.6 to 1; held at 1 for reduced motion. */
  const tailPulse = (frame: Readonly<BossFrame>): number => (frame.look.still ? 1 : 0.8 + 0.2 * Math.sin(time * TAU * TAIL_PULSE_HZ));

  /** The open tail's heat, drawn additively over it so it reads through its own sprite, pulsing unless held still. */
  function drawTailHeat(tail: Readonly<BossPart>, i: number, frame: Readonly<BossFrame>): void {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = frame.shown * TAIL_HEAT_ALPHA * tailPulse(frame);
    pen.place(placeX[i] ?? 0, placeY[i] ?? 0, frame.size, 0);
    pen.blit(baker.glow(heat, tail.radius * TAIL_HEAT_SCALE));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = frame.shown;
  }

  return {
    glow: palette.accent[1],
    underglow(boss, frame) {
      trackCoil(boss, frame);
      if (coiling) drawRing(boss, frame);
      const index = tailOf(boss.parts);
      const tail = boss.parts[index];
      if (tail === undefined || boss.state !== 'fighting') return;
      layout(boss, frame);
      ctx.globalAlpha = TAIL_GLOW_ALPHA * frame.look.glow * frame.shown * tailPulse(frame);
      pen.place(placeX[index] ?? 0, placeY[index] ?? 0, frame.size, 0);
      pen.blit(baker.glow(heat, tail.radius * TAIL_GLOW_SCALE));
    },
    body(boss, frame) {
      const { size, tinted } = frame;
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        heads = headKeys(r, palette.id);
      }
      layout(boss, frame);
      const { parts } = boss;
      const tail = tailOf(boss.parts);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as BossPart;
        if (part.hp <= 0) continue;
        if (part.radius !== segmentRadius) {
          segmentRadius = part.radius;
          segments = segmentKeys(segmentRadius, palette.id);
        }
        const look: SegmentLook = i !== tail ? 'armoured' : part.hp < part.maxHp ? 'cracked' : 'open';
        const turn = turns[i] ?? 0;
        pen.place(placeX[i] ?? 0, placeY[i] ?? 0, Math.cos(turn) * size, Math.sin(turn) * size);
        const sprite = baker.custom(segments[look], segmentRadius * SEGMENT_ART_REACH + RIM_PAD, segmentPainters[look]);
        pen.blit(clocks.flashing(i) ? (baker.white(segments[look]) ?? sprite) : sprite);
      }
      if (tail >= 0 && boss.state === 'fighting') drawTailHeat(parts[tail] as BossPart, tail, frame);
      const bare = boss.vulnerable && boss.state === 'fighting';
      pen.place(frame.x, frame.y, Math.cos(boss.facing) * size, Math.sin(boss.facing) * size);
      pen.blit(coreSprite(kit, bare ? heads.bare : heads.shut, r * HEAD_ART_REACH + RIM_PAD, bare ? paintBare : paintShut, tinted));
      if (!bare) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = frame.shown * MAW_GLOW_ALPHA * frame.look.glow;
      const reach = r * 0.7 * size;
      pen.place(frame.x + Math.cos(boss.facing) * reach, frame.y + Math.sin(boss.facing) * reach, size, 0);
      pen.blit(baker.glow(heat, r * MAW_GLOW_SCALE));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = frame.shown;
    },
    advance(dt, boss) {
      time += dt;
      clocks.advance(dt, boss.parts);
    },
    handle(event) {
      if (event.type === 'bossIntro') time = 0;
      clocks.handle(event);
    },
    reset,
  };
};
