import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameDir, guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-workflow.mjs', 'check-workflow-');
const realWorkflow = join(gameDir, '..', '.github', 'workflows', 'ci.yml');
const realText = readFileSync(realWorkflow, 'utf8');

/** Every Dimension's balance targets file and the Daily's suite, as the balance shards expect them. */
const TARGET_FILES = [...[1, 2, 3, 4, 5].map((d) => `d${String(d)}-targets.test.ts`), 'daily.test.ts'];

/**
 * Lays out <tmp>/.github/workflows/ci.yml and <tmp>/game/tests/balance/ with `balanceFiles` in it, nested paths
 * included, returning the workflow path.
 */
function writeFixture(text: string, balanceFiles: string[] = TARGET_FILES): string {
  const root = tempRoot();
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'game', 'tests', 'balance'), { recursive: true });
  for (const file of balanceFiles) {
    mkdirSync(dirname(join(root, 'game', 'tests', 'balance', file)), { recursive: true });
    writeFileSync(join(root, 'game', 'tests', 'balance', file), '');
  }
  const workflowPath = join(root, '.github', 'workflows', 'ci.yml');
  writeFileSync(workflowPath, text);
  return workflowPath;
}

/** Replaces the first occurrence of `from`; throws so a stale mutation cannot pass silently. */
function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`ci.yml no longer contains ${JSON.stringify(from)}; update this test`);
  return text.replace(from, () => to);
}

/** Adds `step` just before the first occurrence of `anchor`. */
const addBefore = (text: string, anchor: string, step: string) => replaceOnce(text, anchor, `${step}${anchor}`);
/** Moves the first occurrence of `step` to just before the first occurrence of `anchor`. */
const moveBefore = (text: string, step: string, anchor: string) => addBefore(replaceOnce(text, step, ''), anchor, step);

const needsLine = '    needs: [game, perf]\n';
const ifLine = "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n";
const nodeVersionLine = '          node-version-file: .nvmrc\n';
const e2eStep = '        run: npm run test:e2e\n';
const unitStep = '        run: npm test\n';
const digestStep = '        run: npm run test:digests\n';
const buildStep = '        run: npm run build\n';
const noBridgeStep = '        run: npm run check:no-bridge\n';
const buildE2eStep = '        run: npm run build:e2e\n';
const checkBaseStep = '        run: npm run check:base\n';
const checkPagesStep = '        run: npm run check:pages\n';
const gameName = '    name: Game (lint, typecheck, unit, build, e2e)\n';
const gameUploadPath = '          path: game/dist/\n';
const deployPermissions = '      contents: read\n      pages: write\n      id-token: write\n';
const downloadName = '          name: game-dist\n          path: _site\n';
const downloadStep = `      - name: Download game build\n        uses: actions/download-artifact@v8\n        with:\n${downloadName}\n`;
const siteCheck = (script: string) => `        run: node game/scripts/${script}.mjs _site\n`;
const siteBase = siteCheck('check-base');
const siteBridge = siteCheck('check-no-bridge');
const sitePages = siteCheck('check-pages');
/** The deploy job's step running `run`, from its `- name:` line to the blank line after it. */
const deployStep = (t: string, run: string) => {
  const end = t.indexOf(run) + run.length;
  return t.slice(t.lastIndexOf('      - name:', end), end + 1);
};
const uploadPages = '        uses: actions/upload-pages-artifact@v5\n        with:\n          path: _site\n';
const uploadStep = `      - name: Upload Pages artifact\n${uploadPages}\n`;
const runStep = (name: string, run: string) => `      - name: ${name}\n        run: ${run}\n\n`;
const balanceStep = '        run: npm run test:balance -- ${{ matrix.shard }}\n';
const perfStep = '        run: npm run test:perf\n';
/** The perf job's own steps, from its header to the balance shards' header. */
const perfJob = (t: string) => t.slice(t.indexOf('  perf:\n'), t.indexOf('  balance-dimension:\n'));
/** `t` with `from` replaced by `to` inside the perf job only; throws if the perf job lacks it. */
const inPerf = (t: string, from: string, to: string) => {
  const job = perfJob(t);
  return t.replace(job, () => replaceOnce(job, from, to));
};
const matrixEntry = (shard: string, label: string) => `          - { shard: ${shard}, label: ${label} }\n`;
const d5Entry = matrixEntry('d5-', 'Dimension 5');
const dailyEntry = matrixEntry('daily', 'Daily');
const failFastLine = '      fail-fast: false\n';
const includeLine = '        include:\n';
const rollUpNeeds = '    needs: [balance-dimension]\n';
const rollUpAlways = '    if: always()\n';
const rollUpCheck = '        run: test "$SHARDS" = success\n';
/** The balance shards' own Node setup: the first after the balance-dimension job starts. */
const balanceNode = (t: string) => t.indexOf(nodeVersionLine, t.indexOf('  balance-dimension:\n'));
const comment = (line: string) => `    # ${line.trim()}\n`;
const topPermissions = 'permissions:\n  contents: read\n';

