import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import config, { livePagesUrl } from '../../playwright.config';
import { listedTests, listTests, projectMatchers, projectsWithTestIgnore, scriptProjects, specsWithTests, testsNoProjectRuns, unmatchedSpecs } from '../helpers/specCoverage';

const entries = readdirSync(new URL('../../e2e/', import.meta.url), { withFileTypes: true, recursive: true });
const isSpec = (entry: (typeof entries)[number]): boolean => entry.isFile() && entry.name.endsWith('.spec.ts');
const e2eDir = resolve(fileURLToPath(new URL('../../e2e/', import.meta.url)));
const isTopLevel = (entry: (typeof entries)[number]): boolean => resolve(entry.parentPath) === e2eDir;
const specs = entries.filter((entry) => isSpec(entry) && isTopLevel(entry)).map((entry) => entry.name);

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

describe('listedTests', () => {
  it('reads each test of each project with its describe titles and tags, as grep sees them', () => {
    const report = {
      suites: [
        {
          file: 'a.spec.ts',
          title: 'a.spec.ts',
          specs: [{ title: 'top', tags: ['phone'], tests: [{ projectName: 'p' }] }],
          suites: [{ file: 'a.spec.ts', title: 'group', specs: [{ title: 'inner', tests: [{ projectName: 'q' }] }] }],
        },
      ],
    };
    expect(listedTests(report)).toEqual([
      { file: 'a.spec.ts', title: 'a.spec.ts top @phone', project: 'p' },
      { file: 'a.spec.ts', title: 'a.spec.ts group inner', project: 'q' },
    ]);
  });
});

describe('testsNoProjectRuns', () => {
  const tests = [
    { file: 'a.spec.ts', title: 'a.spec.ts plain', project: 'desk' },
    { file: 'a.spec.ts', title: 'a.spec.ts only on a phone @phone', project: 'desk' },
    { file: 'a.spec.ts', title: 'a.spec.ts only on a phone @phone', project: 'phone' },
    { file: 'b.spec.ts', title: 'b.spec.ts a release check @release', project: 'smoke' },
    { file: 'b.spec.ts', title: 'b.spec.ts a desktop check @desktop', project: 'smoke' },
  ];
  const projects = [
    { name: 'desk', grepInvert: /@phone/ },
    { name: 'phone', grepInvert: /@desktop/ },
    { name: 'smoke', grep: /@release/ },
  ];

  it('is empty when every test is selected by some project', () => {
    expect(testsNoProjectRuns(tests.slice(0, 4), { projects }, ['desk', 'phone', 'smoke'])).toEqual([]);
  });

  it('names a tagged test whose file is matched only by projects that grep other tags', () => {
    expect(testsNoProjectRuns(tests, { projects }, ['desk', 'phone', 'smoke'])).toEqual(['b.spec.ts › a desktop check @desktop']);
  });

  it('ignores projects the scripts do not run', () => {
    expect(testsNoProjectRuns(tests.slice(0, 3), { projects }, ['desk'])).toEqual(['a.spec.ts › only on a phone @phone']);
  });

  it('lets a project pick a whole file by its name, as grep sees the file first', () => {
    const listed = listedTests({ suites: [{ file: 'c.spec.ts', specs: [{ title: 'x', tests: [{ projectName: 'p' }] }] }] });
    expect(testsNoProjectRuns(listed, { projects: [{ name: 'p', grep: [/@b/, /(^| )c\.spec\.ts( |$)/] }] }, ['p'])).toEqual([]);
    expect(testsNoProjectRuns(listed, { projects: [{ name: 'p', grep: /(^| )d\.spec\.ts( |$)/ }] }, ['p'])).toEqual(['c.spec.ts › x']);
  });

  it('accepts a list of patterns, any of which selects or drops a test', () => {
    const listed = [{ file: 'c.spec.ts', title: 'c.spec.ts x @a', project: 'p' }];
    expect(testsNoProjectRuns(listed, { projects: [{ name: 'p', grep: [/@b/, /@a/] }] }, ['p'])).toEqual([]);
    expect(testsNoProjectRuns(listed, { projects: [{ name: 'p', grepInvert: [/@b/, /@a/] }] }, ['p'])).toEqual(['c.spec.ts › x @a']);
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

describe('livePagesUrl', () => {
  it('takes the address of a live site\'s directory, over http or https', () => {
    expect(livePagesUrl(undefined)).toBeUndefined();
    expect(livePagesUrl('https://example.github.io/cosmic-assault/')).toBe('https://example.github.io/cosmic-assault/');
    expect(livePagesUrl('http://localhost:4319/')).toBe('http://localhost:4319/');
  });

  it('refuses anything else, saying what to set instead', () => {
    for (const value of ['', 'example.github.io/cosmic-assault/', 'https://example.github.io/cosmic-assault', 'file:///tmp/site/', 'https://example.github.io/cosmic-assault/?x=1', 'https://example.github.io/cosmic-assault/#top']) {
      expect(() => livePagesUrl(value), value).toThrow(/PAGES_URL .*ending in a slash.*or unset it/);
    }
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

  it('runs every test, so no tag is left to projects that grep other tags', { timeout: 30000 }, () => {
    const { scripts } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
    const projects = [...scriptProjects(scripts['test:e2e'] ?? ''), ...scriptProjects(scripts['test:perf'] ?? '')];
    const everyTest = listedTests(listTests(projects, fileURLToPath(new URL('../../', import.meta.url)), 'playwright.ungrepped.config.ts'));
    expect(everyTest.length).toBeGreaterThan(0);
    expect(testsNoProjectRuns(everyTest, config, projects)).toEqual([]);
  });

  it('has no project that ignores specs, so testMatch tells the whole story', () => {
    expect(projectsWithTestIgnore(config)).toEqual([]);
  });

  it('keeps specs directly in e2e/, where the coverage check can see them', () => {
    expect(entries.filter((entry) => isSpec(entry) && !isTopLevel(entry)).map((entry) => join(entry.parentPath, entry.name))).toEqual([]);
  });
});
