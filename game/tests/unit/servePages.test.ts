import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createPagesServer, NOT_FOUND_BODY, type PagesMount, type PagesServer } from '../../scripts/serve-pages.mjs';
import { gameDir, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';

// The server only serves directories inside game/, so the sites under test are written to its ignored test-results/.
const sitesRoot = join(gameDir, 'test-results');
const roots: string[] = [];
const servers: PagesServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` (relative path → contents) into a fresh directory inside game/. */
function site(files: Record<string, string>): string {
  mkdirSync(sitesRoot, { recursive: true });
  const root = mkdtempSync(join(sitesRoot, 'serve-pages-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

async function serve(mounts: readonly PagesMount[], prefix?: string): Promise<PagesServer> {
  const server = await createPagesServer(prefix === undefined ? { mounts } : { prefix, mounts });
  servers.push(server);
  return server;
}

/** Fetches `path` from the server's origin (not its prefix), without following a redirect. */
function get(server: PagesServer, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, server.url), { redirect: 'manual', ...init });
}

const GAME = { 'index.html': '<h1>Game</h1>', 'sw.js': 'const VERSION = "v1";', 'assets/app.js': 'go()', 'next/index.html': '<h1>Moved</h1>' };

describe('createPagesServer', () => {
  it('serves each mount under the prefix, a directory URL by its index.html', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }], '/cosmic-assault/');

    expect(server.url).toMatch(/^http:\/\/localhost:\d+\/cosmic-assault\/$/);
    const index = await get(server, '/cosmic-assault/');
    expect(index.status).toBe(200);
    expect(await index.text()).toBe('<h1>Game</h1>');
    expect(await (await get(server, '/cosmic-assault/next/')).text()).toBe('<h1>Moved</h1>');
    expect(await (await get(server, '/cosmic-assault/assets/app.js')).text()).toBe('go()');
  });

  it('serves nothing outside the prefix, and a mount may sit beside it', async () => {
    const other = site({ 'index.html': '<h1>Other</h1>' });
    const server = await serve([{ dir: site(GAME), at: './' }, { dir: other, at: '../other-project/' }], '/cosmic-assault/');

    expect((await get(server, '/')).status).toBe(404);
    expect((await get(server, '/index.html')).status).toBe(404);
    expect(await (await get(server, '/other-project/')).text()).toBe('<h1>Other</h1>');
  });

  it('serves at the origin root by default', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }]);

    expect(server.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(await (await get(server, '/')).text()).toBe('<h1>Game</h1>');
  });

  it('answers a URL from the last mount that holds it alone, so a later mount hides what an earlier one had there', async () => {
    const preview = site({ 'index.html': '<h1>Preview</h1>' });
    const server = await serve([{ dir: site(GAME), at: './' }, { dir: preview, at: 'next/' }]);

    expect(await (await get(server, '/next/')).text()).toBe('<h1>Preview</h1>');
    expect(await (await get(server, '/')).text()).toBe('<h1>Game</h1>');

    server.setMounts([{ dir: site(GAME), at: './' }, { dir: site({}), at: 'next/' }]);
    expect((await get(server, '/next/')).status).toBe(404);
  });

  it('swaps mounts at once', async () => {
    const server = await serve([{ dir: site({ 'index.html': 'before' }), at: './' }]);
    expect(await (await get(server, '/')).text()).toBe('before');

    server.setMounts([{ dir: site({ 'index.html': 'after' }), at: './' }]);
    expect(await (await get(server, '/')).text()).toBe('after');
  });

  it('answers 301 to the slash form for a directory without one, keeping the query', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }], '/cosmic-assault/');

    const moved = await get(server, '/cosmic-assault/next?from=old');
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/cosmic-assault/next/?from=old');
    expect((await get(server, '/cosmic-assault')).headers.get('location')).toBe('/cosmic-assault/');
  });

  it('answers 301 for a mount\'s own directory, even where the mount below has no such directory', async () => {
    const server = await serve([{ dir: site({ 'index.html': 'root' }), at: './' }, { dir: site({}), at: 'next/' }]);

    const moved = await get(server, '/next');
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/next/');
    expect((await get(server, '/next/')).status).toBe(404);
  });

  it('answers 404 with a small HTML page for anything missing', async () => {
    const server = await serve([{ dir: site({ ...GAME, 'empty/readme.txt': 'x' }), at: './' }]);

    for (const path of ['/missing.js', '/next/missing', '/empty/', '/sw.js/', '/%E0%A4%A']) {
      const missing = await get(server, path);
      expect(missing.status, path).toBe(404);
      expect(missing.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      expect(await missing.text(), path).toBe(NOT_FOUND_BODY);
    }
  });

  it('never serves a file outside the mount, however the path is spelled', async () => {
    const outer = site({ 'secret.txt': 'secret', 'inner/index.html': 'inner' });
    const server = await serve([{ dir: join(outer, 'inner'), at: './' }]);

    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2Fsecret.txt', '/%2E%2E%2fsecret.txt']) {
      const response = await get(server, path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain('secret');
    }
  });

  it('refuses a directory outside game/, naming it, when created and when the mounts change', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'serve-pages-outside-'));
    roots.push(outside);

    await expect(createPagesServer({ mounts: [{ dir: outside, at: './' }] })).rejects.toThrow(`${outside} is not inside game/`);
    await expect(createPagesServer({ mounts: [{ dir: gameDir, at: './' }] })).rejects.toThrow('is not inside game/');
    const server = await serve([{ dir: site(GAME), at: './' }]);
    expect(() => {
      server.setMounts([{ dir: join(gameDir, '..'), at: './' }]);
    }).toThrow('is not inside game/');
    expect(await (await get(server, '/')).text(), 'a refused swap keeps the old mounts').toBe('<h1>Game</h1>');
  });

  it('refuses a prefix or mount point that is not a directory', async () => {
    const dir = site(GAME);
    await expect(createPagesServer({ prefix: 'cosmic-assault', mounts: [] })).rejects.toThrow('prefix');
    await expect(createPagesServer({ prefix: '/cosmic-assault', mounts: [] })).rejects.toThrow('prefix');
    await expect(createPagesServer({ mounts: [{ dir, at: 'next' }] })).rejects.toThrow('next');
  });

  it('sends no-cache with an ETag on every answer, and 304 when the ETag still matches', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }]);

    for (const path of ['/', '/sw.js', '/next', '/missing']) {
      const response = await get(server, path);
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
      expect(response.headers.get('etag'), path).toMatch(/^"[0-9a-f]+"$/);
    }
    const etag = (await get(server, '/sw.js')).headers.get('etag') ?? '';
    const again = await get(server, '/sw.js', { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  it('rewrites one literal in one served file, which changes its ETag', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }], '/cosmic-assault/');
    const before = await get(server, '/cosmic-assault/sw.js');

    server.rewrite('sw.js', '"v1"', '"v1b"');

    const after = await get(server, '/cosmic-assault/sw.js');
    expect(await after.text()).toBe('const VERSION = "v1b";');
    expect(after.headers.get('etag')).not.toBe(before.headers.get('etag'));
    expect(await (await get(server, '/cosmic-assault/')).text(), 'other files are untouched').toBe('<h1>Game</h1>');
  });

  it('refuses a rewrite of a missing file or a literal the file lacks', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }]);

    expect(() => {
      server.rewrite('nope.js', 'a', 'b');
    }).toThrow('nope.js');
    expect(() => {
      server.rewrite('sw.js', '"v9"', '"v9b"');
    }).toThrow('"v9"');
  });

  it('names the content type of each kind of file the site has', async () => {
    const types = {
      'a.html': 'text/html; charset=utf-8',
      'a.js': 'text/javascript; charset=utf-8',
      'a.mjs': 'text/javascript; charset=utf-8',
      'a.json': 'application/json; charset=utf-8',
      'a.webmanifest': 'application/manifest+json; charset=utf-8',
      'a.png': 'image/png',
      'a.svg': 'image/svg+xml',
      'a.css': 'text/css; charset=utf-8',
      'a.bin': 'application/octet-stream',
    };
    const server = await serve([{ dir: site(Object.fromEntries(Object.keys(types).map((name) => [name, 'x']))), at: './' }]);

    for (const [name, type] of Object.entries(types)) {
      expect((await get(server, `/${name}`)).headers.get('content-type'), name).toBe(type);
    }
  });

  it('answers HEAD without a body, and refuses other methods', async () => {
    const server = await serve([{ dir: site(GAME), at: './' }]);

    const head = await get(server, '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await get(server, '/', { method: 'POST' })).status).toBe(405);
  });
});

describe('serve-pages.mjs as a command', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('serves --dir under --prefix and prints its address', async () => {
    const dir = site(GAME);
    const child = spawn(process.execPath, ['scripts/serve-pages.mjs', '--dir', dir, '--prefix', '/cosmic-assault/', '--port', '0'], { cwd: gameDir });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const found = /http:\/\/localhost:\d+\/cosmic-assault\//.exec(output);
          if (found) resolve(found[0]);
        });
        child.on('exit', (code) => {
          reject(new Error(`serve-pages.mjs exited with ${String(code)}: ${output}`));
        });
      });
      expect(await (await fetch(url)).text()).toBe('<h1>Game</h1>');
    } finally {
      child.kill();
    }
  });

  it('fails with a usage line when --dir is missing', async () => {
    const child = spawn(process.execPath, ['scripts/serve-pages.mjs'], { cwd: gameDir });
    let output = '';
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(1);
    expect(output).toContain('Usage: node scripts/serve-pages.mjs --dir <dir>');
  });
});
