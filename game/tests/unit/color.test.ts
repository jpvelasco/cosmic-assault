import { describe, expect, it } from 'vitest';
import { hexToRgb, mix, rgba } from '../../src/render/color';
import { DRIFT } from '../../src/render/palette';

describe('hexToRgb', () => {
  it('parses a 6-digit hex colour, upper or lower case', () => {
    expect(hexToRgb('#39ff14')).toEqual([57, 255, 20]);
    expect(hexToRgb('#A855F7')).toEqual([168, 85, 247]);
  });

  it.each(['39ff14', '#fff', '#39ff1', '#39ff14aa', '#gggggg', ''])('rejects %j with advice', (bad) => {
    expect(() => hexToRgb(bad)).toThrow(RangeError);
    expect(() => hexToRgb(bad)).toThrow(`hexToRgb() needs #rrggbb (got ${bad}); pass a 6-digit hex colour`);
  });
});

describe('mix', () => {
  it('returns each endpoint at t = 0 and t = 1', () => {
    expect(mix('#102030', '#f0e0d0', 0)).toBe('#102030');
    expect(mix('#102030', '#f0e0d0', 1)).toBe('#f0e0d0');
  });

  it('blends the midpoint per channel, rounded', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  it('clamps t into [0, 1]', () => {
    expect(mix('#000000', '#ffffff', -3)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 3)).toBe('#ffffff');
  });

  it('propagates bad input errors', () => {
    expect(() => mix('red', '#ffffff', 0.5)).toThrow(RangeError);
  });
});

describe('rgba', () => {
  it('formats a canvas colour string', () => {
    expect(rgba('#ff4fd8', 0.3)).toBe('rgba(255,79,216,0.3)');
    expect(rgba('#000000', 0)).toBe('rgba(0,0,0,0)');
  });

  it('rejects an alpha outside [0, 1] with advice', () => {
    expect(() => rgba('#000000', 1.5)).toThrow(RangeError);
    expect(() => rgba('#000000', Number.NaN)).toThrow('pass a number from 0 to 1');
  });
});

describe('DRIFT palette', () => {
  it('matches the approved Glossy Arcade values', () => {
    expect(DRIFT.id).toBe('drift');
    expect(DRIFT.skyStops).toEqual(['#1d0b44', '#0c1a4a', '#05303d']);
    expect(DRIFT.rock).toEqual(['#a9bdf0', '#5468a8', '#1d2448']);
    expect(DRIFT.rockRim).toBe('rgba(255,255,255,0.28)');
    expect(DRIFT.ship).toEqual(['#0d6b18', '#39ff14', '#d9ffd0']);
    expect(DRIFT.cockpit).toBe('#9ff4ff');
    expect(DRIFT.shot).toBe('#ff4fd8');
    expect(DRIFT.shotCore).toBe('#ffffff');
    expect(DRIFT.accent).toEqual(['#22d3ff', '#a855f7', '#ff4fd8']);
    expect(DRIFT.nebula.map((n) => [n.color, n.alpha])).toEqual([
      ['#ff4f9a', 0.3],
      ['#ff9a3c', 0.2],
      ['#18d6c4', 0.28],
      ['#7b5cff', 0.22],
    ]);
  });

  it('uses only valid hex colours for hex fields and sane nebula fractions', () => {
    const hexes = [...DRIFT.skyStops, ...DRIFT.rock, ...DRIFT.ship, ...DRIFT.accent, ...DRIFT.nebula.map((n) => n.color),
      DRIFT.rockGlow, DRIFT.cockpit, DRIFT.shot, DRIFT.shotCore, DRIFT.spark, DRIFT.ring, DRIFT.hud];
    for (const hex of hexes) expect(() => hexToRgb(hex)).not.toThrow();
    for (const n of DRIFT.nebula) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(1);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(1);
      expect(n.r).toBeGreaterThan(0);
    }
  });
});
