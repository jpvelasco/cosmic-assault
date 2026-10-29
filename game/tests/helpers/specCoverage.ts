import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

export type SpecPattern = string | RegExp;

/** A Playwright `testMatch` glob as a regular expression. Only the forms the config uses: `**` and `*`. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('**/')
    .map((part) => part.split('*').map((text) => text.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('(?:.*/)?');
  return new RegExp(`^${body}$`);
}

/** Every `testMatch` pattern of every project in `config`. */
export function projectMatchers(config: PlaywrightTestConfig): SpecPattern[] {
  return (config.projects ?? []).flatMap((project) => [project.testMatch ?? []].flat());
}

/** The spec file names that none of `patterns` matches: specs that no project would ever run. */
export function unmatchedSpecs(specs: readonly string[], patterns: readonly SpecPattern[]): string[] {
  const matchers = patterns.map((pattern) => (typeof pattern === 'string' ? globToRegExp(pattern) : pattern));
  return specs.filter((spec) => !matchers.some((matcher) => matcher.test(spec)));
}

/** The projects (and `(config)`, for the top level) that set `testIgnore`, which could skip a spec that `testMatch` appears to cover. */
export function projectsWithTestIgnore(config: PlaywrightTestConfig): string[] {
  const projects = (config.projects ?? []).map((project) => ({ name: project.name ?? '(unnamed)', testIgnore: project.testIgnore }));
  return [{ name: '(config)', testIgnore: config.testIgnore }, ...projects].filter((owner) => owner.testIgnore !== undefined).map((owner) => owner.name);
}

/** The part of a `playwright test --list --reporter=json` report the coverage check reads. */
export interface ListedSuite {
  readonly file: string;
  readonly title?: string;
  readonly specs?: readonly {
    readonly title?: string;
    readonly tags?: readonly string[];
    readonly tests: readonly { readonly projectName?: string }[];
  }[];
  readonly suites?: readonly ListedSuite[];
}

function hasTests(suite: ListedSuite): boolean {
  return (suite.specs ?? []).some((spec) => spec.tests.length > 0) || (suite.suites ?? []).some(hasTests);
}

/** The spec files in `report` that keep at least one test once testMatch, grep and tags have had their say. */
export function specsWithTests(report: { readonly suites?: readonly ListedSuite[] }): string[] {
  return (report.suites ?? []).filter(hasTests).map((suite) => suite.file);
}

/**
 * One test as one project lists it; `title` is what `grep` sees: the file, then describe titles, the test title and its
 * tags, joined by spaces. (Playwright's grep also sees the project name first, which is left out so the title is the same in every project.)
 */
export interface ListedTest {
  readonly file: string;
  readonly title: string;
  readonly project: string;
}

function suiteTests(suite: ListedSuite, titles: readonly string[]): ListedTest[] {
  const own = (suite.specs ?? []).flatMap((spec) =>
    spec.tests.map((test) => ({
      file: suite.file,
      title: [...titles, spec.title ?? '', ...(spec.tags ?? []).map((tag) => `@${tag}`)].join(' '),
      project: test.projectName ?? '',
    })),
  );
  return [...own, ...(suite.suites ?? []).flatMap((child) => suiteTests(child, [...titles, child.title ?? '']))];
}

/** Every test in `report`, once per project that lists it. */
export function listedTests(report: { readonly suites?: readonly ListedSuite[] }): ListedTest[] {
  return (report.suites ?? []).flatMap((suite) => suiteTests(suite, [suite.file]));
}

type Patterns = RegExp | readonly RegExp[] | undefined;

/** Playwright's own rule: a list of patterns matches when any one does. A fresh regexp avoids `g` and `y` state. */
function anyMatches(patterns: Patterns, title: string): boolean {
  return [patterns ?? []].flat().some((pattern) => new RegExp(pattern.source, pattern.flags.replaceAll(/[gy]/g, '')).test(title));
}

/**
 * The tests that no project in `runProjects` selects, as `file › title`: a test whose file some project matches, but
 * whose tags every such project's `grep` or `grepInvert` filters out. `tests` must come from a config without grep.
 */
export function testsNoProjectRuns(
  tests: readonly ListedTest[],
  config: PlaywrightTestConfig,
  runProjects: readonly string[],
): string[] {
  const projects = new Map((config.projects ?? []).map((project) => [project.name ?? '(unnamed)', project]));
  const selected = (test: ListedTest): boolean => {
    const project = projects.get(test.project);
    if (project === undefined || !runProjects.includes(test.project)) return false;
    return (project.grep === undefined || anyMatches(project.grep, test.title)) && !anyMatches(project.grepInvert, test.title);
  };
  const keyOf = (test: ListedTest): string => `${test.file} › ${test.title.slice(test.file.length + 1)}`;
  const runs = new Set(tests.filter(selected).map(keyOf));
  return [...new Set(tests.map(keyOf))].filter((key) => !runs.has(key));
}

/** The `--project=` names an npm script passes to `playwright test`. */
export function scriptProjects(script: string): string[] {
  return [...script.matchAll(/--project=(\S+)/g)].map(([, name]) => name ?? '');
}

/** Lists, without running, the tests Playwright would run for `projects`; no browser or web server starts. */
export function listTests(projects: readonly string[], cwd: string, configFile?: string): { suites?: ListedSuite[] } {
  const cli = join(cwd, 'node_modules', '@playwright', 'test', 'cli.js');
  const args = [cli, 'test', '--list', '--reporter=json', ...(configFile === undefined ? [] : ['--config', configFile]), ...projects.map((project) => `--project=${project}`)];
  return JSON.parse(execFileSync(process.execPath, args, { cwd, encoding: 'utf8' })) as { suites?: ListedSuite[] };
}
