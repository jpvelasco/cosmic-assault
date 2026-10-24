import { readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/ci.yml';
const lines = readFileSync(new URL(`../../${workflowPath}`, import.meta.url), 'utf8').split('\n');

function jobBlock(id) {
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, i) => i > start && /^ {0,2}\S/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

const jobs = Object.fromEntries(['game', 'legacy', 'deploy'].map((id) => [id, jobBlock(id)]));
const has = (id, marker) => jobs[id]?.includes(marker) ?? false;

const problems = Object.entries(jobs)
  .filter(([, block]) => block === undefined)
  .map(([id]) => `ci.yml: missing job ${id}:; add a top-level job with id ${id} under jobs:`);

const checks = [
  [has('deploy', 'needs: [game, legacy]'),
    'ci.yml: deploy must declare needs: [game, legacy] so it only runs after both test jobs pass'],
  [has('deploy', "if: github.event_name == 'push' && github.ref == 'refs/heads/main'"),
    "ci.yml: deploy must declare if: github.event_name == 'push' && github.ref == 'refs/heads/main' so only pushes to main publish"],
  [has('deploy', 'diff -r website _site --exclude next'),
    'ci.yml: deploy must run diff -r website _site --exclude next to prove the site root is the unchanged website/'],
  [has('game', 'node-version-file: .nvmrc'),
    'ci.yml: game must set up Node with node-version-file: .nvmrc; do not hard-code a Node version'],
  [has('legacy', 'node-version-file: .nvmrc'),
    'ci.yml: legacy must set up Node with node-version-file: .nvmrc; do not hard-code a Node version'],
];
problems.push(...checks.filter(([ok]) => !ok).map(([, message]) => message));

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log('workflow ok');
