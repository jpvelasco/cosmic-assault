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
  readonly specs?: readonly { readonly tests: readonly unknown[] }[];
  readonly suites?: readonly ListedSuite[];
}

function hasTests(suite: ListedSuite): boolean {
  return (suite.specs ?? []).some((spec) => spec.tests.length > 0) || (suite.suites ?? []).some(hasTests);
}

/** The spec files in `report` that keep at least one test once testMatch, grep and tags have had their say. */
export function specsWithTests(report: { readonly suites?: readonly ListedSuite[] }): string[] {
  return (report.suites ?? []).filter(hasTests).map((suite) => suite.file);
}

/** The `--project=` names an npm script passes to `playwright test`. */
export function scriptProjects(script: string): string[] {
  return [...script.matchAll(/--project=(\S+)/g)].map(([, name]) => name ?? '');
}

/** Lists, without running, the tests Playwright would run for `projects`; no browser or web server starts. */
export function listTests(projects: readonly string[], cwd: string): { suites?: ListedSuite[] } {
  const cli = join(cwd, 'node_modules', '@playwright', 'test', 'cli.js');
  const args = [cli, 'test', '--list', '--reporter=json', ...projects.map((project) => `--project=${project}`)];
  return JSON.parse(execFileSync(process.execPath, args, { cwd, encoding: 'utf8' })) as { suites?: ListedSuite[] };
}
