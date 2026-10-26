import { clamp } from '../content/curves';
import type { ShowerState } from '../sim/galaxy/showers';
import { TAU } from '../sim/math';
import { rgba } from './color';
import { fillBar, WHITE, type HudRect } from './hudShapes';

/** The timer bar's gap under the galaxy pill, and its height, in CSS px at scale 1. */
export const TIMER_GAP = 4;
export const TIMER_H = 4;
/** The combo pill's padding either side of its text. */
export const COMBO_PAD = 8;

const TRACK = rgba(WHITE, 0.14);
// Shower arrows: three chevrons pointing in from the edge, pulsing in turn.
const CHEVRONS = 3;
const CHEVRON_MARGIN = 26;
const CHEVRON_SPACING = 15;
const CHEVRON_HALF_W = 14;
const CHEVRON_DEPTH = 9;
const CHEVRON_PULSE_HZ = 1.6;
const CHEVRON_GLOW_ALPHA = 0.28;

/** How full the timer bar is: the share of the galaxy gone, from 0 at its start to 1 as it warps out. */
export function timerFraction(timeLeft: number, duration: number): number {
  return duration > 0 ? clamp(1 - timeLeft / duration, 0, 1) : 1;
}

/** The bearing of the edge a shower is being telegraphed from, or null when none is (none, or already falling). */
export function showerWarningAngle(shower: Readonly<ShowerState> | null): number | null {
  return shower?.stage === 'warning' ? shower.angle : null;
}

/** The timer bar `bar`, its track and then its fill to `fraction` (from `timerFraction`). */
export function drawTimer(ctx: CanvasRenderingContext2D, bar: HudRect, fraction: number, fill: CanvasGradient | string): void {
  fillBar(ctx, bar, bar.width, TRACK);
  const filled = bar.width * fraction;
  if (filled > 0) fillBar(ctx, bar, Math.max(filled, bar.height), fill);
}

/** Where the chevrons go: the viewport, its safe-area insets and the HUD scale. */
export interface ChevronView {
  readonly width: number;
  readonly height: number;
  readonly insets: { readonly top: number; readonly right: number; readonly left: number };
  readonly scale: number;
}

/** How bright chevron `i` is at `time`: steady when `still`, else pulsing in turn. */
export function chevronPulse(i: number, time: number, still: boolean): number {
  return still ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * TAU * CHEVRON_PULSE_HZ - i * 1.1));
}

/**
 * Three chevrons just inside the edge at bearing `angle`, pointing in, in `color`. Each is a wide faint stroke under a
 * narrow bright one: a glow without `shadowBlur`.
 */
export function drawShowerWarning(ctx: CanvasRenderingContext2D, angle: number, view: ChevronView, color: string, time: number, still: boolean): void {
  const s = view.scale;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const margin = CHEVRON_MARGIN * s;
  const anchorX = view.width / 2 + cos * (view.width / 2 - margin - (cos < 0 ? view.insets.left : view.insets.right));
  const anchorY = view.height / 2 + sin * (view.height / 2 - margin - (sin < 0 ? view.insets.top : 0));
  // (dx, dy) points in from the edge, (px, py) along it.
  const dx = -cos;
  const dy = -sin;
  const px = sin;
  const py = -cos;
  const depth = (CHEVRON_DEPTH * s) / 2;
  const half = CHEVRON_HALF_W * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  for (let i = 0; i < CHEVRONS; i++) {
    const cx = anchorX + dx * i * CHEVRON_SPACING * s;
    const cy = anchorY + dy * i * CHEVRON_SPACING * s;
    const pulse = chevronPulse(i, time, still);
    ctx.beginPath();
    ctx.moveTo(cx - dx * depth + px * half, cy - dy * depth + py * half);
    ctx.lineTo(cx + dx * depth, cy + dy * depth);
    ctx.lineTo(cx - dx * depth - px * half, cy - dy * depth - py * half);
    ctx.globalAlpha = pulse * CHEVRON_GLOW_ALPHA;
    ctx.lineWidth = 8 * s;
    ctx.stroke();
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
