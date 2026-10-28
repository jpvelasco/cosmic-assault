import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameDir, guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-workflow.mjs', 'check-workflow-');
const realWorkflow = join(gameDir, '..', '.github', 'workflows', 'ci.yml');
const realText = readFileSync(realWorkflow, 'utf8');

/** Every Dimension's balance targets file, as the balance shards expect them. */
const TARGET_FILES = [1, 2, 3, 4, 5].map((d) => `d${String(d)}-targets.test.ts`);

/**
 * Lays out <tmp>/.github/workflows/ci.yml, <tmp>/website/ and <tmp>/game/tests/balance/ with `balanceFiles` in it,
 * returning the workflow path.
 */
function writeFixture(text: string, websiteDirs: string[] = [], balanceFiles: string[] = TARGET_FILES): string {
  const root = tempRoot();
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'game', 'tests', 'balance'), { recursive: true });
  for (const file of balanceFiles) writeFileSync(join(root, 'game', 'tests', 'balance', file), '');
  mkdirSync(join(root, 'website'));
  for (const dir of websiteDirs) mkdirSync(join(root, 'website', dir), { recursive: true });
  const workflowPath = join(root, '.github', 'workflows', 'ci.yml');
  writeFileSync(workflowPath, text);
  return workflowPath;
}

/** Replaces the first occurrence of `from`; throws so a stale mutation cannot pass silently. */
function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`ci.yml no longer contains ${JSON.stringify(from)}; update this test`);
  return text.replace(from, () => to);
}

/** Moves the first occurrence of `step` to just before the first occurrence of `anchor`. */
const moveBefore = (text: string, step: string, anchor: string) =>
  replaceOnce(replaceOnce(text, step, ''), anchor, `${step}${anchor}`);

const needsLine = '    needs: [game, legacy, perf]\n';
const ifLine = "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n";
const diffLine = '        run: diff -r website _site --exclude next\n';
const nodeVersionLine = '          node-version-file: .nvmrc\n';
const e2eStep = '        run: npm run test:e2e\n';
const unitStep = '        run: npm test\n';
const digestStep = '        run: npm run test:digests\n';
const buildStep = '        run: npm run build\n';
const noBridgeStep = '        run: npm run check:no-bridge\n';
const buildE2eStep = '        run: npm run build:e2e\n';
const legacyRun = '        run: npx playwright test --project=chromium-desktop --reporter=html,list\n';
const balanceStep = '        run: npm run test:balance -- d${{ matrix.dimension }}-\n';
const perfStep = '        run: npm run test:perf\n';
/** The perf job's own steps, from its header to the balance shards' header. */
const perfJob = (t: string) => t.slice(t.indexOf('  perf:\n'), t.indexOf('  balance-dimension:\n'));
/** `t` with `from` replaced by `to` inside the perf job only; throws if the perf job lacks it. */
const inPerf = (t: string, from: string, to: string) => {
  const job = perfJob(t);
  return t.replace(job, () => replaceOnce(job, from, to));
};
const matrixLine = '        dimension: [1, 2, 3, 4, 5]\n';
const rollUpNeeds = '    needs: [balance-dimension]\n';
const rollUpAlways = '    if: always()\n';
const rollUpCheck = '        run: test "$SHARDS" = success\n';
/** The balance shards' own Node setup: the first after the balance-dimension job starts. */
const balanceNode = (t: string) => t.indexOf(nodeVersionLine, t.indexOf('  balance-dimension:\n'));
const comment = (line: string) => `    # ${line.trim()}\n`;

