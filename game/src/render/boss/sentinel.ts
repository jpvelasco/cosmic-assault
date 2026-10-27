import type { BossPhase } from '../../sim/boss/behaviour';
import { TAU } from '../../sim/math';
import { mix, rgba } from '../color';
import type { Palette } from '../palette';
import { blitCore, radial, RIM_PAD, type DrawerFactory } from './drawer';

const WHITE = '#ffffff';
/** How far the eye looks toward the ship, as a share of the core radius. */
const EYE_REACH = 0.2;
const EYE_SIZE = 0.3;
const STUDS = 8;

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

/** The cache keys of the Sentinel's sprites at `radius`, made once per radius so drawing builds no strings. */
function keysFor(radius: number): { readonly core: string; readonly eyes: Readonly<Record<BossPhase, string>> } {
  const size = String(radius);
  return { core: `boss|core|${size}`, eyes: { 1: `boss|eye|1|${size}`, 2: `boss|eye|2|${size}`, 3: `boss|eye|3|${size}` } };
}

/** The Sentinel: an armoured violet core, and an eye in its socket that looks toward the ship, its colour by phase. */
export const sentinelDrawer: DrawerFactory = (kit) => {
  const { pen, baker, palette } = kit;
  const eyeColors: Readonly<Record<BossPhase, string>> = { 1: palette.accent[0], 2: palette.ring, 3: palette.shot };
  /** The radius the sprites are keyed and painted for; a boss keeps one, so they are made once a fight. */
  let radius = 0;
  let keys = keysFor(radius);
  const paintCoreAt = (c: CanvasRenderingContext2D): void => {
    paintCore(c, radius, palette);
  };
  const eyePainter = (phase: BossPhase) => (c: CanvasRenderingContext2D): void => {
    paintEye(c, radius * EYE_SIZE, eyeColors[phase]);
  };
  const eyePainters = { 1: eyePainter(1), 2: eyePainter(2), 3: eyePainter(3) };
  return {
    glow: palette.accent[1],
    body(boss, { x, y, size, tinted, look }) {
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        keys = keysFor(r);
      }
      pen.place(x, y, size, 0);
      blitCore(kit, keys.core, r + RIM_PAD, paintCoreAt, tinted);
      const dx = look.aimX - x;
      const dy = look.aimY - y;
      const reach = (EYE_REACH * r * size) / Math.max(1, Math.hypot(dx, dy));
      pen.place(x + dx * reach, y + dy * reach, size, 0);
      pen.blit(baker.custom(keys.eyes[boss.phase], r * EYE_SIZE + RIM_PAD, eyePainters[boss.phase]));
    },
  };
};
