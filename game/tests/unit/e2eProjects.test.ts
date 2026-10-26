import { readdirSync } from 'node:fs';
import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';
import { projectMatchers, projectsWithTestIgnore, unmatchedSpecs } from '../helpers/specCoverage';

const entries = readdirSync(new URL('../../e2e/', import.meta.url), { withFileTypes: true });
const specs = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts')).map((entry) => entry.name);

describe('unmatchedSpecs', () => {
  it('names a spec that no pattern matches', () => {
    expect(unmatchedSpecs(['a.spec.ts', 'b.spec.ts'], ['**/a.spec.ts'])).toEqual(['b.spec.ts']);
  });

  it('accepts glob and regular-expression patterns', () => {
    expect(unmatchedSpecs(['a.spec.ts', 'b.spec.ts', 'c.spec.ts'], ['**/a.spec.ts', /^b\./, '*.spec.ts'])).toEqual([]);
    expect(unmatchedSpecs(['a.spec.ts'], [])).toEqual(['a.spec.ts']);
  });

  it('does not treat a longer name as a match', () => {
    expect(unmatchedSpecs(['full.spec.ts', 'fullscreen.spec.ts'], ['**/fullscreen.spec.ts'])).toEqual(['full.spec.ts']);
  });
});

describe('projectsWithTestIgnore', () => {
  it('names the projects that set testIgnore', () => {
    const config: PlaywrightTestConfig = { testIgnore: 'z', projects: [{ name: 'a' }, { name: 'b', testIgnore: '**/x.spec.ts' }, { testIgnore: [] }] };
    expect(projectsWithTestIgnore(config)).toEqual(['(config)', 'b', '(unnamed)']);
  });
});

describe('playwright.config.ts', () => {
  it('finds the e2e specs and the projects that run them', () => {
    expect(specs.length).toBeGreaterThan(0);
    expect(projectMatchers(config).length).toBeGreaterThan(0);
  });

  it('gives every e2e spec at least one project, so none is silently skipped', () => {
    expect(unmatchedSpecs(specs, projectMatchers(config))).toEqual([]);
  });

  it('has no project that ignores specs, so testMatch tells the whole story', () => {
    expect(projectsWithTestIgnore(config)).toEqual([]);
  });

  it('keeps specs directly in e2e/, where the coverage check can see them', () => {
    expect(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([]);
  });
});
