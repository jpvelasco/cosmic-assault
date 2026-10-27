import { HANGAR_HALF_ARC } from '../../sim/boss/hiveCarrier';
import { TAU } from '../../sim/math';
import { blitCore, RIM_PAD, type BossFrame, type DrawerFactory } from './drawer';
import { ENGINES, HIVE_ART_REACH, paintHiveBay, paintHiveDoor, paintHiveHull } from './hiveCarrierArt';

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
const keysFor = (radius: number) => {
  const size = String(radius);
  return { hull: `boss|hiveCarrier|hull|${size}`, bay: `boss|hiveCarrier|bay|${size}`, doorUp: `boss|hiveCarrier|door|1|${size}`, doorDown: `boss|hiveCarrier|door|-1|${size}` } as const;
};

/**
 * The Hive Carrier: a gunmetal carrier hull in the Dimension's trims, turned so its hangar faces where the sim faces it.
 * Its doors slide apart while the hangar is open, baring a glowing bay, and close again after; its engines glow at the
 * stern. Sprites are looked up by key as they are drawn.
 */
export const hiveCarrierDrawer: DrawerFactory = (kit) => {
  const { ctx, pen, baker, palette } = kit;
  const glowColor = palette.accent[2];
  let radius = 0;
  let keys = keysFor(radius);
  const paintHull = (c: CanvasRenderingContext2D): void => {
    paintHiveHull(c, radius, palette);
  };
  const paintBay = (c: CanvasRenderingContext2D): void => {
    paintHiveBay(c, radius, palette);
  };
  const paintDoorUp = (c: CanvasRenderingContext2D): void => {
    paintHiveDoor(c, radius, palette, 1);
  };
  const paintDoorDown = (c: CanvasRenderingContext2D): void => {
    paintHiveDoor(c, radius, palette, -1);
  };
  /** How far open the doors are, 0 shut to 1 wide open. */
  let doors = 0;
  let time = 0;

  /** Places the pen at the hull's centre, turned to `angle` and scaled by the frame. */
  function placeTurned({ x, y, size }: Readonly<BossFrame>, angle: number): void {
    pen.place(x, y, Math.cos(angle) * size, Math.sin(angle) * size);
  }

  /** Places the pen at (u, v) in the hull's own frame, in radii, hangar along +u. */
  function placeOnHull({ x, y, size }: Readonly<BossFrame>, facing: number, r: number, u: number, v: number, scale: number): void {
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    pen.place(x + (c * u - s * v) * r * size, y + (s * u + c * v) * r * size, scale * size, 0);
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
        keys = keysFor(r);
      }
      const half = r * HIVE_ART_REACH + RIM_PAD;
      placeTurned(frame, boss.facing);
      blitCore(kit, keys.hull, half, paintHull, frame.tinted);
      if (doors > 0) {
        const pulse = look.still ? 1 : 0.85 + 0.15 * Math.sin(time * TAU * BAY_PULSE_HZ);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = shown * doors * pulse;
        pen.blit(baker.custom(keys.bay, half, paintBay));
        ctx.globalAlpha = shown * doors * pulse * BAY_GLOW_ALPHA * look.glow;
        placeOnHull(frame, boss.facing, r, BAY_GLOW_AT, 0, 1);
        pen.blit(baker.glow(glowColor, r * BAY_GLOW_SCALE));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = shown;
      }
      const slide = doors * HANGAR_HALF_ARC;
      placeTurned(frame, boss.facing + slide);
      pen.blit(baker.custom(keys.doorUp, half, paintDoorUp));
      placeTurned(frame, boss.facing - slide);
      pen.blit(baker.custom(keys.doorDown, half, paintDoorDown));
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
    },
  };
};
