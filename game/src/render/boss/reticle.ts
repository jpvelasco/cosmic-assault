import { TAU } from '../../sim/math';
import { strokePath } from '../sprites';

/** How a target reticle is drawn, in field units: a ring broken into four arcs about the diagonals, and four ticks pointing in. */
export interface ReticleLook {
  /** The arcs' radius. */
  readonly arc: number;
  /** Where each tick starts, out from the centre, and where it ends, nearer in. */
  readonly tickFrom: number;
  readonly tickTo: number;
  /** The colour and width each arc is stroked with, in order; the ticks take the last. */
  readonly passes: readonly (readonly [color: string, width: number])[];
}

/** Half the span of each of the ring's arcs, in radians either side of its diagonal. */
const ARC_HALF_SPAN = 0.5;

/** Paints a target reticle centred on the origin, as `look` says. */
export function paintReticle(ctx: CanvasRenderingContext2D, { arc, tickFrom, tickTo, passes }: ReticleLook): void {
  const tick = passes[passes.length - 1];
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + TAU / 8;
    ctx.beginPath();
    ctx.arc(0, 0, arc, a - ARC_HALF_SPAN, a + ARC_HALF_SPAN);
    for (const [color, width] of passes) strokePath(ctx, color, width);
    const t = a - TAU / 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(t) * tickFrom, Math.sin(t) * tickFrom);
    ctx.lineTo(Math.cos(t) * tickTo, Math.sin(t) * tickTo);
    if (tick !== undefined) strokePath(ctx, tick[0], tick[1]);
  }
}
