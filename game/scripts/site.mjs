import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The site the scripts check: the build directory that holds it, the files in it, and the address it is published at.

/**
 * The build directory a guard checks: `argument` from its command line, or else game/<fallback>. Exits with a hint to
 * run `npm run <buildScript>` when the directory is missing.
 */
export function buildDir(argument, { fallback = 'dist', buildScript = 'build' } = {}) {
  const dir = resolve(argument ?? fileURLToPath(new URL(`../${fallback}`, import.meta.url)));
  if (!existsSync(dir)) {
    console.error(`${dir} does not exist; run npm run ${buildScript} first`);
    process.exit(1);
  }
  return dir;
}

/** Every file under `dir`, as a path relative to it with forward slashes, sorted. */
export function filesIn(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** `text` as the address of a site's directory, or undefined unless it is http(s), ends in a slash and has no query or hash. */
export function siteAddress(text) {
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  const ok = ['http:', 'https:'].includes(url.protocol) && url.pathname.endsWith('/') && url.search === '' && url.hash === '';
  return ok ? url : undefined;
}
