import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { phaseAt, pressureScale } from '../../src/sim/galaxy/pacing';

const d1 = galaxyById('1-1'); // 90 s: lull 60-70, surge 70-90
const d5 = galaxyById('5-1'); // 150 s: lull 120-130, surge 130-150
const boss = galaxyById('1-6'); // 20 s approach

describe('phaseAt for a survival galaxy', () => {
  it.each([
    [d1, 0, 'opening'],
    [d1, 14.99, 'opening'],
    [d1, 15, 'build'],
    [d1, 59.99, 'build'],
    [d1, 60, 'lull'],
    [d1, 69.99, 'lull'],
    [d1, 70, 'surge'],
    [d1, 89.99, 'surge'],
    [d1, 90, 'warp'],
    [d1, 500, 'warp'],
    [d5, 14.99, 'opening'],
    [d5, 15, 'build'],
    [d5, 119.99, 'build'],
    [d5, 120, 'lull'],
    [d5, 130, 'surge'],
    [d5, 149.99, 'surge'],
    [d5, 150, 'warp'],
  ] as const)('%#: %s at %f s is %s', (galaxy, elapsed, phase) => {
    expect(phaseAt(galaxy, elapsed)).toBe(phase);
  });
});

describe('phaseAt for a boss galaxy', () => {
  it('stays in the opening for the whole approach, then hands over to the boss', () => {
    expect(phaseAt(boss, 0)).toBe('opening');
    expect(phaseAt(boss, 19.99)).toBe('opening');
    expect(phaseAt(boss, 20)).toBe('boss');
    expect(phaseAt(boss, 300)).toBe('boss');
  });
});

describe('pressureScale', () => {
  it('uses the fixed scale of each phase', () => {
    expect(pressureScale(d1, 5)).toBe(0.5);
    expect(pressureScale(d1, 65)).toBe(0.3);
    expect(pressureScale(d1, 80)).toBe(1.2);
    expect(pressureScale(d1, 90)).toBe(0);
    expect(pressureScale(boss, 10)).toBe(0.5);
    expect(pressureScale(boss, 25)).toBe(0.15);
  });

  it('ramps the build linearly from 0.6 to 1 across its span', () => {
    expect(pressureScale(d1, 15)).toBeCloseTo(0.6, 10);
    expect(pressureScale(d1, 37.5)).toBeCloseTo(0.8, 10);
    expect(pressureScale(d1, 59.999)).toBeCloseTo(1, 4);
    expect(pressureScale(d5, 67.5)).toBeCloseTo(0.8, 10);
  });
});
