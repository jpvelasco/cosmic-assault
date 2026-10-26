import { PICKUP_IDS } from '../content/pickups';
import type { PickupId } from '../content/types';
import type { SimEvent } from '../sim/events';
import type { Field } from '../sim/field';
import { TAU } from '../sim/math';
import type { Pickup } from '../sim/pickups/pickups';
import { mix, rgba } from './color';
import { interpolatePose } from './interp';
import type { Palette } from './palette';
import { drawGlyph, expiryAlpha, PICKUP_COLORS, SHIELD_RING_RADIUS } from './pickupArt';
import { createZoom, easeOut, type SceneLook, type Stamp } from './scene';
import { addStops, type SpriteBaker } from './sprites';

export interface PickupPass {
  /** A `shieldBroken` cracks the ring. */
  handle(events: readonly SimEvent[]): void;
  /** Runs the crack's clock by `dt` seconds. */
  advance(dt: number): void;
  /** The pickups on the field, `alpha` of the way from their previous place: glowing capsules that blink as they expire. */
  drawPickups(pickups: readonly Readonly<Pickup>[], alpha: number, field: Field, look: SceneLook): void;
  /**
   * The Shield ring round the ship at (x, y) while `left` seconds of it remain (0 for none), blinking through its last
   * 2 s, and the cracked ring flying apart just after it broke. Leaves `source-over` and alpha 1.
   */
  drawShield(left: number, x: number, y: number, field: Field, look: SceneLook): void;
  /** Forgets a crack in progress, for a new run. */
  reset(): void;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
/** The capsule's half width and half height in field units: a little beyond the pickup's reach of 14, so it reads at a glance. */
const CAPSULE_HALF_W = 19;
const CAPSULE_HALF_H = 12.5;
const GLYPH_R = 7.4;
const SPRITE_PAD = 2;
const PICKUP_GLOW_DIAMETER = 66;
const PICKUP_GLOW_ALPHA = 0.65;
/** A capsule breathes in size this fast and this much. */
const BOB_HZ = 1.4;
const BOB = 0.07;
const SHIELD_SHIMMER_HZ = 1.1;
/** The crack: how long the broken ring takes to fly apart, and how much wider it gets. */
export const CRACK_SECONDS = 0.45;
const CRACK_GROWTH = 0.55;
const CRACK_PIECES = 7;

/** A glossy capsule in `color`: lit from above, a white rim, a specular band and the kind's glyph embossed in white. */
function paintCapsule(ctx: CanvasRenderingContext2D, kind: PickupId, color: string): void {
  const w = CAPSULE_HALF_W;
  const h = CAPSULE_HALF_H;
  ctx.beginPath();
  ctx.roundRect(-w, -h, w * 2, h * 2, h);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, -h, 0, h), [mix(color, WHITE, 0.55), color, mix(color, BLACK, 0.55)], [0, 0.45, 1]);
  ctx.fill();
  ctx.strokeStyle = rgba(WHITE, 0.8);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.5, w * 0.68, h * 0.26, 0, 0, TAU);
  ctx.fillStyle = rgba(WHITE, 0.42);
  ctx.fill();
  drawGlyph(ctx, kind, 0, 0.8, GLYPH_R, rgba(mix(color, BLACK, 0.7), 0.55));
  drawGlyph(ctx, kind, 0, 0, GLYPH_R, WHITE);
}

/** A soft bubble: a band of `color` just inside the rim, a bright rim, and a glint on the upper left. */
function paintShield(ctx: CanvasRenderingContext2D, color: string): void {
  const r = SHIELD_RING_RADIUS;
  const band = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  band.addColorStop(0.55, rgba(color, 0));
  band.addColorStop(0.88, rgba(color, 0.32));
  band.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = band;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.9, 0, TAU);
  ctx.strokeStyle = rgba(mix(color, WHITE, 0.45), 0.85);
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.76, Math.PI * 1.08, Math.PI * 1.38);
  ctx.strokeStyle = rgba(WHITE, 0.8);
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

