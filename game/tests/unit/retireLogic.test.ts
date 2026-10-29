import { describe, expect, it } from 'vitest';
import { RETIRED_CACHE_PREFIX, retirePreview, type RetireHost, type RetireWindow } from '../../src/platform/retireLogic';
import { PREVIEW_CACHE_PREFIX } from '../../src/platform/swLogic';
import { importClosure, importsOf, sourcesUnder } from '../helpers/sourceImports';

const SCOPES = [new URL('https://example.test/cosmic-assault/next/'), new URL('https://example.test/next/')];

interface FakeHost extends RetireHost {
  /** Every call the worker made, in order. */
  readonly calls: string[];
  /** The caches left after the run. */
  readonly caches: Set<string>;
}

/** A host holding `caches` and windows at `urls`; `fail` names the calls that throw or reject. */
function fakeHost(caches: readonly string[], urls: readonly string[], fail: { deleteCache?: string; navigate?: string; claim?: boolean } = {}): FakeHost {
  const calls: string[] = [];
  const held = new Set(caches);
  const windows: RetireWindow[] = urls.map((url) => ({
    url,
    navigate: (to) => {
      calls.push(`navigate ${url} → ${to}`);
      return url === fail.navigate ? Promise.reject(new Error('the tab is gone')) : Promise.resolve(null);
    },
  }));
  return {
    calls,
    caches: held,
    claim: () => {
      calls.push('claim');
      return fail.claim === true ? Promise.reject(new Error('claim refused')) : Promise.resolve();
    },
    cacheNames: () => Promise.resolve([...held]),
    deleteCache: (name) => {
      calls.push(`delete ${name}`);
      // Thrown, not rejected: a host may fail either way.
      if (name === fail.deleteCache) throw new Error('storage is locked');
      return Promise.resolve(held.delete(name));
    },
    windows: () => Promise.resolve(windows),
    unregister: () => {
      calls.push('unregister');
      return Promise.resolve(true);
    },
  };
}

describe('RETIRED_CACHE_PREFIX', () => {
  it('is the frozen name the preview worker gave its caches, which the game worker clears too', () => {
    expect(RETIRED_CACHE_PREFIX).toBe('cosmic-assault-next-');
    expect(RETIRED_CACHE_PREFIX).toBe(PREVIEW_CACHE_PREFIX);
  });
});

describe.each(SCOPES.map((scope) => [scope.href, scope] as const))('retirePreview with the scope %s', (_, scope) => {
  const root = new URL('../', scope).href;
  const under = (path: string): string => new URL(path, scope).href;

  it('deletes only the preview\'s caches, never the game\'s or another app\'s', async () => {
    const host = fakeHost(['cosmic-assault-next-abc', 'cosmic-assault-next-old', 'cosmic-assault-v2-abc', 'another-app', 'cosmic-assault-next'], []);

    expect(await retirePreview(host, scope)).toEqual([]);
    expect([...host.caches].sort()).toEqual(['another-app', 'cosmic-assault-next', 'cosmic-assault-v2-abc']);
  });

  it('takes control of its pages before navigating any, and unregisters last', async () => {
    const host = fakeHost(['cosmic-assault-next-abc'], [under('./'), under('index.html?x=1')]);

    await retirePreview(host, scope);

    expect(host.calls).toEqual([
      'claim',
      'delete cosmic-assault-next-abc',
      `navigate ${under('./')} → ${root}`,
      `navigate ${under('index.html?x=1')} → ${root}`,
      'unregister',
    ]);
  });

  it('sends only the windows under its scope to the site root, leaving the game and other projects alone', async () => {
    const outside = [root, new URL('nextlevel/', root).href, new URL('/other-project/', scope).href, `https://other.test${scope.pathname}`];
    const host = fakeHost([], [...outside, under('./'), under('deep/page.html')]);

    await retirePreview(host, scope);

    expect(host.calls.filter((call) => call.startsWith('navigate'))).toEqual([`navigate ${under('./')} → ${root}`, `navigate ${under('deep/page.html')} → ${root}`]);
  });

  it('runs every later step when deleting a cache throws or a navigation rejects, and names each failure', async () => {
    const host = fakeHost(['cosmic-assault-next-a', 'cosmic-assault-next-b'], [under('./'), under('index.html')], {
      deleteCache: 'cosmic-assault-next-a',
      navigate: under('./'),
    });

    const problems = await retirePreview(host, scope);

    expect(host.caches.has('cosmic-assault-next-b'), 'the other cache still goes').toBe(false);
    expect(host.calls).toContain(`navigate ${under('index.html')} → ${root}`);
    expect(host.calls.at(-1)).toBe('unregister');
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/cosmic-assault-next-a.*storage is locked/);
    expect(problems[1]).toMatch(/the tab is gone/);
  });

  it('still clears, navigates and unregisters when claiming fails, and never throws', async () => {
    const host = fakeHost(['cosmic-assault-next-a'], [under('./')], { claim: true });
    const failing: RetireHost = { ...host, cacheNames: () => Promise.reject(new Error('no storage')), unregister: () => Promise.reject(new Error('gone')) };

    expect(await retirePreview(host, scope)).toEqual([expect.stringMatching(/claim refused/)]);
    expect(host.calls).toEqual(['claim', 'delete cosmic-assault-next-a', `navigate ${under('./')} → ${root}`, 'unregister']);
    const problems = await retirePreview(failing, scope);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/claim refused[\s\S]*no storage[\s\S]*gone/);
  });
});

describe('the retiring worker\'s imports', () => {
  it('loads its decisions and nothing else, and the decisions load nothing', () => {
    expect(importClosure('sw/retire.ts')).toEqual(['platform/retireLogic', 'sw/retire']);
    expect(importsOf('platform/retireLogic.ts')).toEqual([]);
  });

  it('shares no module with the game or its worker, in either direction', () => {
    const others = sourcesUnder('.').filter((file) => file !== 'sw/retire.ts');
    expect(others).toContain('sw/worker.ts');
    expect(others).toContain('main.ts');
    const leaks = others.flatMap((file) =>
      importClosure(file)
        .filter((module) => module === 'sw/retire' || module === 'platform/retireLogic')
        .filter((module) => `${module}.ts` !== file)
        .map((module) => `${file} loads ${module}`),
    );
    expect(leaks, leaks.join('\n')).toEqual([]);
  });
});
