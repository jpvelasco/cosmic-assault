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
