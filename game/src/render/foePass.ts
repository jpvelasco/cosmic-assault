import { clamp } from '../content/curves';
import { ARMOURED, FOES, GUNSHIP, MINE } from '../content/foes';
import type { FoeKind } from '../content/types';
import type { Field } from '../sim/field';
import type { Foe } from '../sim/foes/foe';
import { TAU } from '../sim/math';
import { mix, rgba } from './color';
import { HIT_FLASH_SECONDS, type FoeFlash } from './hitFlash';
import { interpolatePose } from './interp';
import type { FieldPen } from './fieldPen';
import type { Palette } from './palette';
import { createZoom, type SceneLook, type Stamp } from './scene';
import { addStops, paintGlow, strokePath, tracePath, type Point, type SpriteBaker } from './sprites';

export interface FoePass {
  /**
   * The foes, `alpha` of the way from their previous pose: under them every mine's arm ring (and, once armed, its blast
   * reach filling as the fuse burns) and every winding-up gunship's aim line to where it will fire; then a glow under
   * each, then its body.
   */
  drawFoes(foes: readonly Readonly<Foe>[], alpha: number, field: Field, look: SceneLook): void;
  /** The white silhouettes of foes just hurt, fading over their flash. */
  drawFlashes(flashes: readonly Readonly<FoeFlash>[], field: Field): void;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
/** Room around the art for its rim stroke and baked engine glow, in field units. */
const SPRITE_PAD = 3;
/** The glow under a foe: its diameter as a multiple of the radius, and its alpha at full quality. */
const GLOW_SCALE: Readonly<Record<FoeKind, number>> = { splitter: 2.8, drone: 3.4, gunship: 1.6, mine: 2.6, phaser: 2.4, armoured: 2.6 };
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

/** The gunship's hull, nose along +x: a broad wedge with a notched tail, its turret forward of its middle. */
const GUNSHIP_HULL: readonly Point[] = [
  { x: 21, y: 0 },
  { x: -13, y: 16 },
  { x: -8, y: 6 },
  { x: -12, y: 0 },
  { x: -8, y: -6 },
  { x: -13, y: -16 },
];
const GUNSHIP_TURRET: Point = { x: 5, y: 0 };
/** While it winds up its turret glow swells to this many times its size and pulses this fast. */
const CHARGE_SWELL = 1.8;
const CHARGE_HZ = 8;

/** The phaser's diamond, and its ghost outline drawn this much larger, as a share of its radius. */
const PHASER_DIAMOND: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
].map((p) => ({ x: p.x * FOES.phaser.radius, y: p.y * FOES.phaser.radius }));
const PHASER_GHOST = 1.3;
/** While it warns, a phaser's origin flashes this fast, and its destination's outline blinks this fast. */
const PHASER_FLASH_HZ = 8;
const PHASER_CHARGE_SWELL = 1.8;
/** The armoured rock's plates: an outline of uneven shares of its radius at even angles, and where its seams run. */
const ARMOUR_LUMPS = [1, 0.94, 0.99, 0.92, 1, 0.95, 0.99, 0.93, 1];
const ARMOUR_SEAMS = 4;
/** The mine's spikes, and how far out they reach and its body sits, in field units. */
const MINE_SPIKES = 8;
const MINE_SPIKE_REACH = 14;
const MINE_BODY = 9;
/** Its arm ring's dashes: how many round it, and how fast it turns (rad/s). Armed, it blinks this fast. */
const RING_DASHES = 24;
const RING_SPIN = 0.35;
const ARMED_HZ = 6;
/** The aim line's dash and gap, in field units, how fast it marches toward the aim, and its width. */
const AIM_DASH: readonly number[] = [10, 7];
const NO_DASH: readonly number[] = [];
const AIM_MARCH = 60;
const AIM_WIDTH = 2;

