import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDir, filesIn, siteAddress } from './site.mjs';

// Usage: node scripts/compare-live.mjs <dist> <url>
//
// Checks that the site at <url> serves the build in <dist> byte for byte, and that a missing file under next/ answers
// 404. It only reads: one plain GET per file, following no redirect, so a redirect is reported rather than followed.

const USAGE = "Usage: node scripts/compare-live.mjs <dist> <url>, where <url> is the site's address ending in a slash, such as https://example.github.io/project/";
const MISSING_FILE = 'next/no-such-file';
const TIMEOUT_MS = 30_000;

/** How the site answers `url`, or why it could not be asked. */
async function ask(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, location: response.headers.get('location'), body: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { failure: `could not fetch ${url.href} (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** What is wrong with how the site answers for `file`, or undefined when it serves the built bytes. */
async function mismatchOf(dir, site, file) {
  const url = new URL(file.split('/').map(encodeURIComponent).join('/'), site);
  const { failure, status, location, body } = await ask(url);
  if (failure !== undefined) return `${file}: ${failure}`;
  if (status !== 200) return `${file}: ${url.href} answers ${String(status)}${location === null ? '' : ` (to ${location})`}, not the built file`;
  const builtBytes = readFileSync(join(dir, file));
  if (builtBytes.equals(body)) return undefined;
  return `${file}: ${url.href} differs from the build (${String(body.length)} bytes live, ${String(builtBytes.length)} built)`;
}

/** What is wrong with how the site answers for a missing file under next/, or undefined when it answers 404. */
async function missingFileMismatch(site) {
  const url = new URL(MISSING_FILE, site);
  const { failure, status } = await ask(url);
  if (failure !== undefined) return `${MISSING_FILE}: ${failure}`;
  return status === 404 ? undefined : `${MISSING_FILE}: ${url.href} answers ${String(status)}, where a missing file must answer 404`;
}

const [dirArgument, siteArgument] = process.argv.slice(2);
if (dirArgument === undefined || siteArgument === undefined) {
  console.error(USAGE);
  process.exit(1);
}
const site = siteAddress(siteArgument);
if (site === undefined) {
  console.error(`${siteArgument} is not an http(s) address ending in a slash; pass the site's address, such as https://example.github.io/project/\n${USAGE}`);
  process.exit(1);
}
const dir = buildDir(dirArgument);
const files = filesIn(dir);

const mismatches = [];
for (const file of files) mismatches.push(await mismatchOf(dir, site, file));
mismatches.push(await missingFileMismatch(site));
const found = mismatches.filter((mismatch) => mismatch !== undefined);

if (found.length > 0) {
  for (const mismatch of found) console.error(mismatch);
  const count = found.length === 1 ? '1 difference' : `${String(found.length)} differences`;
  console.error(`${count} between ${dir} and ${site.href}; if the deploy only just finished, wait a few minutes and run again, else the live site is not this build`);
  process.exit(1);
}
console.log(`${site.href} serves ${dir} byte for byte (${String(files.length)} files), and ${MISSING_FILE} answers 404`);
