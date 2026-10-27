import { BOSSES } from '../content/bosses';
import { clamp } from '../content/curves';
import { galaxyLabel } from '../content/galaxies';
import { TIMED_PICKUPS, type TimedPickupId } from '../content/pickups';
import type { BossId, GalaxyDef } from '../content/types';
import type { World } from '../sim/world';
import { rgba } from './color';
import { BOSS_MIN_W, bossBarWidth, bossNameX, drawBossHp, placeHpTrack } from './hudBoss';
import { drawShowerWarning, drawTimer, showerWarningAngle, timerFraction, type ChevronView } from './hudGalaxy';
import { drawPickupPill, placePickupPill } from './hudPickups';
import { across, bottom, box, BRIGHT_STROKE, PILL_PAD, tracePill, WHITE, type HudRect } from './hudShapes';
import type { Palette } from './palette';
import { SHIP_HULL } from './sprites';

export type { HudRect } from './hudShapes';

/** Safe-area insets in CSS px. Only the boss bar sits at the bottom, so the bottom inset may be left out as 0. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly left: number;
  readonly bottom?: number;
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

/**
 * The HUD's pills, in draw order: the score, the lives, the galaxy (the practice level outside a galaxy), the timer bar
 * under it, the combo multiplier, a badge per timed pickup running (the Shield too), and the boss's HP bar.
 */
export type HudPill = 'score' | 'lives' | 'galaxy' | 'timer' | 'combo' | TimedPickupId | 'boss';
export const HUD_PILLS: readonly HudPill[] = ['score', 'lives', 'galaxy', 'timer', 'combo', ...TIMED_PICKUPS, 'boss'];
/** The pills drawn as plain glass; the combo wears the accent and the timer is a bar. */
const GLASS_PILLS: readonly HudPill[] = ['score', 'lives', 'galaxy', 'boss'];

export interface Hud {
  resize(cssWidth: number, cssHeight: number): void;
  setBounds(bounds: HudBounds): void;
  /** Recolours the bars, labels and arrows from the next draw. */
  setPalette(palette: Palette): void;
  /**
   * Draws the pills, showing `score` (in Rank, the run's total) and, while a shower is telegraphed, arrows at its edge.
   * `still` holds the arrows steady and the expiring pickup badges dim rather than blinking, for reduced motion. The
   * caller sets a CSS-px transform (identity × dpr).
   */
  draw(ctx: CanvasRenderingContext2D, world: World, score: number, still?: boolean): void;
  /** The pills drawn last, in CSS px, in draw order. */
  readonly rects: readonly HudRect[];
  /** The named pill as drawn last, or null when it was not shown. */
  pill(id: HudPill): HudRect | null;
}

const ROUNDED = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const PILL_FILL = rgba(WHITE, 0.09);
const PILL_STROKE = rgba(WHITE, 0.18);
const LIFE_ICON = '#5dff4a';
const GALAXY_CAPTION = 'GALAXY';

// Sizes in CSS px at scale 1, from the mockup's 480×300 panel.
const EDGE = 12;
const PILL_H = 28;
const MIN_SCORE_W = 122;
const SCORE_LABEL_X = 12;
const SCORE_VALUE_X = 48;
/** Between a caption and its value. */
const CAPTION_GAP = 6;
const LIVES_GAP = 6;
const LIVES_H = 20;
const LIFE_FIRST_X = 14;
const LIFE_SPACING = 16;
const LIFE_ICON_SCALE = 0.5;
/** The timer bar's gap under the galaxy pill, and its height. */
const TIMER_GAP = 4;
const TIMER_H = 4;
/** The combo pill's padding either side of its text. */
const COMBO_PAD = 8;
/** Room between the right pill and the score pill or the corner box it avoids. */
const PILL_GAP = 8;
/** The HUD grows with the viewport height, from 1 at this height up to MAX_SCALE. */
const SCALE_HEIGHT = 480;
const MAX_SCALE = 1.5;

const SCORE_FORMAT = new Intl.NumberFormat();
const NO_BOUNDS: HudBounds = { insets: { top: 0, right: 0, left: 0 }, topRight: null };

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

/** The text a pill shows, and its width, measured only when it changes. */
interface Measured {
  text: string;
  width: number;
}

const measured = (): Measured => ({ text: '', width: 0 });

