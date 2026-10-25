import type { World } from '../sim/world';
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

export interface Hud {
  resize(cssWidth: number, cssHeight: number): void;
  setBounds(bounds: HudBounds): void;
  /** Draws the score, lives and practice pills. The caller sets a CSS-px transform (identity × dpr). */
  draw(ctx: CanvasRenderingContext2D, world: World): void;
  /** The pills drawn last, in CSS px. */
  readonly rects: readonly HudRect[];
}

const ROUNDED = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const PILL_FILL = 'rgba(255,255,255,0.09)';
const PILL_STROKE = 'rgba(255,255,255,0.18)';
const TEXT = '#ffffff';
const LIFE_ICON = '#5dff4a';

// Sizes in CSS px at scale 1, from the mockup's 480×300 panel.
const EDGE = 12;
const PILL_H = 28;
const MIN_SCORE_W = 122;
const SCORE_LABEL_X = 12;
const SCORE_VALUE_X = 48;
const PILL_PAD = 12;
const LIVES_GAP = 6;
const LIVES_H = 20;
const LIFE_FIRST_X = 14;
const LIFE_SPACING = 16;
const LIFE_ICON_SCALE = 0.5;
/** Room between the right pill and the score pill or the corner box it avoids. */
const PILL_GAP = 8;
/** The HUD grows with the viewport height, from 1 at this height up to MAX_SCALE. */
const SCALE_HEIGHT = 480;
const MAX_SCALE = 1.5;

const SCORE_FORMAT = new Intl.NumberFormat();
const NO_BOUNDS: HudBounds = { insets: { top: 0, right: 0, left: 0 }, topRight: null };

const pill = (): HudRect => ({ x: 0, y: 0, width: 0, height: 0 });

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

function tracePill(ctx: CanvasRenderingContext2D, r: HudRect): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, r.height / 2);
  ctx.fill();
  ctx.stroke();
}

export function createHud(palette: Palette): Hud {
  const score = pill();
  const lives = pill();
  const practice = pill();
  let rects: readonly HudRect[] = [];
  let bounds = NO_BOUNDS;
  let cssWidth = 0;
  let scale = 1;
  let labelFont = '';
  let valueFont = '';
  let practiceFont = '';
  let dirty = true;
  // Text and its measured width are cached by value: rebuilt only when the number changes.
  let shownScore = -1;
  let scoreText = '';
  let scoreWidth = 0;
  let shownLives = -1;
  let shownLevel = -1;
  let levelText = '';
  let levelWidth = 0;

  function measure(ctx: CanvasRenderingContext2D, world: World): void {
    if (world.score !== shownScore) {
      shownScore = world.score;
      scoreText = SCORE_FORMAT.format(shownScore);
      ctx.font = valueFont;
      scoreWidth = ctx.measureText(scoreText).width;
      dirty = true;
    }
    if (world.practiceLevel !== shownLevel) {
      shownLevel = world.practiceLevel;
      levelText = `Practice L${String(shownLevel)}`;
      ctx.font = practiceFont;
      levelWidth = ctx.measureText(levelText).width;
      dirty = true;
    }
    if (world.lives !== shownLives) {
      shownLives = world.lives;
      dirty = true;
    }
  }

  function layout(): void {
    const s = scale;
    const edge = EDGE * s;
    const left = Math.max(edge, bounds.insets.left);
    const top = Math.max(edge, bounds.insets.top);
    Object.assign(score, {
      x: left,
      y: top,
      width: Math.max(MIN_SCORE_W * s, (SCORE_VALUE_X + PILL_PAD) * s + scoreWidth),
      height: PILL_H * s,
    });
    Object.assign(lives, {
      x: left,
      y: top + (PILL_H + LIVES_GAP) * s,
      width: (2 * LIFE_FIRST_X + LIFE_SPACING * (shownLives - 1)) * s,
      height: LIVES_H * s,
    });
    const width = levelWidth + 2 * PILL_PAD * s;
    const right = rightPillEdge(cssWidth, top, edge, bounds, PILL_GAP * s);
    // Never over the score pill: when the top row is too narrow, the level drops below the lives pill.
    const x = Math.max(right - width, score.x + score.width + PILL_GAP * s);
    const fits = x + width <= right;
    Object.assign(practice, {
      x: fits ? x : left,
      y: fits ? top : lives.y + lives.height + LIVES_GAP * s,
      width,
      height: PILL_H * s,
    });
    rects = shownLives > 0 ? [score, lives, practice] : [score, practice];
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

  function drawText(ctx: CanvasRenderingContext2D): void {
    const s = scale;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = labelFont;
    ctx.fillStyle = palette.hud;
    ctx.fillText('SCORE', score.x + SCORE_LABEL_X * s, score.y + score.height / 2);
    ctx.font = valueFont;
    ctx.fillStyle = TEXT;
    ctx.fillText(scoreText, score.x + SCORE_VALUE_X * s, score.y + score.height / 2 + 0.5 * s);
    ctx.font = practiceFont;
    ctx.fillText(levelText, practice.x + PILL_PAD * s, practice.y + practice.height / 2);
  }

  return {
    resize(width, height) {
      cssWidth = width;
      scale = hudScale(height);
      labelFont = `800 ${String(9 * scale)}px ${ROUNDED}`;
      valueFont = `900 ${String(16 * scale)}px ${MONO}`;
      practiceFont = `900 ${String(11 * scale)}px ${ROUNDED}`;
      // Fonts changed, so every cached width is stale.
      shownScore = -1;
      shownLevel = -1;
      dirty = true;
    },
    setBounds(next) {
      bounds = next;
      dirty = true;
    },
    draw(ctx, world) {
      measure(ctx, world);
      if (dirty) layout();
      ctx.fillStyle = PILL_FILL;
      ctx.strokeStyle = PILL_STROKE;
      ctx.lineWidth = 1;
      for (const r of rects) tracePill(ctx, r);
      if (shownLives > 0) drawLifeIcons(ctx);
      drawText(ctx);
    },
    get rects() {
      return rects;
    },
  };
}
