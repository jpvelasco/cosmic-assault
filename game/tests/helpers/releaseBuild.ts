import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import { beforeAll } from 'vitest';

/** The game's own `public/` directory, which a release build copies as is. */
export const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const CONFIG_FILE = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));

/** A release build takes a few seconds on a loaded host; give a hook or test that makes one this timeout. */
const BUILD_TIMEOUT_MS = 60_000;

/**
 * Builds the release game into `outDir` with a fixed build date, so only `plugins` and `publicDir` can make two builds
 * differ.
 */
export async function buildRelease(outDir: string, { plugins = [], publicDir = PUBLIC_DIR }: { plugins?: Plugin[]; publicDir?: string } = {}): Promise<void> {
  await build({
    configFile: CONFIG_FILE,
    logLevel: 'silent',
    plugins,
    publicDir,
    define: { __BUILD_DATE__: JSON.stringify('2026-01-01T00:00:00.000Z') },
    build: { outDir, emptyOutDir: true },
  });
}

/**
 * One real release build for a test file, made before its tests into a directory from `makeDir`: `dir()` is where it
 * is, and `copy(change)` makes a copy of it, in another such directory, with `change` applied.
 * Call it at the top level of a test file so the build hook registers there.
 */
export function sharedReleaseBuild(makeDir: () => string) {
  let built = '';
  beforeAll(async () => {
    built = makeDir();
    await buildRelease(built);
  }, BUILD_TIMEOUT_MS);
  return {
    dir: (): string => built,
    copy: (change: (dir: string) => void = () => undefined): string => {
      const dir = makeDir();
      cpSync(built, dir, { recursive: true });
      change(dir);
      return dir;
    },
  };
}