/** The sprite cache keys of the foes in `palette`, made once so drawing builds no strings. A splitter has a cracked look at 1 HP. */
export function foeKeys(palette: Palette): Readonly<Record<FoeKind | 'crackedSplitter', string>> {
  const key = (art: string): string => `foe|${palette.id}|${art}`;
  return {
    splitter: key('splitter'),
    crackedSplitter: key('splitter|cracked'),
    drone: key('drone'),
    gunship: key('gunship'),
    mine: key('mine'),
    phaser: key('phaser'),
    armoured: key('armoured'),
  };
}

/** The sprite cache keys of a mine's arm ring and its blast reach, and a phaser's blink outline, in `palette`, drawn at their true size on every device. */
export function mineMarkKeys(palette: Palette): Readonly<{ ring: string; blast: string; outline: string }> {
  return { ring: `foe|${palette.id}|mine|ring`, blast: `foe|${palette.id}|mine|blast`, outline: `foe|${palette.id}|phaser|outline` };
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

/** The gunship: a glossy wedge in the first accent, a dark spine, and a turret in the hostile hue whose glow is drawn live. */
function paintGunship(ctx: CanvasRenderingContext2D, p: Palette): void {
  const hull = p.accent[0];
  ctx.lineJoin = 'round';
  tracePath(ctx, GUNSHIP_HULL);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, 16, 0, -16), [mix(hull, BLACK, 0.65), mix(hull, BLACK, 0.2), mix(hull, WHITE, 0.45)], [0, 0.5, 1]);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.65), 1.1);
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(GUNSHIP_TURRET.x, 0);
  strokePath(ctx, rgba(mix(hull, BLACK, 0.75), 0.7), 2.2);
  ctx.beginPath();
  ctx.moveTo(GUNSHIP_TURRET.x, 0);
  ctx.lineTo(19, 0);
  strokePath(ctx, mix(p.hostile, BLACK, 0.35), 2.6);
  ctx.beginPath();
  ctx.arc(GUNSHIP_TURRET.x, GUNSHIP_TURRET.y, 4.6, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(GUNSHIP_TURRET.x - 1, -1, 0, GUNSHIP_TURRET.x, 0, 4.6), [WHITE, p.hostile, mix(p.hostile, BLACK, 0.5)], [0, 0.45, 1]);
  ctx.fill();
}

/** The phaser: a diamond in the first accent with a ghost of its outline, a hot core at its heart. */
function paintPhaser(ctx: CanvasRenderingContext2D, p: Palette): void {
  const hull = p.accent[0];
  ctx.lineJoin = 'round';
  tracePath(ctx, PHASER_DIAMOND.map((q) => ({ x: q.x * PHASER_GHOST, y: q.y * PHASER_GHOST })));
  strokePath(ctx, rgba(hull, 0.35), 1.5);
  tracePath(ctx, PHASER_DIAMOND);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, FOES.phaser.radius, 0, -FOES.phaser.radius), [mix(hull, BLACK, 0.5), mix(hull, BLACK, 0.1), mix(hull, WHITE, 0.45)], [0, 0.5, 1]);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.7), 1);
  ctx.beginPath();
  ctx.arc(0, 0, 3.4, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.6, -0.6, 0, 0, 0, 3.4), [WHITE, hull, mix(hull, BLACK, 0.4)], [0, 0.5, 1]);
  ctx.fill();
}

/** A phaser's blink outline at its destination: a dashed diamond at its true size, in the first accent. */
function paintPhaserOutline(ctx: CanvasRenderingContext2D, p: Palette): void {
  ctx.lineJoin = 'round';
  ctx.setLineDash([5, 4]);
  tracePath(ctx, PHASER_DIAMOND);
  strokePath(ctx, rgba(p.accent[0], 0.9), 2);
  ctx.setLineDash([]);
}

/**
 * The armoured rock: a plated, dark lump with a seam of plates across it, and a soft seam glowing in the third accent over
 * the arc its shots may strike, `ARMOURED.softArc` either side of its nose.
 */
