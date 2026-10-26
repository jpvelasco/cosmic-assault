import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';
import { projectMatchers, unmatchedSpecs } from '../helpers/specCoverage';

const specs = readdirSync(new URL('../../e2e/', import.meta.url)).filter((name) => name.endsWith('.spec.ts'));

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

describe('playwright.config.ts', () => {
  it('finds the e2e specs and the projects that run them', () => {
    expect(specs.length).toBeGreaterThan(0);
    expect(projectMatchers(config).length).toBeGreaterThan(0);
  });

  it('gives every e2e spec at least one project, so none is silently skipped', () => {
    expect(unmatchedSpecs(specs, projectMatchers(config))).toEqual([]);
  });
});
