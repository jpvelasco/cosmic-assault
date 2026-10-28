import { clamp } from '../content/curves';
import { rgba, WHITE } from './color';
import { fillBar, PILL_PAD, type HudRect } from './hudShapes';

/** The boss bar's share of the viewport width, within its least and most width (CSS px at scale 1). */
const BOSS_SHARE = 0.36;
export const BOSS_MIN_W = 160;
const BOSS_MAX_W = 420;
const NAME_GAP = 10;
const TRACK_H = 8;
/** The HP shares a boss changes phase at: one third and two thirds of the way along the bar. */
export const PHASE_NOTCHES = [1 / 3, 2 / 3] as const;
const NOTCH_W = 2;
const HP_TRACK = 'rgba(0,0,0,0.35)';
const NOTCH = rgba(WHITE, 0.75);

/** The width the boss bar would like on a viewport `cssWidth` wide, before the room on its row limits it. */
export function bossBarWidth(cssWidth: number, scale: number): number {
  return clamp(cssWidth * BOSS_SHARE, BOSS_MIN_W * scale, BOSS_MAX_W * scale);
}

/** Lays the HP track into `into`: inside `bar`, after the boss's name (`nameWidth` wide). */
export function placeHpTrack(bar: HudRect, nameWidth: number, scale: number, into: HudRect): void {
  const x = bar.x + PILL_PAD * scale + nameWidth + NAME_GAP * scale;
  Object.assign(into, { x, y: bar.y + (bar.height - TRACK_H * scale) / 2, width: bar.x + bar.width - PILL_PAD * scale - x, height: TRACK_H * scale });
}

/** Where the boss's name starts in its bar. */
export const bossNameX = (bar: HudRect, scale: number): number => bar.x + PILL_PAD * scale;

/**
 * The HP bar: its dark track, the fill to `hp` of `maxHp` in `fill`, and white notches where the phases change. The
 * canvas is decorative to assistive tech; the boss announcer (src/ui/bossAnnouncer.ts) says the same in words.
 */
export function drawBossHp(ctx: CanvasRenderingContext2D, track: HudRect, hp: number, maxHp: number, fill: CanvasGradient | string, scale: number): void {
  fillBar(ctx, track, track.width, HP_TRACK);
  const filled = track.width * clamp(hp / maxHp, 0, 1);
  if (filled > 0) fillBar(ctx, track, Math.max(filled, track.height), fill);
  ctx.fillStyle = NOTCH;
  const reach = 2 * scale;
  for (const share of PHASE_NOTCHES) {
    ctx.fillRect(track.x + track.width * share - (NOTCH_W * scale) / 2, track.y - reach, NOTCH_W * scale, track.height + 2 * reach);
  }
}
