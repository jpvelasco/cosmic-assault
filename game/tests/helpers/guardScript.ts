import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const gameDir = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Test harness for a `scripts/*.mjs` guard: `run` executes it from game/ with one path argument,
 * and `tempRoot` makes a directory that is removed after the file's tests.
 * Call it at the top level of a test file so the cleanup hook registers there.
 */
export function guardScript(script: string, tempPrefix: string) {
  const tempRoots: string[] = [];
  afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });
  return {
    run: (pathArg: string) => {
      const { status, stdout, stderr } = spawnSync('node', [`scripts/${script}`, pathArg], {
        cwd: gameDir,
        encoding: 'utf8',
      });
      return { status, output: stdout + stderr };
    },
    tempRoot: (): string => {
      const root = mkdtempSync(join(tmpdir(), tempPrefix));
      tempRoots.push(root);
      return root;
    },
  };
}
