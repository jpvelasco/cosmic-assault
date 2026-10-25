import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardScript } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-no-bridge.mjs', 'check-no-bridge-');

/** Writes `files` (relative path → contents) into a fresh temp dist directory. */
function writeDist(files: Record<string, string>): string {
  const root = tempRoot();
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

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
