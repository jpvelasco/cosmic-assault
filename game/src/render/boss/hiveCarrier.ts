import type { PaletteId } from '../../content/types';
import { HANGAR_HALF_ARC } from '../../sim/boss/hiveCarrier';
import { TAU } from '../../sim/math';
import type { Palette } from '../palette';
import { createTurnedSprite } from '../turnedSprite';
import { RIM_PAD, tintedSprite, type BossFrame, type DrawerFactory } from './drawer';
import { ENGINES, HIVE_ART_REACH, hiveArtBoxes, paintHiveBay, paintHiveDoor, paintHiveHull } from './hiveCarrierArt';

/** Seconds the doors take to slide fully open or shut. */
export const DOOR_SECONDS = 0.3;
/** The open bay's light pulses at this rate unless held still, and throws a glow this wide, in hull radii. */
const BAY_PULSE_HZ = 3;
const BAY_GLOW_SCALE = 1.6;
const BAY_GLOW_ALPHA = 0.7;
/** Where the bay's glow sits, as a share of the radius out along where it faces. */
const BAY_GLOW_AT = 0.8;
const ENGINE_GLOW_SCALE = 0.45;
const ENGINE_GLOW_ALPHA = 0.8;

/** The cache keys of the carrier's sprites, made once per size so drawing builds no strings. */
const keysFor = (radius: number, palette: PaletteId) => {
  const size = String(radius);
  const prefix = `boss|${palette}|hiveCarrier`;
  return {
    hull: `${prefix}|hull|${size}`,
    hullShut: `${prefix}|hullShut|${size}`,
    bay: `${prefix}|bay|${size}`,
    doorUp: `${prefix}|door|1|${size}`,
    doorDown: `${prefix}|door|-1|${size}`,
  } as const;
};

/** The sprites baked on their own bounds rather than the hull's. */
type Part = 'bay' | 'doorUp' | 'doorDown';

type Paint = (c: CanvasRenderingContext2D, r: number, p: Palette) => void;

const paintDoorUp: Paint = (c, r, p) => {
  paintHiveDoor(c, r, p, 1);
};
const paintDoorDown: Paint = (c, r, p) => {
  paintHiveDoor(c, r, p, -1);
};
/** The hull with its doors shut, so a shut hangar is one blit. */
const paintHullShut: Paint = (c, r, p) => {
  paintHiveHull(c, r, p);
  paintDoorUp(c, r, p);
  paintDoorDown(c, r, p);
};

/**
 * The Hive Carrier: a gunmetal carrier hull in the Dimension's trims, turned so its hangar faces where the sim faces it.
 * Its doors slide apart while the hangar is open, baring a glowing bay, and close again after; its engines glow at the
 * stern. A shut hangar is one sprite, the hull with its doors baked in; an open one adds the bay light and the door
 * leaves, each baked on its own bounds. The hull is turned onto a canvas of its own (`TurnedSprite`) and drawn upright,
 * and the parts follow the angle it was turned to. Sprites are looked up by key as they are drawn.
 */
