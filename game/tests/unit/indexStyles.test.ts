import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BACKGROUND, DRIFT } from '../../src/render/palette';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function cssVar(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(html)?.[1];
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
    const hexes = html.match(/#[0-9a-f]{6}\b/gi) ?? [];
    expect(hexes.length).toBe(new Set(hexes).size);
  });
});
