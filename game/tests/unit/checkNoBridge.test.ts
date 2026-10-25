import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardScript } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-no-bridge.mjs', 'check-no-bridge-');

const BRIDGE = 'window.__COSMIC_ASSAULT_TEST_API__ = {}';
const QUERY = 'console.warn(`__E2E_QUERY__ Ignoring ?seed=`)';

/** Writes `files` (relative path → contents) into a fresh temp build directory. */
function writeDist(files: Record<string, string>): string {
  const root = tempRoot();
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe('check-no-bridge (release build)', () => {
  it('passes a build without the bridge or the e2e query parsing', () => {
    const result = runGuard(writeDist({ 'index.html': '<html></html>', 'assets/index.js': 'console.log(1)' }));
    expect(result).toEqual({ status: 0, output: 'e2e bridge and query parsing absent\n' });
  });

  it('fails when any nested file mentions the bridge, naming the build and the file', () => {
    const dist = writeDist({ 'index.html': '<html></html>', 'assets/deep/chunk.js': BRIDGE });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `release build ${dist} contains the e2e test bridge; release builds must not — check the import.meta.env.MODE guard in src/main.ts`,
    );
    expect(result.output).toContain(join('assets', 'deep', 'chunk.js'));
  });

  it('fails when a file carries the e2e query parsing, naming the build and the file', () => {
    const dist = writeDist({ 'assets/index.js': QUERY });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `release build ${dist} contains the e2e ?seed= and ?lives= parsing; release builds must not — check the import.meta.env.MODE guard in src/app/seed.ts`,
    );
    expect(result.output).toContain(join('assets', 'index.js'));
  });

  it('fails with a hint when the directory is missing', () => {
    const result = runGuard(join(writeDist({}), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('run npm run build first');
  });
});

describe('check-no-bridge --e2e (e2e build)', () => {
  it('passes a build that carries both markers', () => {
    const result = runGuard('--e2e', writeDist({ 'assets/index.js': QUERY, 'assets/bridge.js': BRIDGE }));
    expect(result).toEqual({ status: 0, output: 'e2e bridge and query parsing present\n' });
  });

  it('fails when the query mark is missing, so the release check cannot go blind', () => {
    const dist = writeDist({ 'assets/bridge.js': BRIDGE });
    const result = runGuard('--e2e', dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `e2e build ${dist} lacks the e2e ?seed= and ?lives= parsing (__E2E_QUERY__); the release check scans for that mark, so keep it in src/app/seed.ts or update scripts/check-no-bridge.mjs`,
    );
  });

  it('fails with a hint when the directory is missing', () => {
    const result = runGuard('--e2e', join(writeDist({}), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('run npm run build:e2e first');
  });
});
