import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const gameDir = fileURLToPath(new URL('../../', import.meta.url));
const tempRoots: string[] = [];

function runGuard(distDir: string) {
  const { status, stdout, stderr } = spawnSync('node', ['scripts/check-no-bridge.mjs', distDir], {
    cwd: gameDir,
    encoding: 'utf8',
  });
  return { status, output: stdout + stderr };
}

/** Writes `files` (relative path → contents) into a fresh temp dist directory. */
function writeDist(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'check-no-bridge-'));
  tempRoots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('check-no-bridge', () => {
  it('passes a build without the bridge', () => {
    const result = runGuard(writeDist({ 'index.html': '<html></html>', 'assets/index.js': 'console.log(1)' }));
    expect(result).toEqual({ status: 0, output: 'bridge absent\n' });
  });

  it('fails when any nested file mentions the bridge', () => {
    const dist = writeDist({
      'index.html': '<html></html>',
      'assets/deep/chunk.js': 'window.__COSMIC_ASSAULT_TEST_API__ = {}',
    });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      'dist/ contains the e2e test bridge; release builds must not — check the import.meta.env.MODE guard in src/main.ts',
    );
    expect(result.output).toContain(join('assets', 'deep', 'chunk.js'));
  });

  it('fails with a hint when the directory is missing', () => {
    const result = runGuard(join(writeDist({}), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('run npm run build first');
  });
});
