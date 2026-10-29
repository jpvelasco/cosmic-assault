import { describe, expect, it } from 'vitest';
import type { HazardState } from '../../src/sim/hazards/hazard';
import { hazardPassRig, PASS_FIELD as FIELD, passLook as LOOK } from '../helpers/hazardPassRig';

const hole = (stage: HazardState['stage'], remaining = 40): HazardState => ({ id: 7, type: 'blackHole', stage, x: 640, y: 360, intensity: 2, remaining });

describe('the black hole\'s art', () => {
  it('turns its accretion ring as the game runs, and holds it still under reduced motion', () => {
    const turning = hazardPassRig('singularity');
    turning.hazards.drawHazards([hole('active')], FIELD, LOOK(false, 1.5));
    const ring = turning.stamps.find((s) => s.key.endsWith('|disc'));
    // 0.9 rad/s over 1.5 s of play: 1.35 rad, the turn the ring is stamped at.
    expect(ring?.angle).toBeCloseTo(1.35, 6);

    const still = hazardPassRig('singularity');
    still.hazards.drawHazards([hole('active')], FIELD, LOOK(true, 1.5));
    expect(still.stamps.find((s) => s.key.endsWith('|disc'))?.angle).toBe(0);
  });

  it('bakes its lens and accretion ring under keys of its own, and its warning under another', () => {
    const drawn = hazardPassRig('singularity');
    drawn.hazards.drawHazards([hole('active')], FIELD, LOOK(false, 1));
    expect(drawn.keys.filter((k) => k.startsWith('hole|singularity|')).sort()).toEqual(['hole|singularity|disc', 'hole|singularity|lens']);
    const warned = hazardPassRig('singularity');
    warned.hazards.drawWarnings([hole('warning', 2)], FIELD, LOOK(false, 1));
    expect(warned.keys).toEqual(['hole|singularity|warn']);
  });

  it('draws nothing for its warning in the field, and nothing for the active hole among the warnings', () => {
    const drawn = hazardPassRig('singularity');
    drawn.hazards.drawHazards([hole('warning', 2)], FIELD, LOOK(false, 1));
    expect(drawn.keys).toEqual([]);
    drawn.hazards.drawWarnings([hole('active')], FIELD, LOOK(false, 1));
    expect(drawn.keys).toEqual([]);
  });
});
