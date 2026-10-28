/** Pure white and black, to mix palette colours toward. */
export const WHITE = '#ffffff';
export const BLACK = '#000000';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): readonly [number, number, number] {
  if (!HEX.test(hex)) {
    throw new RangeError(`hexToRgb() needs #rrggbb (got ${hex}); pass a 6-digit hex colour`);
  }
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Blends `a` towards `b` by `t` (clamped to 0..1) and returns `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  const channel = (from: number, to: number): string =>
    Math.round(from + (to - from) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

/** A canvas `rgba(r,g,b,alpha)` colour string from `#rrggbb` and an alpha in 0..1. */
export function rgba(hex: string, alpha: number): string {
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new RangeError(`rgba() needs an alpha from 0 to 1 (got ${String(alpha)}); pass a number from 0 to 1`);
  }
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${String(r)},${String(g)},${String(b)},${String(alpha)})`;
}
