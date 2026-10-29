import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflowPath = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)),
);
const repoRoot = resolve(dirname(workflowPath), '..', '..');
const lines = readFileSync(workflowPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => (line.trim().startsWith('#') ? '' : line.trimEnd()));

/** The lines of `within` under its `header` line, up to the next line `end` matches; undefined with no such header. */
function block(header, end, within = lines) {
  const start = within.indexOf(header);
  if (start === -1) return undefined;
  const stop = within.findIndex((line, i) => i > start && end.test(line));
  return within.slice(start + 1, stop === -1 ? undefined : stop);
}
/** The lines of `within` under its `header` line, up to the next one indented no deeper than the header. */
const nested = (header, within) => block(header, new RegExp(`^ {0,${String(header.search(/\S/))}}\\S`), within);

const jobBlock = (id) => block(`  ${id}:`, /^ {0,2}\S/);
/** The lines under top-level `key:`, blank ones left out. */
const topBlock = (key) => (block(`${key}:`, /^\S/) ?? []).filter((line) => line !== '');

const jobs = Object.fromEntries(['game', 'perf', 'balance-dimension', 'balance', 'deploy'].map((id) => [id, jobBlock(id)]));
const hasJobKey = (id, entry) => jobs[id]?.includes(`    ${entry}`) ?? false;
const anyLine = (id, test) => jobs[id]?.some((line) => test(line.trim())) ?? false;
const hasLine = (id, entry) => anyLine(id, (line) => line === entry);
const lineIndex = (id, entry) => jobs[id]?.findIndex((line) => line.trim() === entry) ?? -1;
/** A job's steps, each its lines with the leading `- ` turned to spaces, blank lines left out. */
const stepsOf = (id) => {
  const steps = [];
  for (const line of (nested('    steps:', jobs[id] ?? []) ?? []).filter((l) => l !== '')) {
    if (line.startsWith('      - ')) steps.push([`        ${line.slice(8)}`]);
    else steps.at(-1)?.push(line);
  }
  return steps;
};
/** What a step does: its `run:` line, or its `uses:` line without the version, which Dependabot moves. */
const stepAction = (step) => step.map((line) => line.trim()).find((line) => /^(run|uses):/.test(line))?.replace(/^(uses: [^@]+)@.*$/, '$1');
/** A step's `with:` inputs, trimmed and joined in sorted order. */
const stepInputs = (step) => (nested('        with:', step) ?? []).map((line) => line.trim()).sort().join(', ');
/** True when job `id` has a step that `uses:` `action` with exactly the `with:` inputs `inputs` (in any order). */
const hasStep = (id, action, inputs) =>
  stepsOf(id).some((step) => stepAction(step) === `uses: ${action}` && stepInputs(step) === [...inputs].sort().join(', '));
/** True when either step is absent (the presence checks report that) or `first` comes before `second`. */
const inOrder = (id, first, second) => {
  const [a, b] = [lineIndex(id, `run: ${first}`), lineIndex(id, `run: ${second}`)];
  return a === -1 || b === -1 || a < b;
};

/** The balance suite's shards, each a Vitest file filter and its job's label: one per Dimension, then the Daily's. */
const DIMENSIONS = [1, 2, 3, 4, 5];
const DAILY_SHARD = 'daily';
const SHARDS = [...DIMENSIONS.map((d) => ({ filter: `d${String(d)}-`, label: `Dimension ${String(d)}` })), { filter: DAILY_SHARD, label: 'Daily' }];
const BALANCE_SHARD = '${{ matrix.shard }}';
const MATRIX_ENTRIES = SHARDS.map(({ filter, label }) => `- { shard: ${filter}, label: ${label} }`);

const problems = Object.entries(jobs)
  .filter(([, block]) => block === undefined)
  .map(([id]) => `ci.yml: missing job ${id}:; add a top-level job with id ${id} under jobs:`);

const DEPLOY_IF = "if: github.event_name == 'push' && github.ref == 'refs/heads/main'";
/** The ruleset requires the game job by this name, so it must never change. */
const GAME_NAME = 'name: Game (lint, typecheck, unit, build, e2e)';
const SITE = '_site';
const SITE_CHECKS = ['check-base', 'check-no-bridge', 'check-pages'].map((script) => `run: node game/scripts/${script}.mjs ${SITE}`);
/** What deploy does, in order: the game build the game job checked, checked again where it lands, and published. */
const DEPLOY_STEPS = [
  'uses: actions/checkout',
  'uses: actions/setup-node',
  'uses: actions/download-artifact',
  ...SITE_CHECKS,
  'uses: actions/configure-pages',
  'uses: actions/upload-pages-artifact',
  'uses: actions/deploy-pages',
];
const deployActions = stepsOf('deploy').map(stepAction).join('; ');
const DEPLOY_PERMISSIONS = ['contents: read', 'pages: write', 'id-token: write'].join(', ');
const deployPermissions = (nested('    permissions:', jobs.deploy ?? []) ?? []).map((line) => line.trim()).join(', ');
/** A job's own `if:` lines, at job level. */
const jobIfs = (id) => jobs[id]?.filter((line) => line.startsWith('    if:')) ?? [];

