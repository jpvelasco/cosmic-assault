import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { DANGER_ZONE } from '../../src/content/hazards';
import { noEffects, TIMED_PICKUPS } from '../../src/content/pickups';
import { touchControlBoxes, type CssBox } from '../../src/input/touchControls';
import { createHud } from '../../src/render/hud';
import { layoutFor } from '../../src/render/layout';
import { DRIFT } from '../../src/render/palette';
import { fieldForViewport, type Field } from '../../src/sim/field';
import { zoneKeepOutBoxes, type ZoneBox } from '../../src/sim/hazards/dangerZone';
import type { World } from '../../src/sim/world';

/** A Canvas 2D stand-in whose text is 10 px a character wide. */
const ctx = new Proxy(
  {},
  {
    get: (_target, name) => {
      if (name === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (name === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      return () => undefined;
    },
    set: () => true,
  },
) as CanvasRenderingContext2D;

/** The fullest HUD the game draws: five lives, a combo going and every timed pickup running, in a galaxy. */
function fullHudWorld(): World {
  const effects = noEffects();
  for (const kind of TIMED_PICKUPS) effects[kind] = 9;
  return { score: 0, lives: 5, practiceLevel: 1, elapsed: 10, galaxy: galaxyById('5-5'), timeLeft: 45, multiplier: 5, boss: null, shower: null, effects } as unknown as World;
}

/** `box`, in CSS px of a `cssWidth` by `cssHeight` viewport, as the part of it over the field, in field units; null if none is. */
function onField(box: CssBox, cssWidth: number, cssHeight: number, field: Field): ZoneBox | null {
  const { scale, fieldX, fieldY } = layoutFor(cssWidth, cssHeight, field, 1);
  const x0 = Math.max(0, (box.x - fieldX) / scale);
  const x1 = Math.min(field.width, (box.x + box.width - fieldX) / scale);
  const y0 = Math.max(0, (box.y - fieldY) / scale);
  const y1 = Math.min(field.height, (box.y + box.height - fieldY) / scale);
  return x1 <= x0 || y1 <= y0 ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

const within = (inner: ZoneBox, outer: ZoneBox): boolean =>
  inner.x - inner.w / 2 >= outer.x - outer.w / 2 && inner.x + inner.w / 2 <= outer.x + outer.w / 2 && inner.y - inner.h / 2 >= outer.y - outer.h / 2 && inner.y + inner.h / 2 <= outer.y + outer.h / 2;

describe('danger zone keep-outs', () => {
  it('cover the four corners of every field the game plays at, the same in field units on every device', () => {
    expect(DANGER_ZONE.keepOuts.map((k) => k.corner).sort()).toEqual(['bottomLeft', 'bottomRight', 'topLeft', 'topRight']);
    for (const field of [{ width: 960, height: 720 }, { width: 1680, height: 720 }]) {
      for (const box of zoneKeepOutBoxes(field)) {
        expect(box.x - box.w / 2 === 0 || box.x + box.w / 2 === field.width).toBe(true);
        expect(box.y - box.h / 2 === 0 || box.y + box.h / 2 === field.height).toBe(true);
      }
    }
  });

  // A desktop, a 4:3 tablet window and phones in landscape up to 21:9, the touch ones in either hand.
  describe.each([
    { name: 'a 1280x720 desktop', width: 1280, height: 720, touch: false },
    { name: 'a 1024x768 window', width: 1024, height: 768, touch: false },
    { name: 'Pixel 5 landscape', width: 802, height: 293, touch: true },
    { name: 'a 844x390 phone', width: 844, height: 390, touch: true },
  ])('on $name', ({ width, height, touch }) => {
    const field = fieldForViewport(width, height);
    const keepOuts = zoneKeepOutBoxes(field);
    const covered = (box: CssBox, what: string): void => {
      const part = onField(box, width, height, field);
      if (part !== null) expect(keepOuts.some((k) => within(part, k)), `${what} ${JSON.stringify(part)}`).toBe(true);
    };

    it.each(touch ? [false, true] : [false])('keeps every HUD pill, at its fullest, and every touch control inside a keep-out (left-handed: %s)', (leftHanded) => {
      const controls = touchControlBoxes(width, height, leftHanded);
      const hud = createHud(DRIFT);
      hud.resize(width, height);
      hud.setBounds({ insets: { top: 0, right: 0, left: 0 }, topRight: touch ? { width: width - controls.pause.x, height: controls.pause.y + controls.pause.height } : null });
      hud.draw(ctx, fullHudWorld(), 9_876_543);
      expect(hud.rects.length).toBeGreaterThan(10);
      for (const rect of hud.rects) covered(rect, 'pill');
      if (touch) for (const [name, box] of Object.entries(controls)) covered(box, name);
    });
  });
});