const DEPLOY_STEPS = "deploy's steps must be exactly, in order:";
const NO_CONTINUE = 'continue-on-error is not allowed in the game, perf and deploy jobs';

const failingCases: [name: string, mutate: (text: string) => string, message: string, balanceFiles?: string[]][] = [
  ['commented-out needs', (t) => replaceOnce(t, needsLine, comment(needsLine)), 'deploy must declare needs: [game, perf]'],
  [
    'if moved to step level',
    (t) => replaceOnce(replaceOnce(t, ifLine, ''), '      - name: Download game build\n', `      - name: Download game build\n    ${ifLine}`),
    "deploy must declare if: github.event_name == 'push'",
  ],
  ['game without node-version-file', (t) => replaceOnce(t, nodeVersionLine, ''), 'game must set up Node with node-version-file: .nvmrc'],
  [
    'deploy without node-version-file',
    (t) => t.slice(0, t.lastIndexOf(nodeVersionLine)) + t.slice(t.lastIndexOf(nodeVersionLine) + nodeVersionLine.length),
    'deploy must set up Node with node-version-file: .nvmrc',
  ],
  [
    'continue-on-error on the deploy job',
    (t) => replaceOnce(t, '  deploy:\n', '  deploy:\n    continue-on-error: true\n'),
    NO_CONTINUE,
  ],
  [
    'continue-on-error in game step',
    (t) => replaceOnce(t, unitStep, `${unitStep}        continue-on-error: true\n`),
    NO_CONTINUE,
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
    NO_CONTINUE,
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
  [
    'removed balance job',
    (t) => t.slice(0, t.indexOf('  balance:\n')) + t.slice(t.indexOf('  deploy:\n')),
    'missing job balance:',
  ],
  ['deleted balance run', (t) => replaceOnce(t, balanceStep, ''), 'the balance-dimension job must run "npm run test:balance -- ${{ matrix.shard }}"'],
  ['balance shards running the whole suite', (t) => replaceOnce(t, balanceStep, '        run: npm run test:balance\n'), 'the balance-dimension job must run'],
  [
    'balance without node-version-file',
    (t) => t.slice(0, balanceNode(t)) + t.slice(balanceNode(t) + nodeVersionLine.length),
    'balance-dimension must set up Node with node-version-file: .nvmrc',
  ],
  ['a Dimension dropped from the matrix', (t) => replaceOnce(t, d5Entry, ''), "the balance-dimension job's matrix must include exactly"],
  ['the Daily dropped from the matrix', (t) => replaceOnce(t, dailyEntry, ''), "the balance-dimension job's matrix must include exactly"],
  ['a shard out of order', (t) => replaceOnce(replaceOnce(t, dailyEntry, ''), d5Entry, `${dailyEntry}${d5Entry}`), "the balance-dimension job's matrix must include exactly"],
  ['a shard filter mislabelled', (t) => replaceOnce(t, dailyEntry, matrixEntry('daily', 'd1-')), "the balance-dimension job's matrix must include exactly"],
  [
    'removed balance shards',
    (t) => t.slice(0, t.indexOf('  balance-dimension:\n')) + t.slice(t.indexOf('  balance:\n')),
    'missing job balance-dimension:',
  ],
  [
    'continue-on-error on the balance shards',
    (t) => replaceOnce(t, '  balance-dimension:\n', '  balance-dimension:\n    continue-on-error: true\n'),
    'continue-on-error is not allowed in the balance-dimension job',
  ],
  [
    'a balance shard run left to continue on error',
    (t) => replaceOnce(t, balanceStep, `${balanceStep}        continue-on-error: true\n`),
    'continue-on-error is not allowed in the balance-dimension job',
  ],
  ['balance shards that fail fast', (t) => replaceOnce(t, failFastLine, '      fail-fast: true\n'), 'must set fail-fast: false'],
  ['balance shards with no fail-fast', (t) => replaceOnce(t, failFastLine, ''), 'must set fail-fast: false'],
  ['balance shards listed under exclude', (t) => replaceOnce(t, includeLine, '        exclude:\n'), 'must list its shards under include:'],
  ['roll-up not waiting for the shards', (t) => replaceOnce(t, rollUpNeeds, ''), 'balance must declare needs: [balance-dimension]'],
  ['roll-up skipped when a shard fails', (t) => replaceOnce(t, `${rollUpNeeds}${rollUpAlways}`, rollUpNeeds), 'balance must declare if: always()'],
  ['roll-up passing whatever the shards did', (t) => replaceOnce(t, rollUpCheck, '        run: true\n'), 'balance must pass only when every shard did'],
  ['a Dimension without its targets file', (t) => t, 'd3-targets.test.ts is missing', TARGET_FILES.filter((f) => !f.startsWith('d3-'))],
  ['no Daily suite in the balance tests', (t) => t, 'holds no test file the daily shard picks', TARGET_FILES.filter((f) => !f.startsWith('daily')).concat('dailyRuns.ts')],
  ['a balance test two shards pick', (t) => t, 'game/tests/balance/d2-daily.test.ts runs in the d2- and daily shards', [...TARGET_FILES, 'd2-daily.test.ts']],
  ['a nested balance test whose folder names another shard', (t) => t, 'game/tests/balance/daily/d3-pace.test.ts runs in the d3- and daily shards', [...TARGET_FILES, 'daily/d3-pace.test.ts']],
  ['a balance test in no shard', (t) => t, 'game/tests/balance/pace.test.ts runs in no balance shard', [...TARGET_FILES, 'pace.test.ts', 'targets.ts']],
  ['a nested balance test in no shard', (t) => t, 'game/tests/balance/bosses/pace.test.ts runs in no balance shard', [...TARGET_FILES, 'bosses/pace.test.ts', 'bosses/d3-pace.test.ts']],
  ['a balance test named for a Dimension past the fifth', (t) => t, 'game/tests/balance/d6-pace.test.ts runs in no balance shard', [...TARGET_FILES, 'd6-pace.test.ts']],
  ['deploy waiting for balance', (t) => replaceOnce(t, needsLine, '    needs: [game, perf, balance]\n'), 'never waits for the report-only balance jobs'],
  ['deploy not waiting for perf', (t) => replaceOnce(t, needsLine, '    needs: [game]\n'), 'deploy must declare needs: [game, perf]'],
  ['deploy not waiting for game', (t) => replaceOnce(t, needsLine, '    needs: [perf]\n'), 'deploy must declare needs: [game, perf]'],
  [
    'removed perf job',
    (t) => t.slice(0, t.indexOf('  perf:\n')) + t.slice(t.indexOf('  balance-dimension:\n')),
    'missing job perf:',
  ],
  ['deleted perf run', (t) => replaceOnce(t, perfStep, ''), 'the perf job must run "npm run test:perf"'],
  ['perf left to continue on error', (t) => replaceOnce(t, perfStep, `${perfStep}        continue-on-error: true\n`), NO_CONTINUE],
  ['perf without its e2e build', (t) => inPerf(t, buildE2eStep, ''), 'the perf job must run "npm run build:e2e"'],
  ['perf without its release build', (t) => inPerf(t, buildStep, ''), 'the perf job must run "npm run build"'],
  [
    'perf e2e build after the perf run',
    (t) => inPerf(inPerf(t, buildE2eStep, ''), perfStep, `${perfStep}${buildE2eStep}`),
    'npm run build:e2e must come before npm run test:perf',
  ],
  ['perf without node-version-file', (t) => inPerf(t, nodeVersionLine, ''), 'perf must set up Node with node-version-file: .nvmrc'],
  ['top-level permissions widened', (t) => replaceOnce(t, topPermissions, 'permissions:\n  contents: write\n'), 'top-level permissions must be exactly contents: read'],
  ['top-level permissions with a write added', (t) => replaceOnce(t, topPermissions, `${topPermissions}  pull-requests: write\n`), 'top-level permissions must be exactly contents: read'],
  ['top-level permissions removed', (t) => replaceOnce(t, topPermissions, ''), 'top-level permissions must be exactly contents: read'],
  ['a pull_request_target trigger', (t) => replaceOnce(t, '  workflow_dispatch: {}\n', '  workflow_dispatch: {}\n  pull_request_target:\n    branches: [main]\n'), 'pull_request_target is not allowed'],
  ['deploy on any push', (t) => replaceOnce(t, ifLine, "    if: github.event_name == 'push'\n"), "deploy must declare if: github.event_name == 'push'"],
  ['deploy with a second job-level if', (t) => replaceOnce(t, ifLine, `${ifLine}    if: always()\n`), "deploy's only job-level if: must be"],
  ...(['game', 'perf'] as const).map((id): (typeof failingCases)[number] => [
    `a job-level if on ${id}, which would skip deploy silently`,
    (t) => replaceOnce(t, `  ${id}:\n`, `  ${id}:\n    if: github.event_name == 'pull_request'\n`),
    `${id} must have no job-level if:`,
  ]),
  ['the game job renamed, which the ruleset requires by name', (t) => replaceOnce(t, gameName, '    name: Game (lint, typecheck, unit, build, e2e, pages)\n'), "the game job's name: must be exactly"],
  ['the game job unnamed', (t) => replaceOnce(t, gameName, ''), "the game job's name: must be exactly"],
  ['deleted site layout check', (t) => replaceOnce(t, checkPagesStep, ''), 'the game job must run "npm run check:pages"'],
  ['site layout check before the release build', (t) => moveBefore(t, checkPagesStep, buildStep), 'npm run check:pages must come after npm run build'],
  ['deleted relative base check', (t) => replaceOnce(t, checkBaseStep, ''), 'the game job must run "npm run check:base"'],
  ['relative base check before the release build', (t) => moveBefore(t, checkBaseStep, buildStep), 'npm run check:base must come after npm run build'],
  ['the e2e build uploaded as the site', (t) => replaceOnce(t, gameUploadPath, '          path: game/dist-e2e/\n'), 'the game job must upload game/dist/ as the game-dist artifact'],
  ['the release build uploaded under another name', (t) => replaceOnce(t, `          name: game-dist\n${gameUploadPath}`, `          name: game-build\n${gameUploadPath}`), 'the game job must upload game/dist/ as the game-dist artifact'],
  [
    'the release build uploaded even when it is missing',
    (t) => replaceOnce(t, `${gameUploadPath}          if-no-files-found: error\n`, `${gameUploadPath}          if-no-files-found: ignore\n`),
    'the game job must upload game/dist/ as the game-dist artifact',
  ],
  ...([['base', siteBase], ['bridge', siteBridge], ['layout', sitePages]] as const).map(([what, run]): (typeof failingCases)[number] => [
    `deleted ${what} check on the site`,
    (t) => replaceOnce(t, deployStep(t, run), ''),
    DEPLOY_STEPS,
  ]),
  ['site layout check after the upload', (t) => moveBefore(t, deployStep(t, sitePages), '      - name: Deploy to GitHub Pages\n'), DEPLOY_STEPS],
  ['site base check before the download', (t) => moveBefore(t, deployStep(t, siteBase), downloadStep), DEPLOY_STEPS],
  ['site checks out of order', (t) => moveBefore(t, deployStep(t, siteBridge), '      - name: Setup Pages\n'), DEPLOY_STEPS],
  ['a site check on the default directory', (t) => replaceOnce(t, sitePages, '        run: node game/scripts/check-pages.mjs\n'), DEPLOY_STEPS],
  ['a site check on the game build in the checkout', (t) => replaceOnce(t, sitePages, '        run: node game/scripts/check-pages.mjs game/dist\n'), DEPLOY_STEPS],
  ['the classic site staged into _site', (t) => addBefore(t, downloadStep, runStep('Stage live site', 'mkdir _site && cp -R website/. _site/')), DEPLOY_STEPS],
  ['a directory made in _site after the checks', (t) => addBefore(t, uploadStep, runStep('Make a folder', 'mkdir -p _site/extra')), DEPLOY_STEPS],
  ['a file moved into _site after the checks', (t) => addBefore(t, uploadStep, runStep('Move a file', 'mv ReadMe.md _site/')), DEPLOY_STEPS],
  ['a multi-line run in deploy', (t) => addBefore(t, uploadStep, '      - name: Write a file\n        run: |\n          echo hi > _site/hi.txt\n\n'), DEPLOY_STEPS],
  [
    'a second artifact downloaded into _site after the checks',
    (t) => addBefore(t, uploadStep, downloadStep.replace('name: game-dist', 'name: game-playwright-report').replace('path: _site', 'path: _site/report')),
    DEPLOY_STEPS,
  ],
  ['deploy without its Node setup', (t) => replaceOnce(t, `      - name: Setup Node.js\n        uses: actions/setup-node@v7\n        with:\n${nodeVersionLine}\n${downloadStep}`, downloadStep), DEPLOY_STEPS],
  ['the game build downloaded into next/', (t) => replaceOnce(t, downloadName, '          name: game-dist\n          path: _site/next\n'), "deploy's Download game build step must take exactly"],
  ['another artifact downloaded as the site', (t) => replaceOnce(t, downloadName, '          name: game-dist-e2e\n          path: _site\n'), "deploy's Download game build step must take exactly"],
  ['every artifact downloaded as the site', (t) => replaceOnce(t, downloadName, `${downloadName}          pattern: '*'\n`), "deploy's Download game build step must take exactly"],
  ['the checkout uploaded as the site', (t) => replaceOnce(t, uploadPages, uploadPages.replace('path: _site', 'path: .')), "deploy's Upload Pages artifact step must take exactly"],
  ['the unchecked game build uploaded as the site', (t) => replaceOnce(t, uploadPages, uploadPages.replace('path: _site', 'path: game/dist')), "deploy's Upload Pages artifact step must take exactly"],
  ['a site check skipped by a step if', (t) => replaceOnce(t, sitePages, `${sitePages}        if: false\n`), 'deploy must have no step-level if:'],
  ['a site check left to continue on error', (t) => replaceOnce(t, siteBridge, `${siteBridge}        continue-on-error: true\n`), NO_CONTINUE],
  ['deploy permissions widened', (t) => replaceOnce(t, deployPermissions, deployPermissions.replace('contents: read', 'contents: write')), "deploy's permissions must be exactly"],
  ['deploy permissions with a write added', (t) => replaceOnce(t, deployPermissions, `${deployPermissions}      actions: write\n`), "deploy's permissions must be exactly"],
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

  it('accepts the Daily\'s suites beside the Dimensions\' files, the shard picking a file by any part of its path in any case', () => {
    const { status, output } = runGuard(writeFixture(realText, [...TARGET_FILES, 'daily-edges.test.ts', 'theDaily.test.ts', 'dailyRuns.ts']));
    expect(output).toContain('workflow ok');
    expect(status).toBe(0);
  });

  it('accepts a CRLF copy of ci.yml', () => {
    const { status, output } = runGuard(writeFixture(realText.replace(/\n/g, '\r\n')));
    expect(output).toContain('workflow ok');
    expect(status).toBe(0);
  });

  it.each(failingCases)('rejects: %s', (_name, mutate, message, balanceFiles) => {
    const { status, output } = runGuard(writeFixture(mutate(realText), balanceFiles));
    expect(output).toContain(message);
    expect(status).toBe(1);
  });
});
