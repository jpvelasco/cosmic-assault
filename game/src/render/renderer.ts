import { PROJECTILE } from '../sim/config';
import type { Field } from '../sim/field';
import type { World } from '../sim/world';
import { get2dContext } from './context';
import { bakeStarfield } from './starfield';

export interface Renderer {
  resize(cssWidth: number, cssHeight: number, field: Field): void;
  /**
   * Draws the latest world state. `alpha` is the fixed-step interpolation
   * fraction; M1 ignores it (interpolation is future work).
   */
  draw(world: World, alpha: number): void;
}

const MAX_DPR = 2;
const BACKGROUND = '#05060f';
const ASTEROID_FILL = '#5468a8';
const ASTEROID_STROKE = '#a9bdf0';
const ASTEROID_STROKE_WIDTH = 1.5;
const PROJECTILE_FILL = '#ff4fd8';
const SHIP_FILL = '#39ff14';
const FLAME_FILL = '#ffb02e';
const HUD_COLOR = '#e8ecff';
const HUD_FONT_FAMILY = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Minimums in field units; on small screens they grow so the HUD stays at least this many CSS px. */
const HUD_MIN_FONT = 20;
const HUD_MIN_FONT_CSS_PX = 14;
const HUD_MIN_MARGIN = 16;
const HUD_MIN_MARGIN_CSS_PX = 12;
const HUD_LINE_HEIGHT = 1.3;
const BLINK_HZ = 10;
const TWO_PI = Math.PI * 2;

interface Point {
  readonly x: number;
  readonly y: number;
}

const SHIP_HULL: readonly Point[] = [
  { x: 14, y: 0 },
  { x: -10, y: -9 },
  { x: -6, y: 0 },
  { x: -10, y: 9 },
];
const SHIP_FLAME: readonly Point[] = [
  { x: -7, y: -4 },
  { x: -17, y: 0 },
  { x: -7, y: 4 },
];

interface Layout {
  readonly field: Field;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly dpr: number;
  readonly hudFont: string;
  readonly hudMargin: number;
  readonly hudLine: number;
  readonly stars: HTMLCanvasElement;
}

/** Adds a closed polygon, rotated by `angle` and moved to (x, y), to the current path. */
function tracePolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  x: number,
  y: number,
  angle: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point;
    const sx = x + p.x * cos - p.y * sin;
    const sy = y + p.x * sin + p.y * cos;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = get2dContext(canvas);
  let labelLevel = 0;
  let practiceLabel = '';
  let layout: Layout | null = null;

  function resize(cssWidth: number, cssHeight: number, field: Field): void {
    if (!(cssWidth > 0 && cssHeight > 0 && Number.isFinite(cssWidth) && Number.isFinite(cssHeight))) {
      throw new RangeError(
        `Renderer.resize() needs positive finite sizes (got ${String(cssWidth)}×${String(cssHeight)}); wait for layout first`,
      );
    }
    const deviceRatio = globalThis.devicePixelRatio;
    const dpr = Math.min(Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1, MAX_DPR);
    canvas.style.width = `${String(cssWidth)}px`;
    canvas.style.height = `${String(cssHeight)}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const scale = Math.min(cssWidth / field.width, cssHeight / field.height);
    const hudFontSize = Math.max(HUD_MIN_FONT, HUD_MIN_FONT_CSS_PX / scale);
    layout = {
      field,
      scale,
      offsetX: (cssWidth - field.width * scale) / 2,
      offsetY: (cssHeight - field.height * scale) / 2,
      dpr,
      hudFont: `600 ${String(hudFontSize)}px ${HUD_FONT_FAMILY}`,
      hudMargin: Math.max(HUD_MIN_MARGIN, HUD_MIN_MARGIN_CSS_PX / scale),
      hudLine: hudFontSize * HUD_LINE_HEIGHT,
      stars: bakeStarfield(field, scale * dpr),
    };
  }

  function drawAsteroids(world: World): void {
    ctx.fillStyle = ASTEROID_FILL;
    ctx.strokeStyle = ASTEROID_STROKE;
    ctx.lineWidth = ASTEROID_STROKE_WIDTH;
    ctx.lineJoin = 'round';
    for (const a of world.asteroids) {
      ctx.beginPath();
      tracePolygon(ctx, a.vertices, a.x, a.y, a.rotation);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawProjectiles(world: World): void {
    ctx.fillStyle = PROJECTILE_FILL;
    ctx.beginPath();
    for (const p of world.projectiles) {
      ctx.moveTo(p.x + PROJECTILE.radius, p.y);
      ctx.arc(p.x, p.y, PROJECTILE.radius, 0, TWO_PI);
    }
    ctx.fill();
  }

  function drawShip(world: World): void {
    const { ship, elapsed } = world;
    if (ship.invulnerable && Math.floor(elapsed * BLINK_HZ * 2) % 2 === 1) {
      return;
    }
    if (ship.thrusting) {
      ctx.fillStyle = FLAME_FILL;
      ctx.beginPath();
      tracePolygon(ctx, SHIP_FLAME, ship.x, ship.y, ship.angle);
      ctx.fill();
    }
    ctx.fillStyle = SHIP_FILL;
    ctx.beginPath();
    tracePolygon(ctx, SHIP_HULL, ship.x, ship.y, ship.angle);
    ctx.fill();
  }

  function drawHud(world: World, { field, hudFont, hudMargin, hudLine }: Layout): void {
    if (world.practiceLevel !== labelLevel) {
      labelLevel = world.practiceLevel;
      practiceLabel = `Practice L${String(labelLevel)}`;
    }
    ctx.fillStyle = HUD_COLOR;
    ctx.font = hudFont;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(`Score ${String(world.score)}`, hudMargin, hudMargin);
    ctx.fillText(`Lives ${String(world.lives)}`, hudMargin, hudMargin + hudLine);
    ctx.textAlign = 'right';
    ctx.fillText(practiceLabel, field.width - hudMargin, hudMargin);
    if (world.status === 'gameOver') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Game over', field.width / 2, field.height / 2);
    }
  }

  /** Takes no `alpha`: M1 renders the latest state, so interpolation is future work. */
  function draw(world: World): void {
    if (layout === null) {
      throw new Error('Renderer.draw() called before resize(); call resize() once the canvas has a size');
    }
    const { field, scale, offsetX, offsetY, dpr, stars } = layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const k = scale * dpr;
    ctx.setTransform(k, 0, 0, k, offsetX * dpr, offsetY * dpr);
    ctx.drawImage(stars, 0, 0, field.width, field.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, field.width, field.height);
    ctx.clip();
    drawAsteroids(world);
    drawProjectiles(world);
    drawShip(world);
    drawHud(world, layout);
    ctx.restore();
  }

  return { resize, draw };
}
