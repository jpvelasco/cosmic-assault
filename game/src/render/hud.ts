import { BOSSES } from '../content/bosses';
import { clamp } from '../content/curves';
import { galaxyLabel } from '../content/galaxies';
import type { BossId, GalaxyDef } from '../content/types';
import type { ShowerState } from '../sim/galaxy/showers';
import { TAU } from '../sim/math';
import type { World } from '../sim/world';
import { rgba } from './color';
import type { Palette } from './palette';
import { SHIP_HULL } from './sprites';

/** Safe-area insets in CSS px. The HUD sits at the top, so the bottom inset never matters. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly left: number;
}

/** A box anchored to the viewport's top-right corner, `width` from the right edge and `height` from the top. */
export interface CornerBox {
  readonly width: number;
  readonly height: number;
}

export interface HudBounds {
  readonly insets: Insets;
  /** A corner the right pill keeps clear of, such as the touch pause button; null when there is none. */
  readonly topRight: CornerBox | null;
}

/** A pill's box in CSS px from the viewport's top left. */
export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The HUD's pills, in draw order: the score, the lives, the galaxy (the practice level outside a galaxy), the timer bar
 * under it, the combo multiplier and the boss's HP bar.
 */
export type HudPill = 'score' | 'lives' | 'galaxy' | 'timer' | 'combo' | 'boss';
export const HUD_PILLS: readonly HudPill[] = ['score', 'lives', 'galaxy', 'timer', 'combo', 'boss'];
/** The pills drawn as plain glass; the combo wears the accent and the timer is a bar. */
const GLASS_PILLS: readonly HudPill[] = ['score', 'lives', 'galaxy', 'boss'];

export interface Hud {
  resize(cssWidth: number, cssHeight: number): void;
  setBounds(bounds: HudBounds): void;
  /**
   * Draws the pills, showing `score` (in Rank, the run's total) and, while a shower is telegraphed, arrows at its edge.
   * `still` holds the arrows steady for reduced motion. The caller sets a CSS-px transform (identity × dpr).
   */
  draw(ctx: CanvasRenderingContext2D, world: World, score: number, still?: boolean): void;
  /** The pills drawn last, in CSS px, in draw order. */
  readonly rects: readonly HudRect[];
  /** The named pill as drawn last, or null when it was not shown. */
  pill(id: HudPill): HudRect | null;
}

const ROUNDED = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const WHITE = '#ffffff';
const PILL_FILL = rgba(WHITE, 0.09);
const PILL_STROKE = rgba(WHITE, 0.18);
const BRIGHT_STROKE = rgba(WHITE, 0.45);
const TRACK = rgba(WHITE, 0.14);
const HP_TRACK = 'rgba(0,0,0,0.35)';
const NOTCH = rgba(WHITE, 0.75);
const LIFE_ICON = '#5dff4a';
const GALAXY_CAPTION = 'GALAXY';

// Sizes in CSS px at scale 1, from the mockup's 480×300 panel.
const EDGE = 12;
const PILL_H = 28;
const MIN_SCORE_W = 122;
const SCORE_LABEL_X = 12;
const SCORE_VALUE_X = 48;
const PILL_PAD = 12;
/** Between a caption and its value. */
const CAPTION_GAP = 6;
const LIVES_GAP = 6;
const LIVES_H = 20;
const LIFE_FIRST_X = 14;
const LIFE_SPACING = 16;
const LIFE_ICON_SCALE = 0.5;
/** Room between the right pill and the score pill or the corner box it avoids. */
const PILL_GAP = 8;
const TIMER_GAP = 4;
const TIMER_H = 4;
const COMBO_PAD = 8;
/** The boss bar's share of the viewport width, within its least and most width. */
const BOSS_SHARE = 0.36;
const BOSS_MIN_W = 160;
const BOSS_MAX_W = 420;
const BOSS_NAME_GAP = 10;
const BOSS_TRACK_H = 8;
/** The HP shares a boss changes phase at: two thirds and one third. */
const PHASE_NOTCHES = [1 / 3, 2 / 3] as const;
const NOTCH_W = 2;
// Shower arrows: three chevrons pointing in from the edge, pulsing in turn.
const CHEVRONS = 3;
const CHEVRON_MARGIN = 26;
const CHEVRON_SPACING = 15;
const CHEVRON_HALF_W = 14;
const CHEVRON_DEPTH = 9;
const CHEVRON_PULSE_HZ = 1.6;
/** The HUD grows with the viewport height, from 1 at this height up to MAX_SCALE. */
const SCALE_HEIGHT = 480;
const MAX_SCALE = 1.5;

