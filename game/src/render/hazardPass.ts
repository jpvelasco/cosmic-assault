import { clamp } from '../content/curves';
import { HAZARD_RULES, WARP_RIFT, WELL_RADIUS, type HazardRule } from '../content/hazards';
import type { Field } from '../sim/field';
import type { HazardState, PointHazardState, RiftState, ZoneState } from '../sim/hazards/hazard';
import { TAU, type Point } from '../sim/math';
import { mix, WHITE } from './color';
import type { FieldPen } from './fieldPen';
import {
  breathOf,
  HOLE_DISC_SQUASH,
  HOLE_RING_RADIUS,
  paintArc,
  paintDashedRing,
  paintDisc,
  paintHoleWarning,
  paintHorizon,
  paintLens,
  paintOutline,
  paintRipple,
  paintZoneActive,
  paintZoneWarning,
  presenceOf,
  wave,
} from './hazardArt';
import type { Palette } from './palette';
import type { SceneLook, Stamp } from './scene';
import { marchDash, solidLines, type Sprite, type SpriteBaker } from './sprites';

export interface HazardPass {
  /**
   * The hazards in play. A gravity well: a faint outline closing in and pulsing while it is a warning; once it pulls,
   * a glow, three arcs swirling round it (held still and breathing under reduced motion) and a dark lens at its heart.
   * A gravity storm's wells are gravity wells, each pair linked by a thin arc, and while they warn one dotted ring round
   * them all; the links and ring hold still under reduced motion.
   * A repulsion field: a warning ring growing outward, then ripples spreading out from its heart. A warp rift, once
   * open: a swirl at each mouth linked by a dashed arc. A lethal danger zone: filled, hatched and outlined solid in the
   * hostile hue (its warning is `drawWarnings`'). A black hole: a dark lens with a bent-light halo and an accretion ring
   * turning over it (still under reduced motion), its warning a dashed ring in the hostile hue. Expects `source-over`,
   * which it leaves as it found it, with alpha 1.
   */
  drawHazards(hazards: readonly Readonly<HazardState>[], field: Field, look: SceneLook): void;
  /** The danger zones' and warp rifts' warnings, drawn over the rocks and foes so nothing hides one. */
  drawWarnings(hazards: readonly Readonly<HazardState>[], field: Field, look: SceneLook): void;
}

/** The black hole: its pull's glow over the field's middle, and its accretion ring turning slowly; under reduced motion it holds still. */
const { telegraph: HOLE_TELEGRAPH_SECONDS, seconds: HOLE_SECONDS } = HAZARD_RULES.blackHole;
const HOLE_SPIN_RATE = 0.9;
const HOLE_GLOW_DIAMETER = 520;
const HOLE_GLOW_ALPHA = 0.45;

/** A repulsion field: its ripples, one a third of a cycle behind the next, spread out from it over this many seconds. */
const { telegraph: REPULSE_TELEGRAPH_SECONDS, seconds: REPULSE_SECONDS } = HAZARD_RULES.repulsionField;
const RIPPLES = 3;
const RIPPLE_SECONDS = 1.6;
/** A warp rift: its mouths are the well's swirl at this share of its size, and linked by a dashed arc that marches. */
const { telegraph: RIFT_TELEGRAPH_SECONDS, seconds: RIFT_SECONDS } = HAZARD_RULES.warpRift;
const RIFT_RADIUS = WARP_RIFT.radius;
const RIFT_LINK_DASH: number[] = [8, 6];
const RIFT_LINK_MARCH = 40;
const RIFT_LINK_WIDTH = 2;
const RIFT_LINK_BOW = 0.18;
/**
 * A gravity storm: its wells linked by thin solid arcs, bowed less than a rift's, and its warning circled by one dotted ring
 * round their middle, reaching half a well past the outermost.
 */
const STORM_LINK_WIDTH = 2;
const STORM_LINK_BOW = 0.14;
const STORM_LINK_SOLID: readonly number[] = [];
const STORM_RING_DOTS: readonly number[] = [1.5, 7];
const STORM_RING_WIDTH = 3;
const STORM_RING_REACH = WELL_RADIUS / 2;

