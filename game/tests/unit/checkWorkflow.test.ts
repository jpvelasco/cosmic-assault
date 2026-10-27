import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameDir, guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-workflow.mjs', 'check-workflow-');
const realWorkflow = join(gameDir, '..', '.github', 'workflows', 'ci.yml');
const realText = readFileSync(realWorkflow, 'utf8');

/** Lays out <tmp>/.github/workflows/ci.yml and <tmp>/website/, returning the workflow path. */
function writeFixture(text: string, websiteDirs: string[] = []): string {
  const root = tempRoot();
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
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

const needsLine = '    needs: [game, legacy]\n';
const ifLine = "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n";
const diffLine = '        run: diff -r website _site --exclude next\n';
const nodeVersionLine = '          node-version-file: .nvmrc\n';
const e2eStep = '        run: npm run test:e2e\n';
const unitStep = '        run: npm test\n';
const buildStep = '        run: npm run build\n';
const noBridgeStep = '        run: npm run check:no-bridge\n';
const buildE2eStep = '        run: npm run build:e2e\n';
const legacyRun = '        run: npx playwright test --project=chromium-desktop --reporter=html,list\n';
const balanceStep = '        run: npm run test:balance\n';
/** The balance job's own Node setup: the first after the balance job starts. */
const balanceNode = (t: string) => t.indexOf(nodeVersionLine, t.indexOf('  balance:\n'));
const comment = (line: string) => `    # ${line.trim()}\n`;

const failingCases: [name: string, mutate: (text: string) => string, message: string, websiteDirs?: string[]][] = [
  ['commented-out needs', (t) => replaceOnce(t, needsLine, comment(needsLine)), 'deploy must declare needs: [game, legacy]'],
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
    'continue-on-error is not allowed in the game/legacy jobs',
  ],
  [
    'continue-on-error in game step',
    (t) => replaceOnce(t, unitStep, `${unitStep}        continue-on-error: true\n`),
    'continue-on-error is not allowed in the game/legacy jobs',
  ],
  ['deleted unit test step', (t) => replaceOnce(t, unitStep, ''), 'the game job must run "npm test"'],
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
  ['deleted balance run', (t) => replaceOnce(t, balanceStep, ''), 'the balance job must run "npm run test:balance"'],
  [
    'balance without node-version-file',
    (t) => t.slice(0, balanceNode(t)) + t.slice(balanceNode(t) + nodeVersionLine.length),
    'balance must set up Node with node-version-file: .nvmrc',
  ],
  ['deploy waiting for balance', (t) => replaceOnce(t, needsLine, '    needs: [game, legacy, balance]\n'), 'never waits for the non-required balance or perf jobs'],
  ['website/assets/next directory', (t) => t, 'website/assets/next is named "next"', ['assets/next']],
];

describe('check-workflow guard', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('accepts the real ci.yml', () => {
    const { status, output } = runGuard(realWorkflow);
    expect(output).toContain('workflow ok');
    expect(status).toBe(0);
  });

  it.each(['perf', 'balance'])('accepts the report-only %s job, which deploy does not wait for', (job) => {
    expect(realText).toMatch(new RegExp(`^ {2}${job}:$`, 'm'));
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

  it.each(failingCases)('rejects: %s', (_name, mutate, message, websiteDirs) => {
    const { status, output } = runGuard(writeFixture(mutate(realText), websiteDirs));
    expect(output).toContain(message);
    expect(status).toBe(1);
  });
});