const SCORE_FORMAT = new Intl.NumberFormat();
const NO_BOUNDS: HudBounds = { insets: { top: 0, right: 0, left: 0 }, topRight: null };

const box = (): HudRect => ({ x: 0, y: 0, width: 0, height: 0 });
const bottom = (r: HudRect): number => r.y + r.height;

/** HUD scale for a viewport of `cssHeight` CSS px. */
export function hudScale(cssHeight: number): number {
  return Math.min(MAX_SCALE, Math.max(1, cssHeight / SCALE_HEIGHT));
}

/** The right edge (CSS px) for a pill whose top is at `top`: inside the inset, and left of the corner box when they share rows. */
export function rightPillEdge(cssWidth: number, top: number, edge: number, bounds: HudBounds, gap: number): number {
  const inside = cssWidth - Math.max(edge, bounds.insets.right);
  const corner = bounds.topRight;
  return corner !== null && corner.height > top ? Math.min(inside, cssWidth - corner.width - gap) : inside;
}

/** How full the timer bar is: the share of the galaxy gone, from 0 at its start to 1 as it warps out. */
export function timerFraction(timeLeft: number, duration: number): number {
  return duration > 0 ? clamp(1 - timeLeft / duration, 0, 1) : 1;
}

/** The bearing of the edge a shower is being telegraphed from, or null when none is (none, or already falling). */
export function showerWarningAngle(shower: Readonly<ShowerState> | null): number | null {
  return shower?.stage === 'warning' ? shower.angle : null;
}

function tracePill(ctx: CanvasRenderingContext2D, r: HudRect): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, r.height / 2);
  ctx.fill();
  ctx.stroke();
}

function fillBar(ctx: CanvasRenderingContext2D, r: HudRect, width: number, style: string | CanvasGradient): void {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, width, r.height, r.height / 2);
  ctx.fill();
}

function across(ctx: CanvasRenderingContext2D, r: HudRect, from: string, to: string): CanvasGradient {
  const gradient = ctx.createLinearGradient(r.x, 0, r.x + r.width, 0);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  return gradient;
}

/** The text a pill shows, and its width, measured only when it changes. */
interface Measured {
  text: string;
  width: number;
}

const measured = (): Measured => ({ text: '', width: 0 });