export function createHud(initial: Palette): Hud {
  let palette = initial;
  const boxes = Object.fromEntries(HUD_PILLS.map((id) => [id, box()])) as Readonly<Record<HudPill, HudRect>>;
  const { score, lives, galaxy, timer, combo, boss } = boxes;
  /** The score and the galaxy show from the start; every other pill once there is something to show. */
  const shown = Object.fromEntries(HUD_PILLS.map((id) => [id, id === 'score' || id === 'galaxy'])) as Record<HudPill, boolean>;
  /** The HP track inside the boss bar. */
  const hpTrack = box();
  let rects: readonly HudRect[] = [];
  const chevronView: { -readonly [K in keyof ChevronView]: ChevronView[K] } = { width: 0, height: 0, insets: NO_BOUNDS.insets, scale: 1 };
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
    for (const kind of TIMED_PICKUPS) show(kind, world.effects[kind] > 0);
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

  /** The pickup badges run along the lives row, after whichever of the lives and combo pills come last. */
  function layoutPickups(left: number): void {
    const gap = LIVES_GAP * scale;
    let x = shown.combo ? combo.x + combo.width + gap : shown.lives ? lives.x + lives.width + gap : left;
    for (const kind of TIMED_PICKUPS) {
      if (!shown[kind]) continue;
      placePickupPill(boxes[kind], x, lives, scale);
      x += boxes[kind].width + gap;
    }
  }

  /**
   * Bottom centre, inside the safe area: every boss fights in the upper part of the field, and a bar at the top sat over
   * the Hive Carrier's hull on its row.
   */
  function layoutBoss(left: number): void {
    const s = scale;
    const edge = EDGE * s;
    const right = cssWidth - Math.max(edge, bounds.insets.right);
    const width = Math.max(BOSS_MIN_W * s, Math.min(bossBarWidth(cssWidth, s), right - left));
    const height = PILL_H * s;
    Object.assign(boss, { x: clamp((cssWidth - width) / 2, left, right - width), y: cssHeight - Math.max(edge, bounds.insets.bottom ?? 0) - height, width, height });
    placeHpTrack(boss, bossName.width, s, hpTrack);
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
    layoutPickups(left);
    if (shown.boss) layoutBoss(left);
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

  function drawPickups(ctx: CanvasRenderingContext2D, world: World, still: boolean): void {
    for (const kind of TIMED_PICKUPS) if (shown[kind]) drawPickupPill(ctx, boxes[kind], kind, world.effects[kind], still, scale);
  }

  function drawBars(ctx: CanvasRenderingContext2D, world: World): void {
    const { galaxy: def, timeLeft, boss: fight } = world;
    if (shown.timer && def !== null && timeLeft !== null) drawTimer(ctx, timer, timerFraction(timeLeft, def.duration), timerFill);
    if (shown.boss && fight !== null) drawBossHp(ctx, hpTrack, fight.hp, fight.maxHp, hpFill, scale);
  }

  function drawText(ctx: CanvasRenderingContext2D): void {
    const s = scale;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = labelFont;
    ctx.fillStyle = palette.hud;
    ctx.fillText('SCORE', score.x + SCORE_LABEL_X * s, score.y + score.height / 2);
    if (caption.text !== '') ctx.fillText(caption.text, galaxy.x + PILL_PAD * s, galaxy.y + galaxy.height / 2);
    if (shown.boss) ctx.fillText(bossName.text, bossNameX(boss, s), boss.y + boss.height / 2);
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

  return {
    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      scale = hudScale(height);
      Object.assign(chevronView, { width, height, scale });
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
    setPalette(next) {
      palette = next;
      // The bar gradients are made on layout.
      dirty = true;
    },
    setBounds(next) {
      bounds = next;
      chevronView.insets = next.insets;
      dirty = true;
    },
    draw(ctx, world, value, still = false) {
      measure(ctx, world, value);
      if (dirty) layout(ctx);
      drawPills(ctx);
      drawBars(ctx, world);
      drawPickups(ctx, world, still);
      if (shown.lives) drawLifeIcons(ctx);
      drawText(ctx);
      const warning = showerWarningAngle(world.shower);
      if (warning !== null) drawShowerWarning(ctx, warning, chevronView, palette.ring, world.elapsed, still);
    },
    get rects() {
      return rects;
    },
    pill(id) {
      return shown[id] ? boxes[id] : null;
    },
  };
}
