import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const gameDir = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Test harness for a `scripts/*.mjs` guard: `run` executes it from game/ with the given arguments,
 * and `tempRoot` makes a directory that is removed after the file's tests.
 * Call it at the top level of a test file so the cleanup hook registers there.
 */
/** Tests that spawn Node on a script take a few seconds apiece on a loaded host; give their suites this timeout. */
export const SPAWN_TIMEOUT_MS = 30_000;

export function guardScript(script: string, tempPrefix: string) {
  const tempRoots: string[] = [];
  afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });
  return {
    run: (...args: string[]) => {
      const { status, stdout, stderr } = spawnSync('node', [`scripts/${script}`, ...args], {
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
