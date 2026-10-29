import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const gameDir = fileURLToPath(new URL('../../', import.meta.url));
/**
 * Where a test writes a site for the Pages server, which serves only directories inside game/: under
 * node_modules/.cache, which Git ignores and Playwright, which empties test-results/ on every run, leaves alone.
 */
export const gameScratch = join(gameDir, 'node_modules', '.cache', 'test-sites');

/** Tests that spawn Node on a script take a few seconds apiece on a loaded host; give their suites this timeout. */
export const SPAWN_TIMEOUT_MS = 30_000;

interface GuardResult {
  readonly status: number | null;
  readonly output: string;
}

/**
 * A maker of fresh directories, each named from `prefix` under `parent` (the system's temp directory by default), all
 * removed after the file's or the describe block's tests. Call it where the cleanup hook should register.
 */
export function tempDirs(): (prefix: string, parent?: string) => string {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
  return (prefix, parent = tmpdir()) => {
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(join(parent, prefix));
    made.push(dir);
    return dir;
  };
}

/** Writes `files` (path relative to `root` → contents) into `root`, making the directories they need, and returns `root`. */
export function writeFiles(root: string, files: Readonly<Record<string, string>>): string {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

/**
 * Test harness for a `scripts/*.mjs` guard: `run` executes it from game/ with the given arguments, `runAsync` does so
 * without blocking (for a guard that talks to a server in this process), and `tempRoot` makes a directory, under
 * `parent` (the system's temp directory by default), that is removed after the file's tests.
 * Call it at the top level of a test file so the cleanup hook registers there.
 */
export function guardScript(script: string, tempPrefix: string) {
  const makeDir = tempDirs();
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
    tempRoot: (parent?: string): string => makeDir(tempPrefix, parent),
  };
}