export const hiveCarrierDrawer: DrawerFactory = (kit) => {
  const { ctx, pen, baker, palette } = kit;
  const glowColor = palette.accent[2];
  let radius = 0;
  let keys = keysFor(radius, palette.id);
  let boxes = hiveArtBoxes(radius, RIM_PAD);
  /** A sprite painter for `paint` at the radius in force, made once so drawing builds no closures. */
  const painter = (paint: Paint) => (c: CanvasRenderingContext2D): void => {
    paint(c, radius, palette);
  };
  /** `painter` for a part, its art moved so its box's centre is the sprite's. */
  const partPainter = (part: Part, paint: Paint) => (c: CanvasRenderingContext2D): void => {
    c.translate(-boxes[part].x, -boxes[part].y);
    paint(c, radius, palette);
  };
  const paintHull = painter(paintHiveHull);
  const paintShut = painter(paintHullShut);
  const partPainters: Readonly<Record<Part, (c: CanvasRenderingContext2D) => void>> = {
    bay: partPainter('bay', paintHiveBay),
    doorUp: partPainter('doorUp', paintDoorUp),
    doorDown: partPainter('doorDown', paintDoorDown),
  };
  const hullTurn = createTurnedSprite();
  /** How far open the doors are, 0 shut to 1 wide open. */
  let doors = 0;
  let time = 0;

  /** Places the pen at (u, v) field units out from the hull's centre in its frame turned to `angle`, turned with it and scaled by the frame. */
  function placeTurned({ x, y, size }: Readonly<BossFrame>, angle: number, u = 0, v = 0): void {
    const c = Math.cos(angle) * size;
    const s = Math.sin(angle) * size;
    pen.place(x + c * u - s * v, y + s * u + c * v, c, s);
  }

  /** Places the pen at (u, v) in the hull's own frame, in radii, hangar along +u. */
  function placeOnHull({ x, y, size }: Readonly<BossFrame>, facing: number, r: number, u: number, v: number, scale: number): void {
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    pen.place(x + (c * u - s * v) * r * size, y + (s * u + c * v) * r * size, scale * size, 0);
  }

  /** Blits a part on its own bounds, where it sits on the hull turned to `angle`. */
  function blitPart(frame: Readonly<BossFrame>, angle: number, part: Part): void {
    const { x, y, halfW, halfH } = boxes[part];
    placeTurned(frame, angle, x, y);
    pen.blit(baker.custom(keys[part], halfW, partPainters[part], halfH));
  }

  return {
    glow: palette.accent[1],
    underglow(boss, frame) {
      const r = boss.radius;
      ctx.globalAlpha = ENGINE_GLOW_ALPHA * frame.look.glow * frame.shown;
      for (const e of ENGINES) {
        placeOnHull(frame, boss.facing, r, e.x - 0.08, e.y, 1);
        pen.blit(baker.glow(glowColor, r * ENGINE_GLOW_SCALE));
      }
    },
    body(boss, frame) {
      const { shown, look } = frame;
      const r = boss.radius;
      if (r !== radius) {
        radius = r;
        keys = keysFor(r, palette.id);
        boxes = hiveArtBoxes(r, RIM_PAD);
      }
      const half = r * HIVE_ART_REACH + RIM_PAD;
      const shut = doors === 0;
      const hull = tintedSprite(kit, shut ? keys.hullShut : keys.hull, half, shut ? paintShut : paintHull, frame.tinted);
      placeTurned(frame, 0);
      pen.blit(hullTurn.turn(hull, boss.facing));
      const facing = hullTurn.angle;
      if (shut) return;
      const pulse = look.still ? 1 : 0.85 + 0.15 * Math.sin(time * TAU * BAY_PULSE_HZ);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shown * doors * pulse;
      blitPart(frame, facing, 'bay');
      ctx.globalAlpha = shown * doors * pulse * BAY_GLOW_ALPHA * look.glow;
      placeOnHull(frame, facing, r, BAY_GLOW_AT, 0, 1);
      pen.blit(baker.glow(glowColor, r * BAY_GLOW_SCALE));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = shown;
      const slide = doors * HANGAR_HALF_ARC;
      blitPart(frame, facing + slide, 'doorUp');
      blitPart(frame, facing - slide, 'doorDown');
    },
    /** Slides the doors toward open while the hangar is open in the fight, and shut otherwise. */
    advance(dt, boss) {
      time += dt;
      const want = boss.vulnerable && boss.state === 'fighting' ? 1 : 0;
      const step = dt / DOOR_SECONDS;
      doors = want > doors ? Math.min(want, doors + step) : Math.max(want, doors - step);
    },
    handle(event) {
      if (event.type === 'bossIntro') doors = 0;
    },
    reset() {
      doors = 0;
      time = 0;
      hullTurn.release();
    },
  };
};
