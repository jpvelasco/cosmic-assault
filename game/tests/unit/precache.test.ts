import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectPrecache, NOT_PRECACHED, RETIRE_FILE_NAME, SW_FILE_NAME, type BundleEntry } from '../../vite/precache';
import { tempDirs } from '../helpers/guardScript';
import { buildRelease, PUBLIC_DIR } from '../helpers/releaseBuild';

const WORKER_CODE = 'const a=__PRECACHE__,b=__VERSION__;self.addEventListener("install",()=>caches.open(b).then(c=>c.addAll(a)));';

function fakeBundle(indexHtml = '<html></html>'): Record<string, BundleEntry> {
  const entries: BundleEntry[] = [
    { type: 'chunk', fileName: 'assets/index-a1b2.js', code: 'console.log(1)' },
    { type: 'chunk', fileName: 'assets/testBridge-c3d4.js', code: 'export {}' },
    { type: 'chunk', fileName: SW_FILE_NAME, code: WORKER_CODE },
    { type: 'asset', fileName: 'index.html', source: indexHtml },
  ];
  return Object.fromEntries(entries.map((entry) => [entry.fileName, entry]));
}

const PUBLIC = [{ fileName: 'icons/icon-192.png', source: new Uint8Array([1, 2, 3]) }];

function workerCode(bundle: Record<string, BundleEntry>): string {
  const worker = bundle[SW_FILE_NAME];
  if (worker?.type !== 'chunk') throw new Error('the fake bundle lost its worker');
  return worker.code;
}

describe('injectPrecache', () => {
  it('lists every other emitted and public file, plus ./ and index.html, without sw.js', () => {
    const { list } = injectPrecache(fakeBundle(), PUBLIC, 'sha1');
    expect(list).toEqual(['./', 'assets/index-a1b2.js', 'assets/testBridge-c3d4.js', 'icons/icon-192.png', 'index.html']);
  });

  it('leaves the two 512 px icons to the network: the browser fetches them once, when it installs the app', () => {
    const icons = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].map((name) => ({ fileName: `icons/${name}`, source: name }));
    const { list } = injectPrecache(fakeBundle(), icons, 'sha1');
    expect(list.filter((entry) => entry.startsWith('icons/'))).toEqual(['icons/apple-touch-icon.png', 'icons/icon-192.png']);
    expect(NOT_PRECACHED).toEqual(['icons/icon-512.png', 'icons/icon-maskable-512.png']);
  });

  it('keeps every entry relative to the worker', () => {
    const { list } = injectPrecache(fakeBundle(), [{ fileName: 'nested\\win.txt', source: 'x' }], undefined);
    expect(list).toContain('nested/win.txt');
    for (const entry of list) expect(entry).not.toMatch(/^\/|:\/\/|\\/);
  });

  it('adds index.html even when the bundle has none', () => {
    const bundle = fakeBundle();
    delete bundle['index.html'];
    expect(injectPrecache(bundle, [], 'sha1').list).toEqual(['./', 'assets/index-a1b2.js', 'assets/testBridge-c3d4.js', 'index.html']);
  });

  it('leaves the retired preview address out of the list, but still versions by it', () => {
    const withPreview = (stub: string, worker = 'self.onactivate=()=>{}') => {
      const bundle = fakeBundle();
      bundle[RETIRE_FILE_NAME] = { type: 'chunk', fileName: RETIRE_FILE_NAME, code: worker };
      return injectPrecache(bundle, [...PUBLIC, { fileName: 'next/index.html', source: stub }, { fileName: 'nextlevel.png', source: 'x' }], '');
    };
    const { list, version } = withPreview('<h1>Moved</h1>');
    expect(list).toEqual(['./', 'assets/index-a1b2.js', 'assets/testBridge-c3d4.js', 'icons/icon-192.png', 'index.html', 'nextlevel.png']);
    expect(withPreview('<h1>Moved on</h1>').version).not.toBe(version);
    expect(withPreview('<h1>Moved</h1>', 'self.onactivate=null').version).not.toBe(version);
    expect(withPreview('<h1>Moved</h1>').version).toBe(version);
  });

  it('replaces both placeholders in the worker with literals', () => {
    const bundle = fakeBundle();
    const { list } = injectPrecache(bundle, PUBLIC, 'deadbeef');
    const code = workerCode(bundle);
    expect(code).not.toMatch(/__PRECACHE__|__VERSION__/);
    expect(code).toContain(`const a=${JSON.stringify(list)},b="deadbeef"`);
  });

  it('versions by the commit when one is given', () => {
    expect(injectPrecache(fakeBundle(), PUBLIC, 'deadbeef').version).toBe('deadbeef');
  });

  it('otherwise versions by content, so any changed file changes the version', () => {
    const version = (html: string, icon = PUBLIC) => injectPrecache(fakeBundle(html), icon, '').version;
    expect(version('<html></html>')).toMatch(/^[0-9a-f]{12}$/);
    expect(version('<html></html>')).toBe(version('<html></html>'));
    expect(version('<html>new</html>')).not.toBe(version('<html></html>'));
    expect(version('<html></html>', [{ fileName: 'icons/icon-192.png', source: new Uint8Array([9]) }])).not.toBe(version('<html></html>'));
  });

  it('fails with a fix when the worker or a placeholder is missing', () => {
    const bundle = fakeBundle();
    delete bundle['sw.js'];
    expect(() => injectPrecache(bundle, [], 'x')).toThrow(/no sw\.js chunk.*precachePlugin/);

    const noList = fakeBundle();
    noList[SW_FILE_NAME] = { type: 'chunk', fileName: SW_FILE_NAME, code: 'const b=__VERSION__;' };
    expect(() => injectPrecache(noList, [], 'x')).toThrow(/__PRECACHE__.*src\/sw\/worker\.ts/);
  });
});