const checks = [
  [topBlock('permissions').join('\n') === '  contents: read',
    'ci.yml: top-level permissions must be exactly contents: read; give a job that needs more its own permissions block, as deploy has'],
  [!lines.some((line) => line.includes('pull_request_target')),
    'ci.yml: pull_request_target is not allowed: it runs fork pull requests with the repository\'s token and secrets; trigger on pull_request instead'],
  [jobIfs('deploy').length === 1,
    `ci.yml: deploy's only job-level if: must be ${DEPLOY_IF}; remove any other`],
  ...['game', 'perf'].map((id) => [jobIfs(id).length === 0,
    `ci.yml: ${id} must have no job-level if:, since deploy needs it and a skipped need skips deploy silently; move the condition to its steps`]),
  [hasJobKey('deploy', 'needs: [game, perf]'),
    'ci.yml: deploy must declare needs: [game, perf] (job level) so it only publishes a build whose tests, site checks and frame-time ceilings passed, and never waits for the report-only balance jobs'],
  [hasJobKey('deploy', DEPLOY_IF),
    `ci.yml: deploy must declare ${DEPLOY_IF} (job level) so only pushes to main publish`],
  [deployActions === DEPLOY_STEPS.join('; '),
    `ci.yml: deploy's steps must be exactly, in order: ${DEPLOY_STEPS.join('; ')} (found: ${deployActions}); restore them, so the site is the downloaded game build, checked where it lands before it is uploaded, and no step copies, makes or moves anything into ${SITE}`],
  [hasStep('deploy', 'actions/download-artifact', ['name: game-dist', `path: ${SITE}`]),
    `ci.yml: deploy's Download game build step must take exactly name: game-dist and path: ${SITE}, so the site is the game job's release build, unpacked at the site root; restore those inputs and remove any other`],
  [hasStep('deploy', 'actions/upload-pages-artifact', [`path: ${SITE}`]),
    `ci.yml: deploy's Upload Pages artifact step must take exactly path: ${SITE}, the checked download, and nothing else; restore it`],
  [deployPermissions === DEPLOY_PERMISSIONS,
    `ci.yml: deploy's permissions must be exactly ${DEPLOY_PERMISSIONS}, what publishing to Pages needs and no more; restore them`],
  [!stepsOf('deploy').some((step) => step.some((line) => line.startsWith('        if:'))),
    'ci.yml: deploy must have no step-level if:, since a skipped check would let an unchecked site publish; remove it'],
  [hasJobKey('game', GAME_NAME),
    `ci.yml: the game job's name: must be exactly "${GAME_NAME.slice('name: '.length)}", the check the main branch's ruleset requires; a renamed check never reports and blocks every merge, so restore it`],
  [hasStep('game', 'actions/upload-artifact', ['name: game-dist', 'path: game/dist/', 'if-no-files-found: error']),
    'ci.yml: the game job must upload game/dist/ as the game-dist artifact (name: game-dist, path: game/dist/, if-no-files-found: error), the release build its checks passed, which deploy publishes; restore that step'],
  ...['game', 'perf', 'balance-dimension', 'deploy'].map((id) => [hasLine(id, 'node-version-file: .nvmrc'),
    `ci.yml: ${id} must set up Node with node-version-file: .nvmrc; do not hard-code a Node version`]),
  [!['game', 'perf', 'deploy'].some((id) => anyLine(id, (line) => line.includes('continue-on-error:'))),
    'ci.yml: continue-on-error is not allowed in the game, perf and deploy jobs; a failing test or site check must block deploy — remove it'],
  ...[
    ['npm test', 'tests gate deploy'],
    ['npm run test:digests', 'the expert D1–D2 digests gate merges, not only the non-required balance report'],
    ['npm run check:base', 'a release build loading assets from the host root cannot ship'],
    ['npm run check:no-bridge', 'a release build carrying the test bridge cannot ship'],
    ['npm run check:pages', 'a release build not laid out as the site cannot ship'],
    ['npm run build:e2e', 'the e2e tests have an e2e build to drive'],
    ['npm run test:e2e', 'tests gate deploy'],
  ].map(([cmd, reason]) => [hasLine('game', `run: ${cmd}`),
    `ci.yml: the game job must run "${cmd}"; restore the step so ${reason}`]),
  [inOrder('game', 'npm run build:e2e', 'npm run test:e2e'),
    'ci.yml: in the game job, npm run build:e2e must come before npm run test:e2e; move the build:e2e step above the e2e tests so they drive a fresh e2e build'],
  ...['npm run check:base', 'npm run check:no-bridge', 'npm run check:pages'].map((cmd) => [inOrder('game', 'npm run build', cmd),
    `ci.yml: in the game job, ${cmd} must come after npm run build; move it below the release build step so it scans the fresh dist/`]),
  ...[
    ['npm run build', 'Playwright has the release build it serves beside the e2e one'],
    ['npm run build:e2e', 'the perf spec has an e2e build to drive'],
    ['npm run test:perf', 'a frame-time regression blocks deploy'],
  ].map(([cmd, reason]) => [hasLine('perf', `run: ${cmd}`),
    `ci.yml: the perf job must run "${cmd}"; restore the step so ${reason}`]),
  [inOrder('perf', 'npm run build:e2e', 'npm run test:perf'),
    'ci.yml: in the perf job, npm run build:e2e must come before npm run test:perf; move the build:e2e step above it so it drives a fresh e2e build'],
  [hasLine('balance-dimension', `run: npm run test:balance -- ${BALANCE_SHARD}`),
    `ci.yml: the balance-dimension job must run "npm run test:balance -- ${BALANCE_SHARD}"; restore the step so each shard's bot kill and clear rates are reported`],
  [(jobs['balance-dimension'] ?? []).map((line) => line.trim()).filter((line) => line.startsWith('- { shard:')).join('\n') === MATRIX_ENTRIES.join('\n'),
    `ci.yml: the balance-dimension job's matrix must include exactly ${MATRIX_ENTRIES.join(', ')}, in that order: one shard per Dimension and one for the Daily; restore every shard`],
  [!anyLine('balance-dimension', (line) => line.includes('continue-on-error:')),
    'ci.yml: continue-on-error is not allowed in the balance-dimension job; a failed shard would read as passed to the balance roll-up — remove it'],
  [hasLine('balance-dimension', 'fail-fast: false'),
    "ci.yml: the balance-dimension job's strategy must set fail-fast: false, so one failing shard does not cancel the others and lose their rates; restore it"],
  [hasLine('balance-dimension', 'include:') && !anyLine('balance-dimension', (line) => line.startsWith('exclude:')),
    "ci.yml: the balance-dimension job's matrix must list its shards under include:, not exclude:, which would run none of them as shards; restore include:"],
  [hasJobKey('balance', 'needs: [balance-dimension]'),
    'ci.yml: balance must declare needs: [balance-dimension] (job level), so the one check the ruleset sees waits for every shard'],
  [hasJobKey('balance', 'if: always()'),
    'ci.yml: balance must declare if: always() (job level), so a failed shard fails the check rather than skipping it'],
  [hasLine('balance', 'SHARDS: ${{ needs.balance-dimension.result }}') && hasLine('balance', 'run: test "$SHARDS" = success'),
    'ci.yml: balance must pass only when every shard did: set SHARDS: ${{ needs.balance-dimension.result }} and run: test "$SHARDS" = success'],
];
problems.push(...checks.filter(([ok]) => !ok).map(([, message]) => message));

