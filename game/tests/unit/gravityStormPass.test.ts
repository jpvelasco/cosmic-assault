import { describe, expect, it } from 'vitest';
import { HAZARD_RULES } from '../../src/content/hazards';
import type { HazardState } from '../../src/sim/hazards/hazard';
import { hazardPassRig, PASS_FIELD as FIELD, passLook as LOOK, type PassCall as Call } from '../helpers/hazardPassRig';

/** A gravity well, one of a storm's unless `storm` is false. */
const well = (id: number, x: number, y: number, stage: HazardState['stage'], remaining = 2, storm = true): HazardState => ({
  id,
  type: 'gravityWell',
  stage,
  x,
  y,
  intensity: 1,
  remaining,
  ...(storm ? { storm: true } : {}),
});

/** The dotted ring a storm draws: the arcs stroked on the storm's dash. */
const dotted = (calls: readonly Call[]): Call[] => calls.filter((c) => c.name === 'arc' && c.dash.length === 2 && c.dash[0] === 1.5);
const links = (calls: readonly Call[]): Call[] => calls.filter((c) => c.name === 'quadraticCurveTo');

describe('a gravity storm\'s art', () => {
  it('links every pair of its wells with an arc, and circles a warning storm with one dotted ring', () => {
    const drawn = hazardPassRig('ionReach');
    const wells = [well(2, 300, 200, 'warning'), well(3, 700, 220, 'warning'), well(4, 500, 520, 'warning')];
    drawn.hazards.drawHazards(wells, FIELD, LOOK(false, 1));
    expect(links(drawn.calls).length).toBe(3);
    const ring = dotted(drawn.calls);
    expect(ring.length).toBe(1);
    // The ring is centred on the storm's wells' middle, so it reads as one shared band, not one ring per well.
    const [cx, cy] = ring[0]?.args ?? [];
    expect(cx).toBeCloseTo((300 + 700 + 500) / 3, 6);
    expect(cy).toBeCloseTo((200 + 220 + 520) / 3, 6);
  });

  it('links and rings only a storm\'s wells, never an ordinary gravity well beside them', () => {
    const drawn = hazardPassRig('ionReach');
    drawn.hazards.drawHazards([well(2, 200, 200, 'warning', 2, false), well(3, 320, 200, 'warning'), well(4, 900, 500, 'warning')], FIELD, LOOK(false, 1));
    expect(links(drawn.calls).length).toBe(1);
    const [cx] = dotted(drawn.calls)[0]?.args ?? [];
    expect(cx).toBeCloseTo((320 + 900) / 2, 6);
    const lone = hazardPassRig('ionReach');
    lone.hazards.drawHazards([well(2, 200, 200, 'warning', 2, false), well(3, 600, 300, 'active', 8, false)], FIELD, LOOK(false, 1));
    expect(links(lone.calls)).toEqual([]);
    expect(dotted(lone.calls)).toEqual([]);
  });

  it('fades a storm\'s wells and links in over the storm\'s own length as they open, not a gravity well\'s', () => {
    const { seconds } = HAZARD_RULES.gravityStorm;
    const drawn = hazardPassRig('ionReach');
    // A tenth of a second after they open: still swirling up.
    drawn.hazards.drawHazards([well(2, 300, 200, 'active', seconds - 0.1), well(3, 700, 220, 'active', seconds - 0.1)], FIELD, LOOK(false, 1));
    const swirl = drawn.stamps.filter((s) => s.key.includes('|arc'));
    expect(swirl.length).toBeGreaterThan(0);
    for (const s of swirl) expect(s.alpha).toBeLessThan(0.5);
    const linkStrokes = drawn.calls.filter((c) => c.name === 'stroke' && c.dash.length === 0);
    expect(linkStrokes.length).toBe(1);
    expect(linkStrokes[0]?.alpha).toBeLessThan(0.5);
  });

  it('closes a storm well\'s warning outline over the storm\'s own telegraph, not a gravity well\'s', () => {
    const outline = (storm: boolean): number => {
      const drawn = hazardPassRig('ionReach');
      drawn.hazards.drawHazards([well(2, 300, 200, 'warning', 1.5, storm)], FIELD, LOOK(false, 1));
      return drawn.stamps.find((s) => s.key.endsWith('|outline'))?.reach ?? Number.NaN;
    };
    // 1.5 s left: half the storm's 3 s telegraph, but three quarters of a gravity well's 2 s, so the storm's has closed further.
    expect(outline(true)).toBeLessThan(outline(false));
  });

  it('draws the storm\'s links while its wells are active, but no ring, which is the warning\'s alone', () => {
    const drawn = hazardPassRig('ionReach');
    drawn.hazards.drawHazards([well(2, 300, 200, 'active', 8), well(3, 700, 220, 'active', 8)], FIELD, LOOK(false, 1));
    expect(links(drawn.calls).length).toBe(1);
    expect(dotted(drawn.calls)).toEqual([]);
  });

  it('holds the ring and the links still under reduced motion, and lets them breathe otherwise', () => {
    const wells = [well(2, 300, 200, 'warning'), well(3, 700, 220, 'warning')];
    const alphaOf = (still: boolean, time: number): number[] => {
      const drawn = hazardPassRig('ionReach');
      drawn.hazards.drawHazards(wells, FIELD, LOOK(still, time));
      return dotted(drawn.calls).map((c) => c.alpha);
    };
    expect(alphaOf(true, 1)).toEqual(alphaOf(true, 1.3));
    expect(alphaOf(false, 1)).not.toEqual(alphaOf(false, 1.3));
  });

  it('holds the warning links still under reduced motion too, and lets them breathe otherwise', () => {
    const wells = [well(2, 300, 200, 'warning'), well(3, 700, 220, 'warning')];
    // A link is an undashed stroke: the dotted ring is the only one drawn with a dash.
    const linkAlpha = (still: boolean, time: number): number[] => {
      const drawn = hazardPassRig('ionReach');
      drawn.hazards.drawHazards(wells, FIELD, LOOK(still, time));
      return drawn.calls.filter((c) => c.name === 'stroke' && c.dash.length === 0).map((c) => c.alpha);
    };
    expect(linkAlpha(true, 1).length).toBe(1);
    expect(linkAlpha(true, 1)).toEqual(linkAlpha(true, 1.3));
    expect(linkAlpha(false, 1)).not.toEqual(linkAlpha(false, 1.3));
  });

  it('draws the storm with no baked sprite of its own, so its art costs no bake', () => {
    const drawn = hazardPassRig('ionReach');
    drawn.hazards.drawHazards([well(2, 300, 200, 'warning'), well(3, 700, 220, 'warning')], FIELD, LOOK(false, 1));
    expect(drawn.keys.every((k) => k.startsWith('well|'))).toBe(true);
  });
});