/** The ring broken: jagged pieces with gaps between them, each with a crack running in from its middle. */
function paintCrack(ctx: CanvasRenderingContext2D, color: string): void {
  const r = SHIELD_RING_RADIUS * 0.9;
  const bright = mix(color, WHITE, 0.6);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < CRACK_PIECES; i++) {
    const from = (i / CRACK_PIECES) * TAU + 0.12;
    const to = ((i + 1) / CRACK_PIECES) * TAU - 0.12;
    const mid = (from + to) / 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, from, to);
    ctx.strokeStyle = rgba(color, 0.4);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = bright;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.cos(mid) * r, Math.sin(mid) * r);
    ctx.lineTo(Math.cos(mid + 0.12) * r * 0.8, Math.sin(mid + 0.12) * r * 0.8);
    ctx.lineTo(Math.cos(mid - 0.05) * r * 0.66, Math.sin(mid - 0.05) * r * 0.66);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Draws the pickups and the Shield from baked sprites: per-kind glossy capsules over an additive glow, and the ring
 * that cracks apart when the Shield takes a hit. Keys and painters are made once; a frame of drawing allocates nothing.
 */
export function createPickupPass(ctx: CanvasRenderingContext2D, stamp: Stamp, baker: SpriteBaker, palette: Palette): PickupPass {
  const shieldColor = PICKUP_COLORS.shield;
  const zoom = createZoom();
  const capsules = Object.fromEntries(
    PICKUP_IDS.map((kind) => [
      kind,
      {
        key: `pickup|${palette.id}|${kind}`,
        paint: zoom.wrap((c) => {
          paintCapsule(c, kind, PICKUP_COLORS[kind]);
        }),
      },
    ]),
  ) as Readonly<Record<PickupId, { readonly key: string; readonly paint: (c: CanvasRenderingContext2D) => void }>>;
  const shieldKey = `shield|${palette.id}|ring`;
  const crackKey = `shield|${palette.id}|crack`;
  const paintShieldNow = zoom.wrap((c) => {
    paintShield(c, shieldColor);
  });
  const paintCrackNow = zoom.wrap((c) => {
    paintCrack(c, shieldColor);
  });
  const pose = { x: 0, y: 0, angle: 0 };
  let crack = 0;

  function drawCrack(x: number, y: number, field: Field, still: boolean): void {
    const t = 1 - crack / CRACK_SECONDS;
    const size = still ? 1 : 1 + CRACK_GROWTH * easeOut(t);
    ctx.globalAlpha = 1 - t;
    const sprite = baker.custom(crackKey, (SHIELD_RING_RADIUS + SPRITE_PAD) * zoom.value, paintCrackNow);
    // It turns a little as it flies apart, so the pieces read as breaking away rather than fading.
    const turn = still ? 0 : 0.35 * t;
    stamp(sprite, x, y, Math.cos(turn) * size, Math.sin(turn) * size, sprite.halfW * size, field);
  }

  return {
    handle(events) {
      for (const event of events) if (event.type === 'shieldBroken') crack = CRACK_SECONDS;
    },
    advance(dt) {
      crack = Math.max(0, crack - dt);
    },
    drawPickups(pickups, alpha, field, { glow, time, still, visual }) {
      zoom.value = visual.ship;
      for (const p of pickups) {
        interpolatePose(p.px, p.py, 0, p.x, p.y, 0, alpha, field, pose);
        const shown = expiryAlpha(p.expiresIn, still);
        const size = still ? 1 : 1 + BOB * Math.sin((time * BOB_HZ + p.id * 0.29) * TAU);
        const reach = (PICKUP_GLOW_DIAMETER * zoom.value) / 2;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = PICKUP_GLOW_ALPHA * glow * shown;
        stamp(baker.glow(PICKUP_COLORS[p.kind], reach * 2), pose.x, pose.y, size, 0, reach, field);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = shown;
        const { key, paint } = capsules[p.kind];
        const sprite = baker.custom(key, (CAPSULE_HALF_W + SPRITE_PAD) * zoom.value, paint);
        stamp(sprite, pose.x, pose.y, size, 0, sprite.halfW * size, field);
      }
      ctx.globalAlpha = 1;
    },
    drawShield(left, x, y, field, { still, time, visual }) {
      zoom.value = visual.ship;
      ctx.globalCompositeOperation = 'lighter';
      if (left > 0) {
        const shimmer = still ? 1 : 0.82 + 0.18 * Math.sin(time * SHIELD_SHIMMER_HZ * TAU);
        ctx.globalAlpha = shimmer * expiryAlpha(left, still);
        const sprite = baker.custom(shieldKey, (SHIELD_RING_RADIUS + SPRITE_PAD) * zoom.value, paintShieldNow);
        stamp(sprite, x, y, 1, 0, sprite.halfW, field);
      }
      if (crack > 0) drawCrack(x, y, field, still);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
    reset() {
      crack = 0;
    },
  };
}
