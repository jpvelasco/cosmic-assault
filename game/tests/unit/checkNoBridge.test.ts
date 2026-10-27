import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-no-bridge.mjs', 'check-no-bridge-');

const BRIDGE = 'window.__COSMIC_ASSAULT_TEST_API__ = {}';
const QUERY = 'console.warn(`__E2E_QUERY__ Ignoring ?seed=`)';
const HOOK = 'e2e.e2eBeforeFrame?.()';
const FAST_FORWARD = 'e2e.e2eFastForward = (s) => s';
const DAMAGE_BOSS = 'e2e.e2eDamageBoss = (n) => n';
const GRANT_PICKUP = 'e2e.e2eGrantPickup = (k) => k';
const EVENT_TALLY = 'e2e.e2eEvents = (e) => e';
const ALL_HOOKS = `${HOOK};${FAST_FORWARD};${DAMAGE_BOSS};${GRANT_PICKUP};${EVENT_TALLY}`;
const PASSED = 'e2e bridge, query parsing and the frame, fast-forward, boss-damage, pickup-grant and event-tally hooks';

/** Writes `files` (relative path → contents) into a fresh temp build directory. */
function writeDist(files: Record<string, string>): string {
  const root = tempRoot();
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe('check-no-bridge (release build)', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes a build without the bridge or the e2e query parsing', () => {
    const result = runGuard(writeDist({ 'index.html': '<html></html>', 'assets/index.js': 'console.log(1)' }));
    expect(result).toEqual({ status: 0, output: `${PASSED} absent\n` });
  });

  it('fails when any nested file mentions the bridge, naming the build and the file', () => {
    const dist = writeDist({ 'index.html': '<html></html>', 'assets/deep/chunk.js': BRIDGE });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `release build ${dist} contains the e2e test bridge; release builds must not — check the import.meta.env.MODE guard in src/main.ts`,
    );
    expect(result.output).toContain(join('assets', 'deep', 'chunk.js'));
  });

  it('fails when a file carries the e2e query parsing, naming the build and the file', () => {
    const dist = writeDist({ 'assets/index.js': QUERY });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `release build ${dist} contains the e2e ?seed=, ?lives=, ?quality= and ?galaxy= parsing; release builds must not — check the import.meta.env.MODE guard in src/app/seed.ts`,
    );
    expect(result.output).toContain(join('assets', 'index.js'));
  });

  it('fails when a file carries the e2e frame hook, naming the build and the file', () => {
    const dist = writeDist({ 'assets/index.js': HOOK });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `release build ${dist} contains the e2e frame hook; release builds must not — check the import.meta.env.MODE guard in src/app/game.ts`,
    );
    expect(result.output).toContain(join('assets', 'index.js'));
  });

  it('fails with a hint when the directory is missing', () => {
    const result = runGuard(join(writeDist({}), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('run npm run build first');
  });
});

describe('check-no-bridge --e2e (e2e build)', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes a build that carries every marker', () => {
    const result = runGuard('--e2e', writeDist({ 'assets/index.js': QUERY, 'assets/bridge.js': `${BRIDGE};${ALL_HOOKS}` }));
    expect(result).toEqual({ status: 0, output: `${PASSED} present\n` });
  });

  it('fails when the query mark is missing, so the release check cannot go blind', () => {
    const dist = writeDist({ 'assets/bridge.js': `${BRIDGE};${ALL_HOOKS}` });
    const result = runGuard('--e2e', dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `e2e build ${dist} lacks the e2e ?seed=, ?lives=, ?quality= and ?galaxy= parsing (__E2E_QUERY__); the release check scans for that mark, so keep it in src/app/seed.ts or update scripts/check-no-bridge.mjs`,
    );
  });

  it('fails when the frame hook is missing, so the release check cannot go blind', () => {
    const dist = writeDist({ 'assets/index.js': QUERY, 'assets/bridge.js': BRIDGE });
    const result = runGuard('--e2e', dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      `e2e build ${dist} lacks the e2e frame hook (e2eBeforeFrame); the release check scans for that mark, so keep it in src/app/game.ts or update scripts/check-no-bridge.mjs`,
    );
  });

  it('fails with a hint when the directory is missing', () => {
    const result = runGuard('--e2e', join(writeDist({}), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('run npm run build:e2e first');
  });

  it('fails when the fast-forward hook is missing, so the release check cannot go blind', () => {
    const dist = writeDist({ 'assets/index.js': QUERY, 'assets/bridge.js': `${BRIDGE};${HOOK};${DAMAGE_BOSS};${GRANT_PICKUP};${EVENT_TALLY}` });
    const result = runGuard('--e2e', dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`e2e build ${dist} lacks the e2e fast-forward hook (e2eFastForward)`);
  });
});

describe('check-no-bridge (release build): the fast-forward hook', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('fails when a release file carries it', () => {
    const dist = writeDist({ 'assets/index.js': FAST_FORWARD });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`release build ${dist} contains the e2e fast-forward hook`);
  });
});

describe('check-no-bridge: the boss-damage hook', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('fails a release build that carries it', () => {
    const dist = writeDist({ 'assets/index.js': DAMAGE_BOSS });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`release build ${dist} contains the e2e boss-damage hook; release builds must not — check the import.meta.env.MODE guard in src/app/e2eHooks.ts`);
  });

  it('fails an e2e build that lacks it, so the release check cannot go blind', () => {
    const dist = writeDist({ 'assets/index.js': QUERY, 'assets/bridge.js': `${BRIDGE};${HOOK};${FAST_FORWARD};${GRANT_PICKUP};${EVENT_TALLY}` });
    const result = runGuard('--e2e', dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`e2e build ${dist} lacks the e2e boss-damage hook (e2eDamageBoss)`);
  });
});

describe.each([
  { name: 'pickup-grant', mark: 'e2eGrantPickup', carrier: GRANT_PICKUP, others: `${BRIDGE};${HOOK};${FAST_FORWARD};${DAMAGE_BOSS};${EVENT_TALLY}` },
  { name: 'event-tally', mark: 'e2eEvents', carrier: EVENT_TALLY, others: `${BRIDGE};${HOOK};${FAST_FORWARD};${DAMAGE_BOSS};${GRANT_PICKUP}` },
])('check-no-bridge: the $name hook', ({ name, mark, carrier, others }) => {
  it('fails a release build that carries it', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const dist = writeDist({ 'assets/index.js': carrier });
    const result = runGuard(dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`release build ${dist} contains the e2e ${name} `);
    expect(result.output).toContain('check the import.meta.env.MODE guard in src/app/e2eHooks.ts');
  });

  it('fails an e2e build that lacks it, so the release check cannot go blind', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const dist = writeDist({ 'assets/index.js': QUERY, 'assets/bridge.js': others });
    const result = runGuard('--e2e', dist);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`(${mark})`);
  });
});
