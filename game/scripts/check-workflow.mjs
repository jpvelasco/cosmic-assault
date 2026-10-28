import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflowPath = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)),
);
const repoRoot = resolve(dirname(workflowPath), '..', '..');
const lines = readFileSync(workflowPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => (line.trim().startsWith('#') ? '' : line.trimEnd()));

function jobBlock(id) {
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, i) => i > start && /^ {0,2}\S/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

const jobs = Object.fromEntries(['game', 'legacy', 'balance-dimension', 'balance', 'deploy'].map((id) => [id, jobBlock(id)]));
const hasJobKey = (id, entry) => jobs[id]?.includes(`    ${entry}`) ?? false;
const anyLine = (id, test) => jobs[id]?.some((line) => test(line.trim())) ?? false;
const hasLine = (id, entry) => anyLine(id, (line) => line === entry);
const lineIndex = (id, entry) => jobs[id]?.findIndex((line) => line.trim() === entry) ?? -1;
/** True when either step is absent (the presence checks report that) or `first` comes before `second`. */
const inOrder = (id, first, second) => {
  const [a, b] = [lineIndex(id, `run: ${first}`), lineIndex(id, `run: ${second}`)];
  return a === -1 || b === -1 || a < b;
};

/** The balance suite's shards: one per Dimension, each running its d<N>-*.test.ts files. */
const DIMENSIONS = [1, 2, 3, 4, 5];
const BALANCE_SHARD = 'd${{ matrix.dimension }}-';

const problems = Object.entries(jobs)
  .filter(([, block]) => block === undefined)
  .map(([id]) => `ci.yml: missing job ${id}:; add a top-level job with id ${id} under jobs:`);

const checks = [
  [hasJobKey('deploy', 'needs: [game, legacy]'),
    'ci.yml: deploy must declare needs: [game, legacy] (job level) so it only runs after both test jobs pass, and never waits for the non-required balance or perf jobs'],
  [hasJobKey('deploy', "if: github.event_name == 'push' && github.ref == 'refs/heads/main'"),
    "ci.yml: deploy must declare if: github.event_name == 'push' && github.ref == 'refs/heads/main' (job level) so only pushes to main publish"],
  [hasLine('deploy', 'run: diff -r website _site --exclude next'),
    'ci.yml: deploy must run diff -r website _site --exclude next to prove the site root is the unchanged website/'],
  [hasLine('game', 'node-version-file: .nvmrc'),
    'ci.yml: game must set up Node with node-version-file: .nvmrc; do not hard-code a Node version'],
  [hasLine('legacy', 'node-version-file: .nvmrc'),
    'ci.yml: legacy must set up Node with node-version-file: .nvmrc; do not hard-code a Node version'],
  [!['game', 'legacy'].some((id) => anyLine(id, (line) => line.includes('continue-on-error:'))),
    'ci.yml: continue-on-error is not allowed in the game/legacy jobs; a failing test must block deploy — remove it'],
  ...[
    ['npm test', 'tests gate deploy'],
    ['npm run test:digests', 'the expert D1–D2 digests gate merges, not only the non-required balance report'],
    ['npm run check:no-bridge', 'a release build carrying the test bridge cannot ship'],
    ['npm run build:e2e', 'the e2e tests have an e2e build to drive'],
    ['npm run test:e2e', 'tests gate deploy'],
  ].map(([cmd, reason]) => [hasLine('game', `run: ${cmd}`),
    `ci.yml: the game job must run "${cmd}"; restore the step so ${reason}`]),
  [inOrder('game', 'npm run build:e2e', 'npm run test:e2e'),
    'ci.yml: in the game job, npm run build:e2e must come before npm run test:e2e; move the build:e2e step above the e2e tests so they drive a fresh e2e build'],
  [inOrder('game', 'npm run build', 'npm run check:no-bridge'),
    'ci.yml: in the game job, npm run check:no-bridge must come after npm run build; move it below the release build step so it scans the fresh dist/'],
  [anyLine('legacy', (line) => line.startsWith('run: npx playwright test')),
    'ci.yml: the legacy job must run the Playwright suite (npx playwright test …); restore the step'],
  [hasLine('balance-dimension', `run: npm run test:balance -- ${BALANCE_SHARD}`),
    `ci.yml: the balance-dimension job must run "npm run test:balance -- ${BALANCE_SHARD}"; restore the step so each Dimension's bot kill and clear rates are reported`],
  [hasLine('balance-dimension', `dimension: [${DIMENSIONS.join(', ')}]`),
    `ci.yml: the balance-dimension job must run a matrix of dimension: [${DIMENSIONS.join(', ')}], one shard per Dimension; restore every Dimension`],
  [hasLine('balance-dimension', 'node-version-file: .nvmrc'),
    'ci.yml: balance-dimension must set up Node with node-version-file: .nvmrc; do not hard-code a Node version'],
  [hasJobKey('balance', 'needs: [balance-dimension]'),
    'ci.yml: balance must declare needs: [balance-dimension] (job level), so the one check the ruleset sees waits for every shard'],
  [hasJobKey('balance', 'if: always()'),
    'ci.yml: balance must declare if: always() (job level), so a failed shard fails the check rather than skipping it'],
  [hasLine('balance', 'SHARDS: ${{ needs.balance-dimension.result }}') && hasLine('balance', 'run: test "$SHARDS" = success'),
    'ci.yml: balance must pass only when every shard did: set SHARDS: ${{ needs.balance-dimension.result }} and run: test "$SHARDS" = success'],
];
problems.push(...checks.filter(([ok]) => !ok).map(([, message]) => message));

const balanceDir = resolve(repoRoot, 'game', 'tests', 'balance');
const balanceFiles = existsSync(balanceDir) ? readdirSync(balanceDir) : [];
problems.push(...DIMENSIONS.filter((d) => !balanceFiles.includes(`d${String(d)}-targets.test.ts`)).map((d) =>
  `game/tests/balance/d${String(d)}-targets.test.ts is missing, so the Dimension ${String(d)} balance shard pins no targets; restore it`));
const shardPrefix = new RegExp(`^d[${DIMENSIONS.join('')}]-`);
problems.push(...balanceFiles.filter((file) => file.endsWith('.test.ts') && !shardPrefix.test(file)).map((file) =>
  `game/tests/balance/${file} runs in no balance shard, since each shard runs only its d<N>- files; give it the d<N>- prefix of the Dimension it plays, N from ${String(DIMENSIONS[0])} to ${String(DIMENSIONS.at(-1))}`));

const nextPaths = readdirSync(resolve(repoRoot, 'website'), { recursive: true })
  .filter((path) => basename(path) === 'next');
problems.push(...nextPaths.map((path) =>
  `website/${path} is named "next" and is excluded by the deploy diff (diff -r … --exclude next); rename it`));

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log('workflow ok');