function paintArmoured(ctx: CanvasRenderingContext2D, p: Palette): void {
  const r = FOES.armoured.radius;
  const plate = p.accent[1];
  const outline = ARMOUR_LUMPS.map((share, i) => ({ x: Math.cos((i / ARMOUR_LUMPS.length) * TAU) * share * r, y: Math.sin((i / ARMOUR_LUMPS.length) * TAU) * share * r }));
  ctx.lineJoin = 'round';
  tracePath(ctx, outline);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.4 * r, -0.45 * r, 0.1 * r, 0, 0, 1.1 * r), [mix(plate, WHITE, 0.2), mix(plate, BLACK, 0.4), mix(plate, BLACK, 0.7)], [0, 0.5, 1]);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.45), 1.4);
  ctx.beginPath();
  for (let i = 0; i < ARMOUR_SEAMS; i++) {
    const angle = Math.PI / 4 + (i * TAU) / ARMOUR_SEAMS;
    ctx.moveTo(Math.cos(angle) * 0.35 * r, Math.sin(angle) * 0.35 * r);
    ctx.lineTo(Math.cos(angle) * 0.92 * r, Math.sin(angle) * 0.92 * r);
  }
  strokePath(ctx, rgba(mix(plate, BLACK, 0.5), 0.8), 1.2);
  ctx.beginPath();
  ctx.arc(0, 0, 0.8 * r, -ARMOURED.softArc, ARMOURED.softArc);
  strokePath(ctx, rgba(p.accent[2], 0.65), 9);
  strokePath(ctx, mix(p.accent[2], WHITE, 0.5), 2.6);
}

/** The mine: a dark orb in the second accent bristling with spikes, a hostile light at its heart. */
function paintMine(ctx: CanvasRenderingContext2D, p: Palette): void {
  const shell = p.accent[1];
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < MINE_SPIKES * 2; i++) {
    const angle = (i / (MINE_SPIKES * 2)) * TAU;
    const reach = i % 2 === 0 ? MINE_SPIKE_REACH : MINE_BODY * 0.92;
    ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  ctx.closePath();
  ctx.fillStyle = mix(shell, BLACK, 0.35);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.5), 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, MINE_BODY, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-3, -3.5, 0.5, 0, 0, MINE_BODY), [mix(shell, WHITE, 0.5), shell, mix(shell, BLACK, 0.6)], [0, 0.45, 1]);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, TAU);
  ctx.fillStyle = addStops(ctx.createRadialGradient(-0.6, -0.6, 0, 0, 0, 3.2), [WHITE, p.hostile, mix(p.hostile, BLACK, 0.4)], [0, 0.5, 1]);
  ctx.fill();
}

/** A mine's arm ring at its true radius: dashes in the hostile hue over a faint band, so it reads by shape and colour. */
function paintArmRing(ctx: CanvasRenderingContext2D, p: Palette): void {
  const r = MINE.armRadius;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  strokePath(ctx, rgba(p.hostile, 0.12), 6);
  ctx.lineCap = 'round';
  const dash = TAU / RING_DASHES;
  for (let i = 0; i < RING_DASHES; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, r, i * dash, i * dash + dash * 0.55);
    strokePath(ctx, rgba(p.hostile, 0.85), 2);
  }
}

/** An armed mine's blast reach, at its true radius: a hostile disc brightening toward its rim. */
function paintBlastReach(ctx: CanvasRenderingContext2D, p: Palette): void {
  const r = MINE.blastRadius;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  gradient.addColorStop(0, rgba(p.hostile, 0.08));
  gradient.addColorStop(0.8, rgba(p.hostile, 0.3));
  gradient.addColorStop(1, rgba(p.hostile, 0.55));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = gradient;
  ctx.fill();
  strokePath(ctx, rgba(mix(p.hostile, WHITE, 0.4), 0.9), 2);
}

/**
 * Draws the foes from baked glossy sprites (no `shadowBlur`): a cracked splitter rock with glowing seams that open up
 * at 1 HP, a chevron drone turned to its heading with a flickering engine glow, a wedge gunship whose turret glows and
 * swells as it winds up, and a spiked mine. A mine's arm ring and blast reach are drawn at their true size on every
 * device, since they are what the ship must keep out of. Keys and painters are made once and sprites are baked at the
 * layout's visual scale, so a frame of drawing allocates nothing.
 */
