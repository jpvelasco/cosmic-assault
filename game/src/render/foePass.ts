import { FOES } from '../content/foes';
import type { FoeKind } from '../content/types';
import type { Field } from '../sim/field';
import type { Foe } from '../sim/foes/foe';
import { TAU } from '../sim/math';
import { mix, rgba } from './color';
import { HIT_FLASH_SECONDS, type FoeFlash } from './hitFlash';
import { interpolatePose } from './interp';
import type { Palette } from './palette';
import { createZoom, type SceneLook, type Stamp } from './scene';
import { addStops, paintGlow, tracePath, type Point, type SpriteBaker } from './sprites';

export interface FoePass {
  /** The foes, `alpha` of the way from their previous pose: a glow under each, then its body. */
  drawFoes(foes: readonly Readonly<Foe>[], alpha: number, field: Field, look: SceneLook): void;
  /** The white silhouettes of foes just hurt, fading over their flash. */
  drawFlashes(flashes: readonly Readonly<FoeFlash>[], field: Field): void;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
/** Room around the art for its rim stroke and baked engine glow, in field units. */
const SPRITE_PAD = 3;
/** The glow under a foe: its diameter as a multiple of the radius, and its alpha at full quality. */
const GLOW_SCALE: Readonly<Record<FoeKind, number>> = { splitter: 2.8, drone: 3.4 };
const GLOW_ALPHA = 0.4;
/** The drone's engine flickers this fast, between these shares of its glow. */
const ENGINE_HZ = 9;

/** The splitter's outline, as shares of its radius at even angles round it: a lumpy rock. */
const SPLITTER_LUMPS = [1, 0.86, 0.97, 0.9, 1.03, 0.84, 0.96, 0.88, 1.01, 0.9];
/** Where its three seams run from, and their bends on the way to the rim, as shares of the radius: one per fragment. */
const SEAM_HUB: Point = { x: 0.08, y: 0.04 };
const SEAMS: readonly (readonly Point[])[] = [
  [{ x: 0.2, y: -0.34 }, { x: 0.12, y: -0.62 }, { x: 0.3, y: -1.05 }],
  [{ x: -0.32, y: 0.12 }, { x: -0.58, y: 0.04 }, { x: -1.05, y: 0.28 }],
  [{ x: 0.3, y: 0.3 }, { x: 0.36, y: 0.62 }, { x: 0.62, y: 0.9 }],
];

/** The drone's hull, nose along +x: swept wings with a notched tail, wider than it is long so it never reads as the ship. */
const DRONE_HULL: readonly Point[] = [
  { x: 13, y: 0 },
  { x: -9, y: 10.5 },
  { x: -4, y: 3.5 },
  { x: -7, y: 0 },
  { x: -4, y: -3.5 },
  { x: -9, y: -10.5 },
];
const DRONE_ENGINE: Point = { x: -8, y: 0 };

/** The sprite cache keys of the foes in `palette`, made once so drawing builds no strings. A splitter has a cracked look at 1 HP. */
export function foeKeys(palette: Palette): Readonly<Record<FoeKind | 'crackedSplitter', string>> {
  return { splitter: `foe|${palette.id}|splitter`, crackedSplitter: `foe|${palette.id}|splitter|cracked`, drone: `foe|${palette.id}|drone` };
}

function strokePath(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function traceSeams(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (const seam of SEAMS) {
    ctx.moveTo(SEAM_HUB.x * r, SEAM_HUB.y * r);
    for (const p of seam) ctx.lineTo(p.x * r, p.y * r);
  }
}

/**
 * The splitter: a lumpy rock lit from the upper left, split by three seams that glow in the accent from inside — the
 * lines it breaks along. `open` widens and brightens them for a splitter one hit from breaking.
 */
function paintSplitter(ctx: CanvasRenderingContext2D, p: Palette, open: boolean): void {
  const r = FOES.splitter.radius;
  const seam = p.accent[2];
  const outline = SPLITTER_LUMPS.map((share, i) => ({ x: Math.cos((i / SPLITTER_LUMPS.length) * TAU) * share * r, y: Math.sin((i / SPLITTER_LUMPS.length) * TAU) * share * r }));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePath(ctx, outline);
  const rock = [mix(p.rock[0], seam, 0.12), mix(p.rock[1], seam, 0.18), mix(p.rock[2], BLACK, 0.25)];
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.4 * r, -0.45 * r, 0.1 * r, 0, 0, 1.1 * r), rock, [0, 0.5, 1]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The heat inside, showing through the cracks: an emissive core, then the seams over it.
  ctx.globalCompositeOperation = 'lighter';
  paintGlow(ctx, seam, SEAM_HUB.x * r, SEAM_HUB.y * r, (open ? 0.8 : 0.55) * r, open ? 0.7 : 0.45);
  traceSeams(ctx, r);
  strokePath(ctx, rgba(seam, 0.4), open ? 7 : 5);
  strokePath(ctx, seam, open ? 3.4 : 2.2);
  strokePath(ctx, mix(seam, WHITE, 0.75), open ? 1.4 : 0.9);
  ctx.globalCompositeOperation = 'source-over';
  paintGlow(ctx, WHITE, -0.42 * r, -0.46 * r, 0.4 * r, 0.14);
  ctx.restore();
  tracePath(ctx, outline);
  strokePath(ctx, p.rockRim, 1.5);
}

/** The drone: a glossy chevron in the first accent, a hot eye at its heart and an engine glowing at the tail. */
function paintDrone(ctx: CanvasRenderingContext2D, p: Palette): void {
  const hull = p.accent[0];
  ctx.globalCompositeOperation = 'lighter';
  paintGlow(ctx, p.ring, DRONE_ENGINE.x, DRONE_ENGINE.y, 8, 1);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'round';
  tracePath(ctx, DRONE_HULL);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, 11, 0, -11), [mix(hull, BLACK, 0.7), mix(hull, BLACK, 0.15), mix(hull, WHITE, 0.55)], [0, 0.5, 1]);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.7), 1);
  // A panel line down the spine, and a glint along the lit leading edge.
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-6, 0);
  strokePath(ctx, rgba(mix(hull, BLACK, 0.7), 0.6), 0.8);
  ctx.beginPath();
  ctx.moveTo(11.4, -1.2);
  ctx.lineTo(-7.4, -9.2);
  strokePath(ctx, rgba(WHITE, 0.65), 0.6);
  ctx.beginPath();
  ctx.ellipse(1.5, 0, 3.6, 2.6, 0, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(0.8, -0.8, 0, 1.5, 0, 3.6), [WHITE, p.shot, mix(p.shot, BLACK, 0.45)], [0, 0.4, 1]);
  ctx.fill();
}

