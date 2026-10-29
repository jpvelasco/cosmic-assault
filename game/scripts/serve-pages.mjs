import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Usage: node scripts/serve-pages.mjs --dir <dir> [--prefix /cosmic-assault/] [--port 4319]
//
// A static server that answers like GitHub Pages, for tests: a directory URL serves its index.html, a directory
// without its trailing slash answers 301 to the slash form, and anything else missing answers 404. Unlike Pages, every
// answer carries `Cache-Control: no-cache` with an ETag, so a test that swaps what is served sees the change at once;
// a mount given `maxAge` sends its files with `max-age` instead, as Pages does (PAGES_MAX_AGE_SECONDS).

const GAME_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const USAGE = 'Usage: node scripts/serve-pages.mjs --dir <dir> [--prefix /cosmic-assault/] [--port 4319]';

/** How long Pages lets a browser keep any file it serves without asking again (`Cache-Control: max-age=600`). */
export const PAGES_MAX_AGE_SECONDS = 600;

export const NOT_FOUND_BODY = '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Page not found</title><h1>404</h1><p>There is no page at this address.</p></html>\n';
const MOVED_BODY = '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Moved</title><h1>301</h1><p>This page has moved.</p></html>\n';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
};

/** True when `path` is `root` itself or below it. */
function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The URL path of `path`, a site path relative to `prefix`. */
function sitePath(prefix, path) {
  return new URL(path, `http://pages${prefix}`).pathname;
}

/** Each mount's directory, checked to be inside game/, the URL path it answers for, and its files' Cache-Control. */
function placeMounts(prefix, mounts) {
  return mounts.map(({ dir, at, maxAge }) => {
    const root = resolve(dir);
    if (root === GAME_DIR || !isWithin(GAME_DIR, root)) {
      throw new Error(`${root} is not inside game/; serve a directory inside ${GAME_DIR}, such as dist`);
    }
    const path = sitePath(prefix, at);
    if (!path.endsWith('/')) throw new Error(`The mount point ${at} is not a directory; end it with a slash, as in ${at}/`);
    return { root, path, cacheControl: maxAge === undefined ? 'no-cache' : `max-age=${String(maxAge)}` };
  });
}

function statOf(file) {
  try {
    return statSync(file);
  } catch {
    return undefined;
  }
}

/**
 * `pathname` decoded once, so every spelling of an address matches the same mount; undefined for a malformed escape or
 * an encoded slash, backslash or NUL, which no file's address holds.
 */
function decodedPath(pathname) {
  if (/%(2f|5c|00)/i.test(pathname)) return undefined;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

/**
 * Where the URL path `pathname` leads: a file to serve and the mount it is served from, a 301 to the slash form, or
 * nothing. A URL is answered by the last mount whose path holds it, from that mount's directory alone.
 */
function locate(mounts, pathname) {
  const path = decodedPath(pathname);
  if (path === undefined) return {};
  if (mounts.some((mount) => mount.path === `${path}/`)) return { moved: true };
  const mount = mounts.findLast((candidate) => path.startsWith(candidate.path));
  if (mount === undefined) return {};
  const target = join(mount.root, path.slice(mount.path.length));
  if (!isWithin(mount.root, target)) return {};
  const stats = statOf(target);
  if (stats?.isDirectory()) {
    if (!path.endsWith('/')) return { moved: true };
    const index = join(target, 'index.html');
    return statOf(index)?.isFile() ? { file: index, mount } : {};
  }
  return stats?.isFile() && !path.endsWith('/') ? { file: target, mount } : {};
}

function etagOf(body) {
  return `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
}

function checkPrefix(prefix) {
  if (!prefix.startsWith('/') || !prefix.endsWith('/')) {
    throw new Error(`The prefix ${prefix} must start and end with a slash, as in /cosmic-assault/`);
  }
}

/**
 * Serves `mounts` (each `dir`, inside game/, at `prefix + at`) on `localhost:port` (0 picks a free port).
 * `setMounts` swaps what is served; `rewrite(path, from, to)` replaces the literal `from` in the file the site path
 * `path` names, until the server closes.
 */
export async function createPagesServer({ prefix = '/', port = 0, mounts }) {
  checkPrefix(prefix);
  let placed = placeMounts(prefix, mounts);
  const rewrites = new Map();

  const bodyOf = (file) => {
    const changes = rewrites.get(file);
    if (changes === undefined) return readFileSync(file);
    return Buffer.from(changes.reduce((text, [from, to]) => text.replaceAll(from, to), readFileSync(file, 'utf8')));
  };

  const answer = (request) => {
    const url = new URL(request.url ?? '/', 'http://pages');
    const { file, mount, moved } = locate(placed, url.pathname);
    if (file !== undefined) {
      return { status: 200, type: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', body: bodyOf(file), cacheControl: mount.cacheControl };
    }
    if (moved) return { status: 301, type: CONTENT_TYPES['.html'], body: Buffer.from(MOVED_BODY), location: `${url.pathname}/${url.search}` };
    return { status: 404, type: CONTENT_TYPES['.html'], body: Buffer.from(NOT_FOUND_BODY) };
  };

  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-cache' }).end();
      return;
    }
    const { status, type, body, location, cacheControl = 'no-cache' } = answer(request);
    const etag = etagOf(body);
    const headers = { 'Cache-Control': cacheControl, ETag: etag, ...(location === undefined ? {} : { Location: location }) };
    if (status === 200 && request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers).end();
      return;
    }
    response.writeHead(status, { ...headers, 'Content-Type': type, 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, 'localhost', done);
  });

  return {
    url: `http://localhost:${String(server.address().port)}${prefix}`,
    setMounts(next) {
      placed = placeMounts(prefix, next);
    },
    rewrite(path, from, to) {
      const { file } = locate(placed, sitePath(prefix, path));
      if (file === undefined) throw new Error(`Nothing is served at ${path}; rewrite a file the current mounts serve`);
      if (!readFileSync(file, 'utf8').includes(from)) throw new Error(`${file} does not contain ${from}; rewrite a literal the file holds`);
      rewrites.set(file, [...(rewrites.get(file) ?? []), [from, to]]);
    },
    close() {
      return new Promise((done) => {
        server.close(() => {
          done();
        });
        server.closeAllConnections();
      });
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, prefix: { type: 'string', default: '/' }, port: { type: 'string', default: '0' } } });
  if (values.dir === undefined) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    const server = await createPagesServer({ prefix: values.prefix, port: Number(values.port), mounts: [{ dir: values.dir, at: './' }] });
    console.log(`Serving ${values.dir} as GitHub Pages would, at ${server.url}`);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    process.exit(1);
  }
}