/** A well's telegraph and length: a gravity storm's, for one of its wells, else a gravity well's. */
const wellRule = (well: Readonly<PointHazardState>): HazardRule => HAZARD_RULES[well.storm === true ? 'gravityStorm' : 'gravityWell'];
/** Each intensity adds a share to a well's drawn radius (`WELL_RADIUS` at intensity 1). */
const INTENSITY_GROWTH = 0.2;
const MAX_INTENSITY = 3;
/** Sprites are baked for the largest well and drawn scaled down for the others, so they are never blown up. */
const BAKED_RADIUS = WELL_RADIUS * (1 + INTENSITY_GROWTH * (MAX_INTENSITY - 1));
const SPRITE_PAD = 4;
const GLOW_DIAMETER = BAKED_RADIUS * 2.6;
const GLOW_ALPHA = 0.7;
/** The warning outline starts this much wider and closes onto the well as it comes due, pulsing this fast. */
const OUTLINE_CLOSE = 0.3;
const OUTLINE_PULSE_HZ = 2;

/** The swirling arcs: radius share, how far round each sweeps, width, turn rate (rad/s; inner ones faster) and phase. */
const ARCS = [
  { reach: 0.42, sweep: 0.62, width: 5, rate: 2.1, phase: 0 },
  { reach: 0.68, sweep: 0.55, width: 6.5, rate: 1.3, phase: 2.1 },
  { reach: 0.94, sweep: 0.48, width: 7.5, rate: 0.75, phase: 4.2 },
] as const;

const { telegraph: ZONE_TELEGRAPH_SECONDS, seconds: ZONE_SECONDS } = HAZARD_RULES.dangerZone;
const ZONE_PAD = 4;
/** Seconds a zone takes to fill as it turns lethal and to fade as it ends; the warning pulses this fast. */
const ZONE_FILL_SECONDS = 0.25;
const ZONE_FADE_SECONDS = 0.5;
const ZONE_PULSE_HZ = 2.5;
/** Zone sprites are kept per zone id; past this many ids the oldest are forgotten. */
const ZONE_MEMORY = 16;

/** A link between two points: how far it bows to one side (a share of its length), its width and colour, and its dash, marching this fast. */
interface LinkStyle {
  readonly bow: number;
  readonly width: number;
  readonly color: string;
  readonly dash: readonly number[];
  readonly march: number;
}

/** Whether `hazard` is one of a gravity storm's wells. */
const isStormWell = (hazard: Readonly<HazardState>): hazard is Readonly<PointHazardState> => hazard.type === 'gravityWell' && hazard.storm === true;

/** The drawn size of a well of `intensity`, as a share of the baked sprites. */
const sizeOf = (intensity: number): number => (1 + INTENSITY_GROWTH * (intensity - 1)) / (1 + INTENSITY_GROWTH * (MAX_INTENSITY - 1));

/**
 * The gravity well from baked sprites only (no per-frame gradients, no `shadowBlur`): an additive glow and three
 * comet arcs turned a little each frame, over which sits the dark lens. Keys and painters are made once per palette.
 */
