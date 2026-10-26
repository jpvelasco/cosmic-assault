import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';
import { listTests, projectMatchers, projectsWithTestIgnore, scriptProjects, specsWithTests, unmatchedSpecs } from '../helpers/specCoverage';

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

describe('specsWithTests', () => {
  it('keeps the files with a test left in any suite, nested or not', () => {
    const report = {
      suites: [
        { file: 'a.spec.ts', specs: [{ tests: [{}] }] },
        { file: 'b.spec.ts', specs: [{ tests: [] }] },
        { file: 'c.spec.ts', suites: [{ file: 'c.spec.ts', specs: [{ tests: [{}] }] }] },
        { file: 'd.spec.ts' },
      ],
    };
    expect(specsWithTests(report)).toEqual(['a.spec.ts', 'c.spec.ts']);
  });
});

describe('scriptProjects', () => {
  it('reads the projects an npm script names', () => {
    expect(scriptProjects('playwright test --project=a --project=b-c')).toEqual(['a', 'b-c']);
    expect(scriptProjects('vitest run')).toEqual([]);
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

  it('runs a test of every spec from test:e2e or test:perf, after grep and tags have filtered them', { timeout: 30000 }, () => {
    const { scripts } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
    const projects = [...scriptProjects(scripts['test:e2e'] ?? ''), ...scriptProjects(scripts['test:perf'] ?? '')];
    expect(projects.length).toBeGreaterThan(0);
    const listed = new Set(specsWithTests(listTests(projects, fileURLToPath(new URL('../../', import.meta.url)))));
    expect(specs.filter((spec) => !listed.has(spec))).toEqual([]);
  });

  it('has no project that ignores specs, so testMatch tells the whole story', () => {
    expect(projectsWithTestIgnore(config)).toEqual([]);
  });

  it('keeps specs directly in e2e/, where the coverage check can see them', () => {
    expect(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([]);
  });
});