describe('the release build', () => {
  const tempDir = tempDirs();

  interface Built {
    outDir: string;
    code: string;
    retireCode: string;
    list: string[];
    version: string;
  }

  /** Builds into a fresh temp directory; only `plugins` and the public directory can make two builds differ. */
  async function buildOnce(plugins: Plugin[] = [], publicDir = PUBLIC_DIR): Promise<Built> {
    const outDir = tempDir('precache-build-');
    await buildRelease(outDir, { plugins, publicDir });
    const code = readFileSync(join(outDir, SW_FILE_NAME), 'utf8');
    const retireCode = readFileSync(join(outDir, RETIRE_FILE_NAME), 'utf8');
    const list = JSON.parse(/\["\.\/"[^\]]*\]/.exec(code)?.[0] ?? '[]') as string[];
    return { outDir, code, retireCode, list, version: /"([0-9a-f]{12})"/.exec(code)?.[1] ?? '' };
  }

  /** A copy of public/ whose retired preview page has one more line. */
  function editedPublic(): string {
    const dir = tempDir('precache-public-');
    cpSync(PUBLIC_DIR, dir, { recursive: true });
    const stub = join(dir, 'next', 'index.html');
    writeFileSync(stub, `${readFileSync(stub, 'utf8')}<!-- edited -->\n`);
    return dir;
  }

  beforeEach(() => {
    vi.stubEnv('GITHUB_SHA', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes sw.js as one classic script with the list and version filled in', { timeout: 60000 }, async () => {
    const { outDir, code, list, version } = await buildOnce();

    expect(code).not.toMatch(/__PRECACHE__|__VERSION__/);
    // A classic script cannot hold import or export statements: compiling one as a script would throw.
    expect(() => new Script(code)).not.toThrow();
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(version).not.toBe('');
    // e2e/pages.spec.ts shows why: a page the HTTP cache still calls fresh can be older than the worker's files.
    expect(code, 'the page is revalidated with the host').toMatch(/cache:[`'"]no-cache[`'"]/);

    expect(list).toContain('index.html');
    // The installed app opens offline only if its manifest and small icons (copied from public/) are cached too; the
    // browser fetches the 512 px ones itself when it installs the app.
    expect(list).toEqual(expect.arrayContaining(['manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png']));
    for (const icon of NOT_PRECACHED) expect(list).not.toContain(icon);
    expect(list.some((entry) => /^assets\/.+\.js$/.test(entry))).toBe(true);
    expect(list).not.toContain(SW_FILE_NAME);
    for (const entry of [...list.filter((name) => name !== './'), ...NOT_PRECACHED]) expect(existsSync(join(outDir, entry)), entry).toBe(true);
  });

  it('writes next/sw.js as its own classic script, with no fetch handler, and keeps the retired address out of the list', { timeout: 60000 }, async () => {
    const { outDir, code, retireCode, list } = await buildOnce();

    expect(() => new Script(retireCode)).not.toThrow();
    expect(retireCode).not.toMatch(/\bimport\s*\(/);
    expect(retireCode).toContain('cosmic-assault-next-');
    expect(retireCode, 'it never serves a request').not.toMatch(/["'`]fetch["'`]|respondWith/);
    expect(retireCode, 'it never touches the game\'s cache').not.toContain('cosmic-assault-v2-');
    // Neither worker can load a shared chunk (both compile as classic scripts), and neither carries the other's code.
    expect(code, 'the game\'s worker never unregisters').not.toContain('unregister');
    expect(retireCode, 'the retiring worker never fills a cache').not.toMatch(/addAll|__PRECACHE__/);
    expect(existsSync(join(outDir, 'next', 'index.html'))).toBe(true);
    expect(list.filter((entry) => entry.startsWith('next'))).toEqual([]);
  });

  it('versions by every emitted file, index.html and the retired address included, so a change to any one changes the version', { timeout: 120000 }, async () => {
    const editPage: Plugin = { name: 'edit-page', transformIndexHtml: (html) => html.replace('</body>', '<!-- edited --></body>') };
    const editRetire: Plugin = {
      name: 'edit-retire',
      transform: (source, id) => (id.endsWith('src/sw/retire.ts') ? `${source}\nconsole.info('edited');\n` : undefined),
    };
    const first = await buildOnce();
    const again = await buildOnce();
    const edited = await buildOnce([editPage]);
    const retireEdited = await buildOnce([editRetire]);
    const stubEdited = await buildOnce([], editedPublic());

    expect(again.version, 'the same sources give the same version').toBe(first.version);
    expect(retireEdited.retireCode, 'the edit reached next/sw.js').toContain('edited');
    for (const [name, build] of Object.entries({ edited, retireEdited, stubEdited })) {
      expect(build.list, `${name}: the list stays`).toEqual(first.list);
      expect(build.version, `${name}: the version changes`).not.toBe(first.version);
    }
  });
});