export function createHud(palette: Palette): Hud {
  const boxes: Readonly<Record<HudPill, HudRect>> = { score: box(), lives: box(), galaxy: box(), timer: box(), combo: box(), boss: box() };
  const { score, lives, galaxy, timer, combo, boss } = boxes;
  const shown: Record<HudPill, boolean> = { score: true, lives: false, galaxy: true, timer: false, combo: false, boss: false };
  /** The HP track inside the boss bar. */
  const hpTrack = box();
  let rects: readonly HudRect[] = [];
  let bounds = NO_BOUNDS;
  let cssWidth = 0;
  let cssHeight = 0;
  let scale = 1;
  let labelFont = '';
  let valueFont = '';
  let practiceFont = '';
  let comboFont = '';
  let dirty = true;
  // Text and its measured width are cached by value: rebuilt only when it changes.
  let shownScore = -1;
  const scoreText = measured();
  let shownLives = -1;
  let shownGalaxy: GalaxyDef | null | undefined;
  let shownLevel = 0;
  const caption = measured();
  const level = measured();
  let shownMultiplier = 1;
  const comboText = measured();
  let shownBoss: BossId | null = null;
  const bossName = measured();
  let timerFill: CanvasGradient | string = '';
  let comboFill: CanvasGradient | string = '';
  let hpFill: CanvasGradient | string = '';

  /** Sets `into` to `text` in `font`, measuring it, and marks the layout stale when it changed. */
  function remeasure(ctx: CanvasRenderingContext2D, into: Measured, text: string, font: string): void {
    if (into.text === text) return;
    into.text = text;
    ctx.font = font;
    into.width = text === '' ? 0 : ctx.measureText(text).width;
    dirty = true;
  }

  function show(id: HudPill, on: boolean): void {
    if (shown[id] === on) return;
    shown[id] = on;
    dirty = true;
  }

  function measure(ctx: CanvasRenderingContext2D, world: World, value: number): void {
    if (value !== shownScore) {
      shownScore = value;
      remeasure(ctx, scoreText, SCORE_FORMAT.format(value), valueFont);
    }
    const { galaxy: def, boss: fight, multiplier } = world;
    // The level only changes with the World, so its text is rebuilt only then.
    if (def !== shownGalaxy || world.practiceLevel !== shownLevel) {
      shownGalaxy = def;
      shownLevel = world.practiceLevel;
      remeasure(ctx, caption, def === null ? '' : GALAXY_CAPTION, labelFont);
      remeasure(ctx, level, def === null ? `Practice L${String(shownLevel)}` : galaxyLabel(def.id), def === null ? practiceFont : valueFont);
    }
    if (world.lives !== shownLives) {
      shownLives = world.lives;
      dirty = true;
    }
    show('lives', shownLives > 0);
    show('timer', def !== null && fight === null);
    show('combo', multiplier > 1);
    if (multiplier > 1 && multiplier !== shownMultiplier) {
      shownMultiplier = multiplier;
      remeasure(ctx, comboText, `×${String(multiplier)}`, comboFont);
    }
    const bossId = def?.boss ?? null;
    show('boss', fight !== null && fight.state !== 'down' && bossId !== null);
    if (shown.boss && bossId !== null && bossId !== shownBoss) {
      shownBoss = bossId;
      remeasure(ctx, bossName, BOSSES[bossId].name.toUpperCase(), labelFont);
    }
  }

  function layoutLevel(left: number, top: number): void {
    const s = scale;
    const width = caption.text === '' ? level.width + 2 * PILL_PAD * s : caption.width + level.width + (2 * PILL_PAD + CAPTION_GAP) * s;
    const right = rightPillEdge(cssWidth, top, EDGE * s, bounds, PILL_GAP * s);
    // Never over the score pill: when the top row is too narrow, the level drops below the lives pill.
    const x = Math.max(right - width, score.x + score.width + PILL_GAP * s);
    const fits = x + width <= right;
    Object.assign(galaxy, { x: fits ? x : left, y: fits ? top : bottom(lives) + LIVES_GAP * s, width, height: PILL_H * s });
    Object.assign(timer, { x: galaxy.x + galaxy.height / 2, y: bottom(galaxy) + TIMER_GAP * s, width: galaxy.width - galaxy.height, height: TIMER_H * s });
  }

  /** Top centre, between the score and galaxy pills; below every other pill where that row is too narrow. */
  function layoutBoss(left: number, top: number): void {
    const s = scale;
    const gap = PILL_GAP * s;
    const want = clamp(cssWidth * BOSS_SHARE, BOSS_MIN_W * s, BOSS_MAX_W * s);
    const minX = score.x + score.width + gap;
    const maxX = galaxy.y === top ? galaxy.x - gap : rightPillEdge(cssWidth, top, EDGE * s, bounds, gap);
    if (maxX - minX >= BOSS_MIN_W * s) {
      const width = Math.min(want, maxX - minX);
      Object.assign(boss, { x: clamp((cssWidth - width) / 2, minX, maxX - width), y: top, width, height: PILL_H * s });
    } else {
      const y = Math.max(bottom(lives), bottom(galaxy), shown.timer ? bottom(timer) : 0) + LIVES_GAP * s;
      Object.assign(boss, { x: left, y, width: Math.min(want, rightPillEdge(cssWidth, y, EDGE * s, bounds, gap) - left), height: PILL_H * s });
    }
    const trackX = boss.x + PILL_PAD * s + bossName.width + BOSS_NAME_GAP * s;
    Object.assign(hpTrack, { x: trackX, y: boss.y + (boss.height - BOSS_TRACK_H * s) / 2, width: boss.x + boss.width - PILL_PAD * s - trackX, height: BOSS_TRACK_H * s });
  }

  function layout(ctx: CanvasRenderingContext2D): void {
    const s = scale;
    const edge = EDGE * s;
    const left = Math.max(edge, bounds.insets.left);
    const top = Math.max(edge, bounds.insets.top);
    Object.assign(score, { x: left, y: top, width: Math.max(MIN_SCORE_W * s, (SCORE_VALUE_X + PILL_PAD) * s + scoreText.width), height: PILL_H * s });
    Object.assign(lives, { x: left, y: bottom(score) + LIVES_GAP * s, width: (2 * LIFE_FIRST_X + LIFE_SPACING * (shownLives - 1)) * s, height: LIVES_H * s });
    layoutLevel(left, top);
    Object.assign(combo, { x: shown.lives ? lives.x + lives.width + LIVES_GAP * s : left, y: lives.y, width: comboText.width + 2 * COMBO_PAD * s, height: LIVES_H * s });
    if (shown.boss) layoutBoss(left, top);
    rects = HUD_PILLS.filter((id) => shown[id]).map((id) => boxes[id]);
    timerFill = across(ctx, timer, palette.accent[0], palette.accent[2]);
    comboFill = across(ctx, combo, palette.accent[1], palette.accent[2]);
    hpFill = across(ctx, hpTrack, palette.ring, palette.shot);
    dirty = false;
  }

  function drawLifeIcons(ctx: CanvasRenderingContext2D): void {
    const k = LIFE_ICON_SCALE * scale;
    const cy = lives.y + lives.height / 2;
    ctx.beginPath();
    for (let i = 0; i < shownLives; i++) {
      const cx = lives.x + (LIFE_FIRST_X + i * LIFE_SPACING) * scale;
      // The hull turned to point up: local (x, y) maps to (y, -x). Each icon is its own subpath.
      for (let j = 0; j < SHIP_HULL.length; j++) {
        const { x, y } = SHIP_HULL[j] as (typeof SHIP_HULL)[number];
        if (j === 0) ctx.moveTo(cx + y * k, cy - x * k);
        else ctx.lineTo(cx + y * k, cy - x * k);
      }
      ctx.closePath();
    }
    ctx.fillStyle = LIFE_ICON;
    ctx.fill();
  }

  function drawPills(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = PILL_FILL;
    ctx.strokeStyle = PILL_STROKE;
    ctx.lineWidth = 1;
    for (const id of GLASS_PILLS) if (shown[id]) tracePill(ctx, boxes[id]);
    if (shown.combo) {
      ctx.fillStyle = comboFill;
      ctx.strokeStyle = BRIGHT_STROKE;
      tracePill(ctx, combo);
    }
  }

  function drawTimer(ctx: CanvasRenderingContext2D, world: World): void {
    const { galaxy: def, timeLeft } = world;
    if (!shown.timer || def === null || timeLeft === null) return;
    fillBar(ctx, timer, timer.width, TRACK);
    const filled = timer.width * timerFraction(timeLeft, def.duration);
    if (filled > 0) fillBar(ctx, timer, Math.max(filled, timer.height), timerFill);
  }

  function drawBossHp(ctx: CanvasRenderingContext2D, world: World): void {
    const fight = world.boss;
    if (!shown.boss || fight === null) return;
    fillBar(ctx, hpTrack, hpTrack.width, HP_TRACK);
    const filled = hpTrack.width * clamp(fight.hp / fight.maxHp, 0, 1);
    if (filled > 0) fillBar(ctx, hpTrack, Math.max(filled, hpTrack.height), hpFill);
    ctx.fillStyle = NOTCH;
    const reach = 2 * scale;
    for (const share of PHASE_NOTCHES) {
      ctx.fillRect(hpTrack.x + hpTrack.width * share - (NOTCH_W * scale) / 2, hpTrack.y - reach, NOTCH_W * scale, hpTrack.height + 2 * reach);
    }
  }

  function drawText(ctx: CanvasRenderingContext2D): void {
    const s = scale;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = labelFont;
    ctx.fillStyle = palette.hud;
    ctx.fillText('SCORE', score.x + SCORE_LABEL_X * s, score.y + score.height / 2);
    if (caption.text !== '') ctx.fillText(caption.text, galaxy.x + PILL_PAD * s, galaxy.y + galaxy.height / 2);
    if (shown.boss) ctx.fillText(bossName.text, boss.x + PILL_PAD * s, boss.y + boss.height / 2);
    ctx.font = valueFont;
    ctx.fillStyle = WHITE;
    ctx.fillText(scoreText.text, score.x + SCORE_VALUE_X * s, score.y + score.height / 2 + 0.5 * s);
    const levelX = galaxy.x + PILL_PAD * s + (caption.text === '' ? 0 : caption.width + CAPTION_GAP * s);
    ctx.font = caption.text === '' ? practiceFont : valueFont;
    ctx.fillText(level.text, levelX, galaxy.y + galaxy.height / 2 + (caption.text === '' ? 0 : 0.5 * s));
    if (shown.combo) {
      ctx.font = comboFont;
      ctx.fillText(comboText.text, combo.x + COMBO_PAD * s, combo.y + combo.height / 2);
    }
  }

  /** Three chevrons just inside the edge at `angle`, pointing in, each pulsing in turn unless `still`. */
  function drawShowerWarning(ctx: CanvasRenderingContext2D, angle: number, time: number, still: boolean): void {
    const s = scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { insets } = bounds;
    const margin = CHEVRON_MARGIN * s;
    const anchorX = cssWidth / 2 + cos * (cssWidth / 2 - margin - (cos < 0 ? insets.left : insets.right));
    const anchorY = cssHeight / 2 + sin * (cssHeight / 2 - margin - (sin < 0 ? insets.top : 0));
    // (dx, dy) points in from the edge, (px, py) along it.
    const dx = -cos;
    const dy = -sin;
    const px = sin;
    const py = -cos;
    const depth = (CHEVRON_DEPTH * s) / 2;
    const half = CHEVRON_HALF_W * s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.ring;
    for (let i = 0; i < CHEVRONS; i++) {
      const cx = anchorX + dx * i * CHEVRON_SPACING * s;
      const cy = anchorY + dy * i * CHEVRON_SPACING * s;
      const pulse = still ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * TAU * CHEVRON_PULSE_HZ - i * 1.1));
      ctx.beginPath();
      ctx.moveTo(cx - dx * depth + px * half, cy - dy * depth + py * half);
      ctx.lineTo(cx + dx * depth, cy + dy * depth);
      ctx.lineTo(cx - dx * depth - px * half, cy - dy * depth - py * half);
      // A wide faint stroke under a narrow bright one: a glow without shadowBlur.
      ctx.globalAlpha = pulse * 0.28;
      ctx.lineWidth = 8 * s;
      ctx.stroke();
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 3 * s;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return {
    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      scale = hudScale(height);
      labelFont = `800 ${String(9 * scale)}px ${ROUNDED}`;
      valueFont = `900 ${String(16 * scale)}px ${MONO}`;
      practiceFont = `900 ${String(11 * scale)}px ${ROUNDED}`;
      comboFont = `900 ${String(12 * scale)}px ${ROUNDED}`;
      // Fonts changed, so every cached width is stale.
      shownScore = -1;
      shownGalaxy = undefined;
      shownMultiplier = 1;
      shownBoss = null;
      for (const text of [scoreText, caption, level, comboText, bossName]) text.text = '\u0000';
      dirty = true;
    },
    setBounds(next) {
      bounds = next;
      dirty = true;
    },
    draw(ctx, world, value, still = false) {
      measure(ctx, world, value);
      if (dirty) layout(ctx);
      drawPills(ctx);
      drawTimer(ctx, world);
      drawBossHp(ctx, world);
      if (shown.lives) drawLifeIcons(ctx);
      drawText(ctx);
      const warning = showerWarningAngle(world.shower);
      if (warning !== null) drawShowerWarning(ctx, warning, world.elapsed, still);
    },
    get rects() {
      return rects;
    },
    pill(id) {
      return shown[id] ? boxes[id] : null;
    },
  };
}
