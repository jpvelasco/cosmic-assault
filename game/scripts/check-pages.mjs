import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Script } from 'node:vm';
import { buildDir, filesIn } from './site.mjs';

// Usage: check-pages.mjs [dist]
//
// Fails unless the build in [dist] (game/dist by default) is laid out as the site to publish: the game, its worker and
// its manifest at the root; at next/, the page that sends old preview links to the game and the worker that retires the
// preview, and nothing else; both workers classic scripts; no URL that ties the site to one path; and nothing of the
// classic site.

const ROOT_FILES = [
  { file: 'index.html', owner: 'index.html' },
  { file: 'sw.js', owner: 'src/sw/worker.ts, built by vite/precache.ts' },
  { file: 'manifest.webmanifest', owner: 'public/manifest.webmanifest' },
];
const RETIRED_FILES = [
  { file: 'next/index.html', owner: 'public/next/index.html, the page that sends old preview links to the game' },
  { file: 'next/sw.js', owner: 'precachePlugin() in vite.config.ts building src/sw/retire.ts into next/sw.js, the worker that retires the preview' },
];
const WORKERS = ['sw.js', 'next/sw.js'];
const CLASSIC_FILES = ['game-modular.js', 'modules', 'style.css'];
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2']);
const PROJECT_PATH = '/cosmic-assault/';
const RETIRED_PATH = '/next/';
/** A character that can sit in a URL next to a path, so the run of them before `/next/` is the rest of that URL. */
const URL_CHAR = /[\w.~%!$&*+:@/-]/;
/** The start of an address with a scheme, as in https: or data:. */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
/** Where the manifest sits, standing in for any address the site is published at. */
const SITE = 'https://site.invalid/site/';

const PASSED = 'site layout ok: the game at the root, only the moved page and the retiring worker in next/, and relative URLs throughout';

const dir = buildDir(process.argv[2]);
const files = filesIn(dir);
const has = (file) => files.includes(file);

function missingFiles() {
  return [
    ...ROOT_FILES.filter(({ file }) => !has(file)).map(({ file, owner }) => `${dir} has no ${file} at its root; publish the whole release build, which takes it from ${owner}`),
    ...RETIRED_FILES.filter(({ file }) => !has(file)).map(({ file, owner }) => `${dir} has no ${file}; keep ${owner}`),
  ];
}

function extraRetiredFiles() {
  const retired = new Set(RETIRED_FILES.map(({ file }) => file));
  return files
    .filter((file) => file.startsWith('next/') && !retired.has(file))
    .map((file) => `${dir} has ${file}, but next/ holds only the moved page and the retiring worker; remove it from public/next/ or from the build`);
}

function nonClassicWorkers() {
  return WORKERS.filter(has).flatMap((file) => {
    const path = join(dir, file);
    try {
      new Script(readFileSync(path, 'utf8'), { filename: path });
      return [];
    } catch (error) {
      return [`${path} is not a classic script (${error.message}); the page registers it without type: 'module', so build it with no import or export (see vite/precache.ts)`];
    }
  });
}

/** Each URL in `text` that leads to next/ from the host's root or from another host, rather than relatively. */
function absoluteRetiredUrls(text) {
  const urls = new Set();
  for (let at = text.indexOf(RETIRED_PATH); at !== -1; at = text.indexOf(RETIRED_PATH, at + 1)) {
    let start = at;
    while (start > 0 && URL_CHAR.test(text[start - 1])) start -= 1;
    const before = text.slice(start, at);
    if (before === '' || before.startsWith('/') || SCHEME.test(before)) urls.add(text.slice(start, at + RETIRED_PATH.length));
  }
  return [...urls];
}

function pathBoundUrls() {
  return files
    .filter((file) => !BINARY_EXTENSIONS.has(extname(file)))
    .flatMap((file) => {
      const path = join(dir, file);
      const text = readFileSync(path, 'utf8');
      return [
        ...(text.includes(PROJECT_PATH) ? [`${path} names ${PROJECT_PATH}; the site must work at any path, so make the URL relative`] : []),
        ...absoluteRetiredUrls(text).map(
          (url) => `${path} has an absolute URL to next/ (${url}); make it relative, as in next/ from the root or ../ from inside next/, so the site works at any path`,
        ),
      ];
    });
}

/** True for a URL written relative to the manifest that stays inside the site. */
function isOnSite(value) {
  if (typeof value !== 'string' || SCHEME.test(value) || /^[/\\]/.test(value)) return false;
  return new URL(value, SITE).href.startsWith(SITE);
}

function manifestProblems() {
  if (!has('manifest.webmanifest')) return [];
  const path = join(dir, 'manifest.webmanifest');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return [`${path} is not valid JSON (${error.message}); fix public/manifest.webmanifest`];
  }
  const leaves = (what, value, example) => `manifest.webmanifest ${what} is ${JSON.stringify(value)}, which is absolute or leaves the site; make it relative to the manifest, such as ${example}`;
  const problems = ['start_url', 'scope'].filter((key) => !isOnSite(manifest[key])).map((key) => leaves(key, manifest[key], './'));
  if ('id' in manifest) {
    problems.push("manifest.webmanifest has an id; leave it out so an installed app's identity follows start_url (a relative id resolves against the origin, not the site's path)");
  }
  for (const { src } of Array.isArray(manifest.icons) ? manifest.icons : []) {
    if (!isOnSite(src)) {
      problems.push(leaves('icon src', src, 'icons/icon-192.png'));
      continue;
    }
    if (!has(decodeURIComponent(new URL(src, SITE).pathname.slice(new URL(SITE).pathname.length)))) {
      problems.push(`manifest.webmanifest lists the icon ${src}, which the site lacks; add it to public/icons/ or correct the src`);
    }
  }
  return problems;
}

function classicFiles() {
  return CLASSIC_FILES.filter((name) => existsSync(join(dir, name))).map(
    (name) => `${dir} has ${name} from the classic site; publish the game build alone, without copying the classic site into it`,
  );
}

const problems = [...missingFiles(), ...extraRetiredFiles(), ...nonClassicWorkers(), ...pathBoundUrls(), ...manifestProblems(), ...classicFiles()];
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(PASSED);
