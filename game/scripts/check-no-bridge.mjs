import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Usage: check-no-bridge.mjs [dist]         fails if the release build carries any e2e-only code;
//        check-no-bridge.mjs --e2e [dist-e2e] fails if the e2e build lacks a mark, which would blind the first check.
const MARKS = [
  { text: '__COSMIC_ASSAULT_TEST_API__', what: 'the e2e test bridge', owner: 'src/main.ts' },
  { text: '__E2E_QUERY__', what: 'the e2e ?seed=, ?lives=, ?quality= and ?galaxy= parsing', owner: 'src/app/seed.ts' },
  { text: 'e2eBeforeFrame', what: 'the e2e frame hook', owner: 'src/app/game.ts' },
  { text: 'e2eFastForward', what: 'the e2e fast-forward hook', owner: 'src/app/game.ts' },
];

const e2e = process.argv[2] === '--e2e';
const [defaultDir, buildScript] = e2e ? ['../dist-e2e', 'build:e2e'] : ['../dist', 'build'];
const dir = resolve(process.argv[e2e ? 3 : 2] ?? fileURLToPath(new URL(defaultDir, import.meta.url)));

if (!existsSync(dir)) {
  console.error(`${dir} does not exist; run npm run ${buildScript} first`);
  process.exit(1);
}

const files = readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .map((path) => ({ path, text: readFileSync(path, 'latin1') }));

const problems = MARKS.flatMap(({ text, what, owner }) => {
  const carriers = files.filter((file) => file.text.includes(text)).map((file) => `  ${file.path}`);
  if (e2e) {
    return carriers.length > 0 ? []
      : [`e2e build ${dir} lacks ${what} (${text}); the release check scans for that mark, so keep it in ${owner} or update scripts/check-no-bridge.mjs`];
  }
  return carriers.length === 0 ? []
    : [`release build ${dir} contains ${what}; release builds must not — check the import.meta.env.MODE guard in ${owner}`, ...carriers];
});

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`e2e bridge, query parsing, frame hook and fast-forward ${e2e ? 'present' : 'absent'}`);
