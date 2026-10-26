import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { injectPrecache, SW_FILE_NAME, type BundleEntry } from '../../vite/precache';

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
  const outDir = mkdtempSync(join(tmpdir(), 'precache-build-'));
  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes sw.js as one classic script with the list and version filled in', { timeout: 60000 }, async () => {
    await build({ configFile: new URL('../../vite.config.ts', import.meta.url).pathname, logLevel: 'silent', build: { outDir, emptyOutDir: true } });

    const swPath = join(outDir, SW_FILE_NAME);
    expect(existsSync(swPath)).toBe(true);
    const code = readFileSync(swPath, 'utf8');
    expect(code).not.toMatch(/__PRECACHE__|__VERSION__/);
    // A classic script cannot hold import or export statements: compiling one as a script would throw.
    expect(() => new Script(code)).not.toThrow();
    expect(code).not.toMatch(/\bimport\s*\(/);

    const list = JSON.parse(/\["\.\/"[^\]]*\]/.exec(code)?.[0] ?? '[]') as string[];
    expect(list).toContain('index.html');
    expect(list.some((entry) => /^assets\/.+\.js$/.test(entry))).toBe(true);
    expect(list).not.toContain(SW_FILE_NAME);
    for (const entry of list.filter((name) => name !== './')) expect(existsSync(join(outDir, entry)), entry).toBe(true);
  });
});
