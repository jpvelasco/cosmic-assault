import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export const SW_FILE_NAME = 'sw.js';
const WORKER_ENTRY = 'src/sw/worker.ts';

/** The part of a Rolldown output bundle entry this plugin reads; the worker's `code` is rewritten in place. */
export type BundleEntry =
  | { readonly type: 'chunk'; readonly fileName: string; code: string }
  | { readonly type: 'asset'; readonly fileName: string; readonly source: string | Uint8Array };

/** A file Vite copies from `public/` as is, outside the bundle. */
export interface PublicFile {
  readonly fileName: string;
  readonly source: string | Uint8Array;
}

function contentHash(files: readonly PublicFile[]): string {
  const hash = createHash('sha256');
  for (const { fileName, source } of files) hash.update(fileName).update('\0').update(source).update('\0');
  return hash.digest('hex').slice(0, 12);
}

/**
 * Writes the precache list and version into the bundled worker: the list is every other built file plus `./` and
 * `index.html`, relative to the worker; the version is `sha` (the commit) or else a hash of those files' contents.
 */
export function injectPrecache(
  bundle: Record<string, BundleEntry>,
  publicFiles: readonly PublicFile[],
  sha: string | undefined,
): { list: string[]; version: string } {
  const worker = bundle[SW_FILE_NAME];
  if (worker?.type !== 'chunk') {
    throw new Error(`The build has no ${SW_FILE_NAME} chunk; keep precachePlugin() in vite.config.ts emitting ${WORKER_ENTRY}`);
  }
  const files = [
    ...Object.values(bundle)
      .filter((entry) => entry !== worker)
      .map((entry) => ({ fileName: entry.fileName, source: entry.type === 'chunk' ? entry.code : entry.source })),
    ...publicFiles,
  ]
    .map((file) => ({ ...file, fileName: file.fileName.replaceAll('\\', '/') }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  const list = [...new Set(['./', 'index.html', ...files.map((file) => file.fileName)])].sort();
  const version = sha || contentHash(files);
  const literals = { __PRECACHE__: JSON.stringify(list), __VERSION__: JSON.stringify(version) };
  for (const [placeholder, literal] of Object.entries(literals)) {
    if (!worker.code.includes(placeholder)) {
      throw new Error(`${SW_FILE_NAME} has no ${placeholder} placeholder; keep its declaration and use in ${WORKER_ENTRY}`);
    }
    worker.code = worker.code.replaceAll(placeholder, literal);
  }
  return { list, version };
}

function readPublicFiles(dir: string): PublicFile[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => ({ fileName: relative(dir, path), source: readFileSync(path) }));
}

/** Builds `src/sw/worker.ts` into an unhashed `sw.js` and fills in its precache list and version. */
export function precachePlugin(): Plugin {
  let publicDir = '';
  let copyPublicDir = true;
  return {
    name: 'cosmic-assault:precache',
    apply: 'build',
    configResolved(config) {
      ({ publicDir } = config);
      copyPublicDir = config.build.copyPublicDir;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: WORKER_ENTRY, fileName: SW_FILE_NAME });
    },
    generateBundle(_options, bundle) {
      injectPrecache(bundle, copyPublicDir ? readPublicFiles(publicDir) : [], process.env['GITHUB_SHA']);
    },
  };
}
