import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDir, filesIn } from './build-dir.mjs';

// Usage: check-no-bridge.mjs [dist]         fails if the release build carries any e2e-only code;
//        check-no-bridge.mjs --e2e [dist-e2e] fails if the e2e build lacks a mark, which would blind the first check.
const MARKS = [
  { text: '__COSMIC_ASSAULT_TEST_API__', what: 'the e2e test bridge', owner: 'src/main.ts' },
  { text: '__E2E_QUERY__', what: 'the e2e ?seed=, ?lives=, ?quality=, ?galaxy=, ?storm= and ?today= parsing', owner: 'src/app/seed.ts' },
  { text: 'e2eBeforeFrame', what: 'the e2e frame hook', owner: 'src/app/game.ts' },
  { text: 'e2eFastForward', what: 'the e2e fast-forward hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eDamageBoss', what: 'the e2e boss-damage hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eGrantPickup', what: 'the e2e pickup-grant hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eEvents', what: 'the e2e event-tally hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eRestartFrameStats', what: 'the e2e frame-stats-restart hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eSpriteCache', what: 'the e2e sprite-cache hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eAttractNow', what: 'the e2e attract-now hook', owner: 'src/app/e2eHooks.ts' },
  { text: 'e2eAttractState', what: 'the e2e attract-state hook', owner: 'src/app/e2eHooks.ts' },
];

const e2e = process.argv[2] === '--e2e';
const dir = buildDir(process.argv[e2e ? 3 : 2], e2e ? { fallback: 'dist-e2e', buildScript: 'build:e2e' } : {});

const files = filesIn(dir)
  .map((file) => join(dir, file))
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
console.log(`e2e bridge, query parsing and the frame, fast-forward, boss-damage, pickup-grant, event-tally, frame-stats-restart, sprite-cache, attract-now and attract-state hooks ${e2e ? 'present' : 'absent'}`);