export function createFoePass(ctx: CanvasRenderingContext2D, pen: FieldPen, stamp: Stamp, baker: SpriteBaker, palette: Palette): FoePass {
  const keys = foeKeys(palette);
  const marks = mineMarkKeys(palette);
  const glowColors: Readonly<Record<FoeKind, string>> = {
    splitter: palette.accent[2],
    drone: palette.accent[0],
    gunship: palette.hostile,
    mine: palette.hostile,
    phaser: palette.accent[0],
    armoured: palette.accent[2],
  };
  const zoom = createZoom();
  const painters = {
    phaser: zoom.wrap((c) => {
      paintPhaser(c, palette);
    }),
    armoured: zoom.wrap((c) => {
      paintArmoured(c, palette);
    }),
    splitter: zoom.wrap((c) => {
      paintSplitter(c, palette, false);
    }),
    crackedSplitter: zoom.wrap((c) => {
      paintSplitter(c, palette, true);
    }),
    drone: zoom.wrap((c) => {
      paintDrone(c, palette);
    }),
    gunship: zoom.wrap((c) => {
      paintGunship(c, palette);
    }),
    mine: zoom.wrap((c) => {
      paintMine(c, palette);
    }),
  };
  const paintRing = (c: CanvasRenderingContext2D): void => {
    paintArmRing(c, palette);
  };
  const paintBlast = (c: CanvasRenderingContext2D): void => {
    paintBlastReach(c, palette);
  };
  const paintOutline = (c: CanvasRenderingContext2D): void => {
    paintPhaserOutline(c, palette);
  };
  const pose = { x: 0, y: 0, angle: 0 };
  const halves: Readonly<Record<FoeKind, number>> = {
    splitter: FOES.splitter.radius * 1.05 + SPRITE_PAD,
    drone: 15 + SPRITE_PAD,
    gunship: 22 + SPRITE_PAD,
    mine: MINE_SPIKE_REACH + SPRITE_PAD,
    phaser: FOES.phaser.radius * PHASER_GHOST + SPRITE_PAD,
    armoured: FOES.armoured.radius * 1.05 + SPRITE_PAD,
  };
  const aimColor = palette.hostile;

  function look(foe: Readonly<Foe>): FoeKind | 'crackedSplitter' {
    return foe.kind === 'splitter' && foe.hp < FOES.splitter.hp ? 'crackedSplitter' : foe.kind;
  }

  /** How far through its windup (a gunship) or fuse (a mine) a charging foe is, 0 to 1. */
  function charge(foe: Readonly<Foe>): number {
    return clamp(1 - foe.timer / (foe.kind === 'mine' ? MINE.fuse : GUNSHIP.windup), 0, 1);
  }

  /** Where each warning phaser will blink: its outline, blinking while the warning runs. */
  function drawPhaserOutlines(foes: readonly Readonly<Foe>[], field: Field, still: boolean, time: number): void {
    for (const foe of foes) {
      if (foe.hp <= 0 || foe.kind !== 'phaser' || !foe.charging) continue;
      ctx.globalAlpha = still ? 0.7 : 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(time * TAU * PHASER_FLASH_HZ));
      stamp(baker.custom(marks.outline, FOES.phaser.radius * PHASER_GHOST + SPRITE_PAD, paintOutline), foe.aimX, foe.aimY, 1, 0, FOES.phaser.radius, field);
    }
    ctx.globalAlpha = 1;
  }

  /** Every mine's arm ring, filled with its blast reach once armed; then every winding-up gunship's aim line. */
  function drawMarks(foes: readonly Readonly<Foe>[], alpha: number, field: Field, { time, still }: SceneLook): void {
    for (const foe of foes) {
      if (foe.hp <= 0 || foe.kind !== 'mine') continue;
      interpolatePose(foe.px, foe.py, foe.protation, foe.x, foe.y, foe.rotation, alpha, field, pose);
      const turn = still ? 0 : time * RING_SPIN;
      if (foe.charging) {
        const blink = still ? 1 : 0.6 + 0.4 * Math.sin(time * TAU * ARMED_HZ);
        ctx.globalAlpha = (0.35 + 0.65 * charge(foe)) * blink;
        stamp(baker.custom(marks.blast, MINE.blastRadius + SPRITE_PAD, paintBlast), pose.x, pose.y, 1, 0, MINE.blastRadius, field);
      }
      ctx.globalAlpha = foe.charging ? 1 : 0.7;
      stamp(baker.custom(marks.ring, MINE.armRadius + SPRITE_PAD, paintRing), pose.x, pose.y, Math.cos(turn), Math.sin(turn), MINE.armRadius, field);
    }
    ctx.globalAlpha = 1;
    drawPhaserOutlines(foes, field, still, time);
    drawAimLines(foes, alpha, field, time, still);
  }

  function drawAimLines(foes: readonly Readonly<Foe>[], alpha: number, field: Field, time: number, still: boolean): void {
    pen.field();
    ctx.strokeStyle = aimColor;
    ctx.lineWidth = AIM_WIDTH;
    ctx.setLineDash(AIM_DASH);
    ctx.lineDashOffset = still ? 0 : -time * AIM_MARCH;
    for (const foe of foes) {
      if (foe.hp <= 0 || foe.kind !== 'gunship' || !foe.charging) continue;
      interpolatePose(foe.px, foe.py, foe.protation, foe.x, foe.y, foe.rotation, alpha, field, pose);
      ctx.globalAlpha = 0.35 + 0.6 * charge(foe);
      ctx.beginPath();
      ctx.moveTo(pose.x, pose.y);
      ctx.lineTo(foe.aimX, foe.aimY);
      ctx.stroke();
    }
    ctx.setLineDash(NO_DASH);
    ctx.lineDashOffset = 0;
    ctx.globalAlpha = 1;
  }

  function drawGlows(foes: readonly Readonly<Foe>[], alpha: number, field: Field, { glow, time, still }: SceneLook): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const foe of foes) {
      if (foe.hp <= 0) continue;
      interpolatePose(foe.px, foe.py, foe.protation, foe.x, foe.y, foe.rotation, alpha, field, pose);
      const reach = foe.radius * zoom.value * GLOW_SCALE[foe.kind];
      let { x, y } = pose;
      let strength = GLOW_ALPHA;
      /** The glow's baked diameter, and the share of it drawn. */
      let diameter = reach;
      let size = 1;
      if (foe.kind === 'gunship') {
        // The glow sits on the turret, and swells and pulses as it winds up.
        x += Math.cos(pose.angle) * GUNSHIP_TURRET.x * zoom.value;
        y += Math.sin(pose.angle) * GUNSHIP_TURRET.x * zoom.value;
        if (foe.charging) {
          diameter = reach * CHARGE_SWELL;
          size = (1 + (CHARGE_SWELL - 1) * charge(foe)) / CHARGE_SWELL;
          strength = Math.min(1, 2 * strength * (still ? 1 : 0.8 + 0.2 * Math.sin(time * TAU * CHARGE_HZ)));
        }
      } else if (foe.kind === 'phaser' && foe.charging) {
        // Its origin flashes while it warns, swelling as the blink nears.
        diameter = reach * PHASER_CHARGE_SWELL;
        strength = Math.min(1, 2 * strength * (still ? 1 : 0.5 + 0.5 * Math.sin(time * TAU * PHASER_FLASH_HZ)));
      } else if (foe.kind === 'drone') {
        // The glow sits on the engine, behind the drone, and flickers with it.
        x += Math.cos(pose.angle) * DRONE_ENGINE.x * zoom.value;
        y += Math.sin(pose.angle) * DRONE_ENGINE.x * zoom.value;
        if (!still) strength *= 0.75 + 0.25 * Math.sin((time * ENGINE_HZ + foe.id * 0.37) * TAU);
      }
      ctx.globalAlpha = strength * glow;
      stamp(baker.glow(glowColors[foe.kind], diameter), x, y, size, 0, (diameter * size) / 2, field);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    drawFoes(foes, alpha, field, scene) {
      zoom.value = scene.visual.rock;
      drawMarks(foes, alpha, field, scene);
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