const failingCases: [name: string, mutate: (text: string) => string, message: string, websiteDirs?: string[], balanceFiles?: string[]][] = [
  ['commented-out needs', (t) => replaceOnce(t, needsLine, comment(needsLine)), 'deploy must declare needs: [game, legacy, perf]'],
  [
    'if moved to step level',
    (t) => replaceOnce(replaceOnce(t, ifLine, ''), '      - name: Stage live site\n', `      - name: Stage live site\n    ${ifLine}`),
    "deploy must declare if: github.event_name == 'push'",
  ],
  [
    'removed legacy job',
    (t) => t.slice(0, t.indexOf('  legacy:')) + t.slice(t.indexOf('  deploy:')),
    'missing job legacy:',
  ],
  ['deleted diff line', (t) => replaceOnce(t, diffLine, ''), 'deploy must run diff -r website _site --exclude next'],
  ['game without node-version-file', (t) => replaceOnce(t, nodeVersionLine, ''), 'game must set up Node with node-version-file: .nvmrc'],
  [
    'legacy without node-version-file',
    (t) => t.slice(0, t.lastIndexOf(nodeVersionLine)) + t.slice(t.lastIndexOf(nodeVersionLine) + nodeVersionLine.length),
    'legacy must set up Node with node-version-file: .nvmrc',
  ],
  [
    'continue-on-error in legacy',
    (t) => replaceOnce(t, '  legacy:\n', '  legacy:\n    continue-on-error: true\n'),
    'continue-on-error is not allowed in the game/legacy/perf jobs',
  ],
  [
    'continue-on-error in game step',
    (t) => replaceOnce(t, unitStep, `${unitStep}        continue-on-error: true\n`),
    'continue-on-error is not allowed in the game/legacy/perf jobs',
  ],
  ['deleted unit test step', (t) => replaceOnce(t, unitStep, ''), 'the game job must run "npm test"'],
  ['deleted expert digest step', (t) => replaceOnce(t, digestStep, ''), 'the game job must run "npm run test:digests"'],
  [
    'expert digests moved to the balance job',
    (t) => replaceOnce(replaceOnce(t, digestStep, ''), balanceStep, `${balanceStep}${digestStep}`),
    'the game job must run "npm run test:digests"',
  ],
  [
    'expert digests left to continue on error',
    (t) => replaceOnce(t, digestStep, `${digestStep}        continue-on-error: true\n`),
    'continue-on-error is not allowed in the game/legacy/perf jobs',
  ],
  ['deleted e2e step', (t) => replaceOnce(t, e2eStep, ''), 'the game job must run "npm run test:e2e"'],
  ['deleted no-bridge check', (t) => replaceOnce(t, noBridgeStep, ''), 'the game job must run "npm run check:no-bridge"'],
  ['deleted e2e build', (t) => replaceOnce(t, buildE2eStep, ''), 'the game job must run "npm run build:e2e"'],
  [
    'e2e build after e2e tests',
    (t) => replaceOnce(replaceOnce(t, buildE2eStep, ''), e2eStep, `${e2eStep}${buildE2eStep}`),
    'npm run build:e2e must come before npm run test:e2e',
  ],
  [
    'no-bridge check before release build',
    (t) => moveBefore(t, noBridgeStep, buildStep),
    'npm run check:no-bridge must come after npm run build',
  ],
  ['deleted legacy playwright run', (t) => replaceOnce(t, legacyRun, ''), 'the legacy job must run the Playwright suite'],
  [
    'removed balance job',
    (t) => t.slice(0, t.indexOf('  balance:\n')) + t.slice(t.indexOf('  legacy:\n')),
    'missing job balance:',
  ],
  ['deleted balance run', (t) => replaceOnce(t, balanceStep, ''), 'the balance-dimension job must run "npm run test:balance -- d${{ matrix.dimension }}-"'],
  ['balance shards running the whole suite', (t) => replaceOnce(t, balanceStep, '        run: npm run test:balance\n'), 'the balance-dimension job must run'],
  [
    'balance without node-version-file',
    (t) => t.slice(0, balanceNode(t)) + t.slice(balanceNode(t) + nodeVersionLine.length),
    'balance-dimension must set up Node with node-version-file: .nvmrc',
  ],
  ['a Dimension dropped from the matrix', (t) => replaceOnce(t, matrixLine, '        dimension: [1, 2, 3, 4]\n'), 'must run a matrix of dimension: [1, 2, 3, 4, 5]'],
  [
    'removed balance shards',
    (t) => t.slice(0, t.indexOf('  balance-dimension:\n')) + t.slice(t.indexOf('  balance:\n')),
    'missing job balance-dimension:',
  ],
  ['roll-up not waiting for the shards', (t) => replaceOnce(t, rollUpNeeds, ''), 'balance must declare needs: [balance-dimension]'],
  ['roll-up skipped when a shard fails', (t) => replaceOnce(t, `${rollUpNeeds}${rollUpAlways}`, rollUpNeeds), 'balance must declare if: always()'],
  ['roll-up passing whatever the shards did', (t) => replaceOnce(t, rollUpCheck, '        run: true\n'), 'balance must pass only when every shard did'],
  ['a Dimension without its targets file', (t) => t, 'd3-targets.test.ts is missing', [], TARGET_FILES.filter((f) => !f.startsWith('d3-'))],
  ['a balance test in no Dimension\'s shard', (t) => t, 'game/tests/balance/pace.test.ts runs in no balance shard', [], [...TARGET_FILES, 'pace.test.ts', 'targets.ts']],
  ['a balance test named for a Dimension past the fifth', (t) => t, 'game/tests/balance/d6-pace.test.ts runs in no balance shard', [], [...TARGET_FILES, 'd6-pace.test.ts']],
  ['deploy waiting for balance', (t) => replaceOnce(t, needsLine, '    needs: [game, legacy, perf, balance]\n'), 'never waits for the report-only balance jobs'],
  ['deploy not waiting for perf', (t) => replaceOnce(t, needsLine, '    needs: [game, legacy]\n'), 'deploy must declare needs: [game, legacy, perf]'],
  [
    'removed perf job',
    (t) => t.slice(0, t.indexOf('  perf:\n')) + t.slice(t.indexOf('  balance-dimension:\n')),
    'missing job perf:',
  ],
  ['deleted perf run', (t) => replaceOnce(t, perfStep, ''), 'the perf job must run "npm run test:perf"'],
  ['perf left to continue on error', (t) => replaceOnce(t, perfStep, `${perfStep}        continue-on-error: true\n`), 'continue-on-error is not allowed in the game/legacy/perf jobs'],
  ['perf without its e2e build', (t) => inPerf(t, buildE2eStep, ''), 'the perf job must run "npm run build:e2e"'],
  ['perf without its release build', (t) => inPerf(t, buildStep, ''), 'the perf job must run "npm run build"'],
  [
    'perf e2e build after the perf run',
    (t) => inPerf(inPerf(t, buildE2eStep, ''), perfStep, `${perfStep}${buildE2eStep}`),
    'npm run build:e2e must come before npm run test:perf',
  ],
  ['perf without node-version-file', (t) => inPerf(t, nodeVersionLine, ''), 'perf must set up Node with node-version-file: .nvmrc'],
  ['website/assets/next directory', (t) => t, 'website/assets/next is named "next"', ['assets/next']],
];

describe('check-workflow guard', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('accepts the real ci.yml', () => {
    const { status, output } = runGuard(realWorkflow);
    expect(output).toContain('workflow ok');
    expect(status).toBe(0);
  });

  it('accepts the report-only balance job, which deploy does not wait for, and the perf job, which it does', () => {
    expect(realText).toMatch(/^ {2}balance:$/m);
    expect(realText).toMatch(/^ {2}perf:$/m);
    expect(realText).toContain(needsLine);
    const { status, output } = runGuard(realWorkflow);
    expect(output).toContain('workflow ok');
    expect(status).toBe(0);
  });

  it('accepts a CRLF copy of ci.yml', () => {
    const { status, output } = runGuard(writeFixture(realText.replace(/\n/g, '\r\n')));
    expect(output).toContain('workflow ok');
    expect(status).toBe(0);
  });

  it.each(failingCases)('rejects: %s', (_name, mutate, message, websiteDirs, balanceFiles) => {
    const { status, output } = runGuard(writeFixture(mutate(realText), websiteDirs, balanceFiles));
    expect(output).toContain(message);
    expect(status).toBe(1);
  });
});
