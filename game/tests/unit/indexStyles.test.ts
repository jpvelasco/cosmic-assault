import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BACKGROUND, DRIFT } from '../../src/render/palette';

/** index.html's stylesheet alone: its theme-color meta tag needs a literal colour, which tests/unit/icons.test.ts checks. */
const styles = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'))?.[1] ?? '';

function cssVar(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(styles)?.[1];
}

describe('index.html palette properties', () => {
  it.each([
    ['space', BACKGROUND],
    ['sky-1', DRIFT.skyStops[0]],
    ['sky-2', DRIFT.skyStops[1]],
    ['sky-3', DRIFT.skyStops[2]],
    ['accent-1', DRIFT.accent[0]],
    ['accent-2', DRIFT.accent[1]],
    ['accent-3', DRIFT.accent[2]],
    ['nebula-pink', DRIFT.nebula[0]?.color],
    ['nebula-orange', DRIFT.nebula[1]?.color],
    ['nebula-teal', DRIFT.nebula[2]?.color],
    ['nebula-violet', DRIFT.nebula[3]?.color],
  ])('--%s matches the Drift palette', (name, color) => {
    expect(cssVar(name)).toBe(color);
  });

  it('writes each hex colour once, so the rules use the properties', () => {
    const hexes = styles.match(/#[0-9a-f]{6}\b/gi) ?? [];
    expect(hexes.length).toBe(new Set(hexes).size);
  });
});

describe('index.html stacking layers', () => {
  const layers = new Map([...styles.matchAll(/--layer-([a-z]+):\s*(\d+);/g)].map(([, name, z]) => [name, Number(z)]));

  it('stacks the cards, touch layer, rotate prompt, crash card and toast in that order', () => {
    const order = ['card', 'touch', 'rotate', 'crash', 'toast'].map((name) => layers.get(name));
    expect(order.every((z) => z !== undefined)).toBe(true);
    expect(order).toEqual([...order].sort((a = 0, b = 0) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it('takes every z-index from the scale, so no layer can slip between them', () => {
    const zIndexes = [...styles.matchAll(/z-index:\s*([^;]+);/g)].map(([, value]) => value);
    expect(zIndexes.length).toBeGreaterThan(0);
    for (const value of zIndexes) expect(value).toMatch(/^var\(--layer-[a-z]+\)$/);
  });
});
