import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const gameDir = fileURLToPath(new URL('../../', import.meta.url));
/** game/'s ignored directory for test output, where a test writes a site for the Pages server, which serves only directories inside game/. */
export const gameTestResults = join(gameDir, 'test-results');

/** Tests that spawn Node on a script take a few seconds apiece on a loaded host; give their suites this timeout. */
export const SPAWN_TIMEOUT_MS = 30_000;

interface GuardResult {
  readonly status: number | null;
  readonly output: string;
}

/**
 * Test harness for a `scripts/*.mjs` guard: `run` executes it from game/ with the given arguments, `runAsync` does so
 * without blocking (for a guard that talks to a server in this process), and `tempRoot` makes a directory, under
 * `parent` (the system's temp directory by default), that is removed after the file's tests.
 * Call it at the top level of a test file so the cleanup hook registers there.
 */
export function guardScript(script: string, tempPrefix: string) {
  const tempRoots: string[] = [];
  afterAll(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });
  const argv = (args: readonly string[]): string[] => [`scripts/${script}`, ...args];
  return {
    run: (...args: string[]): GuardResult => {
      const { status, stdout, stderr } = spawnSync('node', argv(args), { cwd: gameDir, encoding: 'utf8' });
      return { status, output: stdout + stderr };
    },
    runAsync: (...args: string[]): Promise<GuardResult> =>
      new Promise((resolve, reject) => {
        const child = spawn('node', argv(args), { cwd: gameDir });
        let output = '';
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
        child.on('error', reject);
        child.on('close', (status) => {
          resolve({ status, output });
        });
      }),
    tempRoot: (parent = tmpdir()): string => {
      mkdirSync(parent, { recursive: true });
      const root = mkdtempSync(join(parent, tempPrefix));
      tempRoots.push(root);
      return root;
    },
  };
}
