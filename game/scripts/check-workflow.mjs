import { readdirSync, readFileSync } from 'node:fs';
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

const jobs = Object.fromEntries(['game', 'legacy', 'deploy'].map((id) => [id, jobBlock(id)]));
const hasJobKey = (id, entry) => jobs[id]?.includes(`    ${entry}`) ?? false;
const anyLine = (id, test) => jobs[id]?.some((line) => test(line.trim())) ?? false;
const hasLine = (id, entry) => anyLine(id, (line) => line === entry);

const problems = Object.entries(jobs)
  .filter(([, block]) => block === undefined)
  .map(([id]) => `ci.yml: missing job ${id}:; add a top-level job with id ${id} under jobs:`);

const checks = [
  [hasJobKey('deploy', 'needs: [game, legacy]'),
    'ci.yml: deploy must declare needs: [game, legacy] (job level) so it only runs after both test jobs pass'],
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
  ...['npm test', 'npm run test:e2e'].map((cmd) => [hasLine('game', `run: ${cmd}`),
    `ci.yml: the game job must run "${cmd}"; restore the step so tests gate deploy`]),
  [anyLine('legacy', (line) => line.startsWith('run: npx playwright test')),
    'ci.yml: the legacy job must run the Playwright suite (npx playwright test …); restore the step'],
];
problems.push(...checks.filter(([ok]) => !ok).map(([, message]) => message));

const nextPaths = readdirSync(resolve(repoRoot, 'website'), { recursive: true })
  .filter((path) => basename(path) === 'next');
problems.push(...nextPaths.map((path) =>
  `website/${path} is named "next" and is excluded by the deploy diff (diff -r … --exclude next); rename it`));

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log('workflow ok');