export function createHazardPass(ctx: CanvasRenderingContext2D, pen: FieldPen, stamp: Stamp, baker: SpriteBaker, palette: Palette): HazardPass {
  const [cyan, violet] = palette.accent;
  const arcColors = [mix(cyan, WHITE, 0.3), cyan, violet];
  const arcs = ARCS.map(({ reach, sweep, width, rate, phase }, i) => ({
    key: `well|${palette.id}|arc${String(i)}`,
    rate,
    phase,
    paint: (c: CanvasRenderingContext2D): void => {
      paintArc(c, reach * BAKED_RADIUS, sweep, width, arcColors[i] ?? violet);
    },
  }));
  const horizonKey = `well|${palette.id}|horizon`;
  const outlineKey = `well|${palette.id}|outline`;
  const paintHorizonNow = (c: CanvasRenderingContext2D): void => {
    paintHorizon(c, BAKED_RADIUS, violet);
  };
  const paintOutlineNow = (c: CanvasRenderingContext2D): void => {
    paintOutline(c, BAKED_RADIUS, mix(violet, WHITE, 0.35));
  };
  const half = BAKED_RADIUS + SPRITE_PAD;
  /** A warp rift's two mouths, set in place each frame: the entry and the exit of its pair. */
  const mouths: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  /** Draws `sprite` at (x, y), `size` of its baked size, turned by `angle`. */
  function put(sprite: Sprite, at: Readonly<{ x: number; y: number }>, size: number, angle: number, field: Field): void {
    stamp(sprite, at.x, at.y, Math.cos(angle) * size, Math.sin(angle) * size, sprite.halfW * size, field);
  }

  function drawWarning(well: Readonly<PointHazardState>, field: Field, { time, still }: SceneLook): void {
    const due = clamp(well.remaining / wellRule(well).telegraph, 0, 1);
    const size = sizeOf(well.intensity) * (still ? 1 : 1 + OUTLINE_CLOSE * due);
    ctx.globalAlpha = still ? 0.5 : 0.3 + 0.35 * wave(time, OUTLINE_PULSE_HZ);
    put(baker.custom(outlineKey, half, paintOutlineNow), well, size, 0, field);
  }

  function drawActive(well: Readonly<PointHazardState>, field: Field, look: SceneLook): void {
    const shown = presenceOf(well.remaining, wellRule(well).seconds);
    const size = sizeOf(well.intensity);
    drawSwirl(well, size, size * (0.92 + 0.08 * shown), 1, shown, look, field);
  }

  /**
   * A swirl at `at`, `size` of the baked sprites: a glow, the arcs at `arcSize` turning `turn` ways (1 or -1), and the
   * dark lens growing in with `shown`, all at `shown` and the breath.
   */
  function drawSwirl(at: Readonly<{ x: number; y: number }>, size: number, arcSize: number, turn: number, shown: number, { glow, time, still }: SceneLook, field: Field): void {
    const breath = breathOf(time, still);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GLOW_ALPHA * glow * shown * breath;
    put(baker.glow(violet, GLOW_DIAMETER), at, size, 0, field);
    ctx.globalAlpha = shown * breath;
    for (const arc of arcs) put(baker.custom(arc.key, half, arc.paint), at, arcSize, (still ? 0 : turn * time * arc.rate) + arc.phase, field);
    ctx.globalCompositeOperation = 'source-over';
    if (shown > 0) put(baker.custom(horizonKey, half, paintHorizonNow), at, size * shown, 0, field);
  }

  const holeLensKey = `hole|${palette.id}|lens`;
  const holeDiscKey = `hole|${palette.id}|disc`;
  const holeWarnKey = `hole|${palette.id}|warn`;
  const [holeGlow, holeDisc, holeRim] = palette.accent;
  const paintLensNow = (c: CanvasRenderingContext2D): void => {
    paintLens(c, holeRim);
  };
  const paintDiscNow = (c: CanvasRenderingContext2D): void => {
    paintDisc(c, holeDisc);
  };
  const paintHoleWarnNow = (c: CanvasRenderingContext2D): void => {
    paintHoleWarning(c, palette.hostile);
  };
  const holeLensHalf = HOLE_RING_RADIUS + SPRITE_PAD;
  const holeDiscHalf = HOLE_RING_RADIUS + SPRITE_PAD;
  const holeDiscHalfH = HOLE_RING_RADIUS * HOLE_DISC_SQUASH + SPRITE_PAD;

  /**
   * An active black hole: its glow over the field, the dark lens at its horizon and the accretion ring turning over it.
   * Each is a baked sprite, and under reduced motion the ring holds still.
   */
  function drawHole(hole: Readonly<PointHazardState>, field: Field, { glow, time, still }: SceneLook): void {
    const shown = presenceOf(hole.remaining, HOLE_SECONDS);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = HOLE_GLOW_ALPHA * glow * shown;
    put(baker.glow(holeGlow, HOLE_GLOW_DIAMETER), hole, 1, 0, field);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = shown;
    put(baker.custom(holeLensKey, holeLensHalf, paintLensNow), hole, 1, 0, field);
    ctx.globalCompositeOperation = 'lighter';
    put(baker.custom(holeDiscKey, holeDiscHalf, paintDiscNow, holeDiscHalfH), hole, 1, still ? 0 : time * HOLE_SPIN_RATE, field);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A black hole's warning: its rings, pulsing faster as it comes due; still under reduced motion. */
  function drawHoleWarning(hole: Readonly<PointHazardState>, field: Field, { time, still }: SceneLook): void {
    const due = 1 - clamp(hole.remaining / HOLE_TELEGRAPH_SECONDS, 0, 1);
    ctx.globalAlpha = still ? 0.7 : 0.4 + 0.4 * wave(time, OUTLINE_PULSE_HZ + 2 * due);
    put(baker.custom(holeWarnKey, holeDiscHalf, paintHoleWarnNow), hole, 1, 0, field);
  }

  const rippleKey = `repulse|${palette.id}|ripple`;
  const repulseOutlineKey = `repulse|${palette.id}|outline`;
  const paintRippleNow = (c: CanvasRenderingContext2D): void => {
    paintRipple(c, BAKED_RADIUS, cyan);
  };
  const paintRepulseOutlineNow = (c: CanvasRenderingContext2D): void => {
    paintOutline(c, BAKED_RADIUS, cyan);
  };
  /** A rift's mouths reuse the well's arcs, horizon and glow at this share of their size. */
  const MOUTH_SCALE = (RIFT_RADIUS * 1.6) / BAKED_RADIUS;
  const riftOutlineKey = `rift|${palette.id}|outline`;
  const paintRiftOutlineNow = (c: CanvasRenderingContext2D): void => {
    paintDashedRing(c, BAKED_RADIUS, violet);
  };

  /** A repulsion field: a glow and ripples spreading out from it, a warning ring growing outward as it comes due. */
  function drawRepulsionWarning(force: Readonly<PointHazardState>, field: Field, { time, still }: SceneLook): void {
    const due = clamp(1 - force.remaining / REPULSE_TELEGRAPH_SECONDS, 0, 1);
    const size = sizeOf(force.intensity) * (still ? 1 : 0.5 + 0.5 * due);
    ctx.globalAlpha = still ? 0.5 : 0.3 + 0.35 * wave(time, OUTLINE_PULSE_HZ);
    put(baker.custom(repulseOutlineKey, half, paintRepulseOutlineNow), force, size, 0, field);
  }

  function drawRepulsion(force: Readonly<PointHazardState>, field: Field, { glow, time, still }: SceneLook): void {
    const shown = presenceOf(force.remaining, REPULSE_SECONDS);
    const size = sizeOf(force.intensity);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GLOW_ALPHA * glow * shown * 0.6;
    put(baker.glow(cyan, GLOW_DIAMETER), force, size, 0, field);
    for (let k = 0; k < RIPPLES; k++) {
      // Each ripple spreads from the field's heart to its full reach, fading as it goes; still, they hold their places.
      const phase = still ? k / RIPPLES : ((time / RIPPLE_SECONDS + k / RIPPLES) % 1);
      ctx.globalAlpha = shown * (1 - phase) * 0.9;
      put(baker.custom(rippleKey, half, paintRippleNow), force, size * (0.15 + 0.85 * phase), 0, field);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A warp rift's warning: a dashed ring over each mouth, pulsing faster as the rift comes due. */
  function drawRiftWarning(rift: Readonly<RiftState>, field: Field, { time, still }: SceneLook): void {
    const due = 1 - clamp(rift.remaining / RIFT_TELEGRAPH_SECONDS, 0, 1);
    ctx.globalAlpha = still ? 0.6 : 0.35 + 0.4 * wave(time, OUTLINE_PULSE_HZ + 2 * due);
    placeMouths(rift);
    for (const mouth of mouths) put(baker.custom(riftOutlineKey, half, paintRiftOutlineNow), mouth, MOUTH_SCALE, 0, field);
    drawLink(mouths[0], mouths[1], riftLink, time, still, 0.35);
  }

  /** A warp rift open: each mouth a swirl of the well's arcs over a dark lens, the two linked by a dashed arc. */
  function drawRiftOpen(rift: Readonly<RiftState>, field: Field, look: SceneLook): void {
    const shown = presenceOf(rift.remaining, RIFT_SECONDS);
    placeMouths(rift);
    drawLink(mouths[0], mouths[1], riftLink, look.time, look.still, shown * breathOf(look.time, look.still));
    // The two mouths turn in opposite ways, so the pair reads as a pair.
    drawSwirl(mouths[0], MOUTH_SCALE, MOUTH_SCALE, 1, shown, look, field);
    drawSwirl(mouths[1], MOUTH_SCALE, MOUTH_SCALE, -1, shown, look, field);
  }

  /** Sets `mouths` to where a warp rift's two mouths sit. */
  function placeMouths(rift: Readonly<RiftState>): void {
    mouths[0].x = rift.x;
    mouths[0].y = rift.y;
    mouths[1].x = rift.toX;
    mouths[1].y = rift.toY;
  }

  /** A rift's mouths are linked by a dashed arc marching toward the far mouth; a storm's wells by solid ones. */
  const riftLink: LinkStyle = { bow: RIFT_LINK_BOW, width: RIFT_LINK_WIDTH, color: violet, dash: RIFT_LINK_DASH, march: RIFT_LINK_MARCH };
  const stormColor = mix(cyan, WHITE, 0.45);
  const stormLink: LinkStyle = { bow: STORM_LINK_BOW, width: STORM_LINK_WIDTH, color: stormColor, dash: STORM_LINK_SOLID, march: 0 };

  /** The arc from `from` to `to` in `style`, bowed a little to one side, at `alpha`. */
  function drawLink(from: Readonly<Point>, to: Readonly<Point>, style: LinkStyle, time: number, still: boolean, alpha: number): void {
    if (alpha <= 0) return;
    pen.field();
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const bow = style.bow * Math.hypot(to.x - from.x, to.y - from.y);
    const nx = -(to.y - from.y);
    const ny = to.x - from.x;
    const length = Math.hypot(nx, ny) || 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mx + (nx / length) * bow * 2, my + (ny / length) * bow * 2, to.x, to.y);
    marchDash(ctx, style.dash, time, style.march, still);
    ctx.lineWidth = style.width;
    ctx.strokeStyle = style.color;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    solidLines(ctx);
    ctx.globalAlpha = 1;
  }

  /**
   * A gravity storm's art, under its wells: every pair of them linked, and while they warn one dotted ring round their
   * middle. A field has at most one storm in play, so every storm well is the same storm's. Walks the list by index, so
   * a frame allocates nothing; under reduced motion the links and ring hold their alpha still.
   */
  function drawStorm(hazards: readonly Readonly<HazardState>[], { time, still }: SceneLook): void {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let warning = false;
    for (let i = 0; i < hazards.length; i++) {
      const a = hazards[i];
      if (a === undefined || !isStormWell(a)) continue;
      count++;
      sumX += a.x;
      sumY += a.y;
      warning = a.stage === 'warning';
      const alpha = warning ? (still ? 0.5 : 0.3 + 0.2 * wave(time, OUTLINE_PULSE_HZ)) : 0.8 * presenceOf(a.remaining, wellRule(a).seconds);
      for (let j = i + 1; j < hazards.length; j++) {
        const b = hazards[j];
        if (b !== undefined && isStormWell(b)) drawLink(a, b, stormLink, time, still, alpha);
      }
    }
    if (warning) drawStormRing(hazards, sumX / count, sumY / count, still ? 0.6 : 0.4 + 0.35 * wave(time, OUTLINE_PULSE_HZ));
  }

  /** The dotted ring round the storm's wells, centred on (cx, cy), their middle, and reaching past the outermost by `STORM_RING_REACH`. */
  function drawStormRing(hazards: readonly Readonly<HazardState>[], cx: number, cy: number, alpha: number): void {
    let reach = 0;
    for (const h of hazards) if (isStormWell(h)) reach = Math.max(reach, Math.hypot(h.x - cx, h.y - cy));
    pen.field();
    ctx.setLineDash(STORM_RING_DOTS);
    ctx.lineCap = 'round';
    ctx.lineWidth = STORM_RING_WIDTH;
    ctx.strokeStyle = stormColor;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, reach + STORM_RING_REACH, 0, TAU);
    ctx.stroke();
    solidLines(ctx);
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  const zoneColor = palette.hostile;
  /** Each zone's two sprites, keyed and painted at its own size, made once as it is first drawn. */
  const zoneArt = new Map<number, { readonly warning: string; readonly active: string; readonly paintWarning: (c: CanvasRenderingContext2D) => void; readonly paintActive: (c: CanvasRenderingContext2D) => void }>();

  function artOf(zone: Readonly<ZoneState>) {
    const known = zoneArt.get(zone.id);
    if (known !== undefined) return known;
    if (zoneArt.size >= ZONE_MEMORY) zoneArt.clear();
    const size = `${zone.w.toFixed(1)}x${zone.h.toFixed(1)}`;
    const art = {
      warning: `zone|${palette.id}|warning|${size}`,
      active: `zone|${palette.id}|active|${size}`,
      paintWarning: (c: CanvasRenderingContext2D): void => {
        paintZoneWarning(c, zone.w, zone.h, zoneColor);
      },
      paintActive: (c: CanvasRenderingContext2D): void => {
        paintZoneActive(c, zone.w, zone.h, zoneColor);
      },
    };
    zoneArt.set(zone.id, art);
    return art;
  }

  function drawZone(zone: Readonly<ZoneState>, field: Field, { time, still }: SceneLook): void {
    const art = artOf(zone);
    const warning = zone.stage === 'warning';
    const sprite = warning ? baker.custom(art.warning, zone.w / 2 + ZONE_PAD, art.paintWarning, zone.h / 2 + ZONE_PAD) : baker.custom(art.active, zone.w / 2 + ZONE_PAD, art.paintActive, zone.h / 2 + ZONE_PAD);
    // A warning pulses faster as it comes due; reduced motion holds it steady.
    const due = 1 - clamp(zone.remaining / ZONE_TELEGRAPH_SECONDS, 0, 1);
    ctx.globalAlpha = warning ? (still ? 0.75 : 0.45 + 0.4 * wave(time, ZONE_PULSE_HZ * (1 + due))) : presenceOf(zone.remaining, ZONE_SECONDS, ZONE_FILL_SECONDS, ZONE_FADE_SECONDS);
    stamp(sprite, zone.x, zone.y, 1, 0, Math.max(zone.w, zone.h) / 2, field);
  }

  return {
    drawHazards(hazards, field, look) {
      drawStorm(hazards, look);
      for (const hazard of hazards) {
        if (hazard.type === 'dangerZone') {
          if (hazard.stage === 'active') drawZone(hazard, field, look);
        } else if (hazard.type === 'gravityWell') (hazard.stage === 'warning' ? drawWarning : drawActive)(hazard, field, look);
        else if (hazard.type === 'repulsionField') {
          if (hazard.stage === 'warning') drawRepulsionWarning(hazard, field, look);
          else drawRepulsion(hazard, field, look);
        } else if (hazard.type === 'warpRift' && hazard.stage === 'active') drawRiftOpen(hazard, field, look);
        else if (hazard.type === 'blackHole' && hazard.stage === 'active') drawHole(hazard, field, look);
        ctx.globalAlpha = 1;
      }
    },
    drawWarnings(hazards, field, look) {
      for (const hazard of hazards) {
        if (hazard.type === 'dangerZone' && hazard.stage === 'warning') drawZone(hazard, field, look);
        else if (hazard.type === 'warpRift' && hazard.stage === 'warning') drawRiftWarning(hazard, field, look);
        else if (hazard.type === 'blackHole' && hazard.stage === 'warning') drawHoleWarning(hazard, field, look);
      }
      ctx.globalAlpha = 1;
    },
  };
}