const balanceDir = resolve(repoRoot, 'game', 'tests', 'balance');
// Every file under tests/balance/, nested ones included, as the balance config's tests/balance/**/*.test.ts finds them.
const balanceFiles = existsSync(balanceDir) ? readdirSync(balanceDir, { recursive: true }).map((path) => path.split(sep).join('/')) : [];
problems.push(...DIMENSIONS.filter((d) => !balanceFiles.includes(`d${String(d)}-targets.test.ts`)).map((d) =>
  `game/tests/balance/d${String(d)}-targets.test.ts is missing, so the Dimension ${String(d)} balance shard pins no targets; restore it`));
// A shard runs the files `npm run test:balance -- <filter>` picks: Vitest keeps a file when its path from game/ holds the
// filter anywhere, ignoring case. So a file must hold exactly one shard's filter, or it runs in none or in several.
const shardsOf = (file) => SHARDS.filter(({ filter }) => `tests/balance/${file}`.toLowerCase().includes(filter.toLowerCase())).map(({ filter }) => filter);
const testFiles = balanceFiles.filter((file) => file.endsWith('.test.ts'));
if (!testFiles.some((file) => shardsOf(file).includes(DAILY_SHARD))) {
  problems.push(`game/tests/balance/ holds no test file the ${DAILY_SHARD} shard picks, so it plays no Daily; restore daily.test.ts`);
}
problems.push(...testFiles.filter((file) => shardsOf(file).length === 0).map((file) =>
  `game/tests/balance/${file} runs in no balance shard, since each shard runs only the files whose path holds its filter; give it the d<N>- prefix of the Dimension it plays, N from ${String(DIMENSIONS[0])} to ${String(DIMENSIONS.at(-1))}, or the ${DAILY_SHARD} prefix if it plays the Daily`));
problems.push(...testFiles.filter((file) => shardsOf(file).length > 1).map((file) =>
  `game/tests/balance/${file} runs in the ${shardsOf(file).join(' and ')} shards, since Vitest picks a file by any part of its path; rename it so its path holds only one shard's filter`));

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log('workflow ok');