/**
 * Draws the foes from baked glossy sprites (no `shadowBlur`): a cracked splitter rock with glowing seams that open up
 * at 1 HP, and a chevron drone turned to its heading with a flickering engine glow. Keys and painters are made once
 * and sprites are baked at the layout's visual scale, so a frame of drawing allocates nothing.
 */
export function createFoePass(ctx: CanvasRenderingContext2D, stamp: Stamp, baker: SpriteBaker, palette: Palette): FoePass {
  const keys = foeKeys(palette);
  const glowColors: Readonly<Record<FoeKind, string>> = { splitter: palette.accent[2], drone: palette.accent[0] };
  const zoom = createZoom();
  const painters = {
    splitter: zoom.wrap((c) => {
      paintSplitter(c, palette, false);
    }),
    crackedSplitter: zoom.wrap((c) => {
      paintSplitter(c, palette, true);
    }),
    drone: zoom.wrap((c) => {
      paintDrone(c, palette);
    }),
  };
  const pose = { x: 0, y: 0, angle: 0 };
  const halves: Readonly<Record<FoeKind, number>> = { splitter: FOES.splitter.radius * 1.05 + SPRITE_PAD, drone: 15 + SPRITE_PAD };

  function look(foe: Readonly<Foe>): 'splitter' | 'crackedSplitter' | 'drone' {
    return foe.kind === 'splitter' && foe.hp < FOES.splitter.hp ? 'crackedSplitter' : foe.kind;
  }

  function drawGlows(foes: readonly Readonly<Foe>[], alpha: number, field: Field, { glow, time, still }: SceneLook): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const foe of foes) {
      if (foe.hp <= 0) continue;
      interpolatePose(foe.px, foe.py, foe.protation, foe.x, foe.y, foe.rotation, alpha, field, pose);
      const reach = foe.radius * zoom.value * GLOW_SCALE[foe.kind];
      let { x, y } = pose;
      let strength = GLOW_ALPHA;
      if (foe.kind === 'drone') {
        // The glow sits on the engine, behind the drone, and flickers with it.
        x += Math.cos(pose.angle) * DRONE_ENGINE.x * zoom.value;
        y += Math.sin(pose.angle) * DRONE_ENGINE.x * zoom.value;
        if (!still) strength *= 0.75 + 0.25 * Math.sin((time * ENGINE_HZ + foe.id * 0.37) * TAU);
      }
      ctx.globalAlpha = strength * glow;
      stamp(baker.glow(glowColors[foe.kind], reach), x, y, 1, 0, reach / 2, field);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    drawFoes(foes, alpha, field, scene) {
      zoom.value = scene.visual.rock;
      drawGlows(foes, alpha, field, scene);
      for (const foe of foes) {
        // Spent this step and not yet swept: its burst is the picture now.
        if (foe.hp <= 0) continue;
        interpolatePose(foe.px, foe.py, foe.protation, foe.x, foe.y, foe.rotation, alpha, field, pose);
        const art = look(foe);
        const sprite = baker.custom(keys[art], halves[foe.kind] * zoom.value, painters[art]);
        stamp(sprite, pose.x, pose.y, Math.cos(pose.angle), Math.sin(pose.angle), sprite.halfW, field);
      }
    },
    drawFlashes(flashes, field) {
      for (const { kind, x, y, left } of flashes) {
        // Looked up each frame: a rebake may have freed the silhouette since the hit. Skipped, never drawn empty.
        const sprite = baker.white(keys[kind]);
        if (sprite === undefined || sprite.canvas.width === 0) continue;
        ctx.globalAlpha = left / HIT_FLASH_SECONDS;
        stamp(sprite, x, y, 1, 0, sprite.halfW, field);
      }
      ctx.globalAlpha = 1;
    },
  };
}
