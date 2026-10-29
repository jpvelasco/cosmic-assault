import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPagesServer, type PagesServer } from '../../scripts/serve-pages.mjs';
import { gameTestResults, guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';
import { sharedReleaseBuild } from '../helpers/releaseBuild';

const { runAsync: compare, tempRoot } = guardScript('compare-live.mjs', 'compare-live-');
const USAGE = 'Usage: node scripts/compare-live.mjs <dist> <url>';

// The Pages server only serves directories inside game/, so every site here is written to its ignored test-results/.

/** A real release build, which every live site here serves or copies. */
const { dir: built, copy: copyOfBuild } = sharedReleaseBuild(() => tempRoot(gameTestResults));

const servers: PagesServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** Serves `dir` as Pages would under a project path, as the live site is. */
async function serveLive(dir: string): Promise<PagesServer> {
  const server = await createPagesServer({ prefix: '/cosmic-assault/', mounts: [{ dir, at: './' }] });
  servers.push(server);
  return server;
}

function fileCount(dir: string): number {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length;
}

describe('compare-live', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes when the site serves the build byte for byte and a missing file under next/ answers 404', async () => {
    const live = await serveLive(built());
    expect(await compare(built(), live.url)).toEqual({
      status: 0,
      output: `${live.url} serves ${built()} byte for byte (${String(fileCount(built()))} files), and next/no-such-file answers 404\n`,
    });
  });

  it('prints one line for each file that differs or is missing, then fails', async () => {
    const live = await serveLive(
      copyOfBuild((dir) => {
        appendFileSync(join(dir, 'index.html'), '<!-- another build -->');
        rmSync(join(dir, 'next', 'sw.js'));
      }),
    );
    const result = await compare(built(), live.url);

    expect(result.status).toBe(1);
    const lines = result.output.trimEnd().split('\n');
    expect(lines.filter((line) => line.startsWith('index.html: '))).toEqual([expect.stringMatching(/^index\.html: \S+index\.html differs from the build \(\d+ bytes live, \d+ built\)$/)]);
    expect(lines).toContain(`next/sw.js: ${live.url}next/sw.js answers 404, not the built file`);
    expect(lines.at(-1)).toBe(`2 differences between ${built()} and ${live.url}; if the deploy only just finished, wait a few minutes and run again, else the live site is not this build`);
  });

  it('fails when a missing file under next/ is answered', async () => {
    const live = await serveLive(
      copyOfBuild((dir) => {
        writeFileSync(join(dir, 'next', 'no-such-file'), 'here after all');
      }),
    );
    const result = await compare(built(), live.url);

    expect(result.status).toBe(1);
    expect(result.output).toContain(`next/no-such-file: ${live.url}next/no-such-file answers 200, where a missing file must answer 404`);
  });

  it('reports a redirect instead of following it', async () => {
    const dist = copyOfBuild((dir) => {
      writeFileSync(join(dir, 'docs'), 'same bytes');
    });
    // The host sends 301 for a directory without its slash; following it would find the same bytes.
    const live = await serveLive(
      copyOfBuild((dir) => {
        mkdirSync(join(dir, 'docs'));
        writeFileSync(join(dir, 'docs', 'index.html'), 'same bytes');
      }),
    );
    const result = await compare(dist, live.url);

    expect(result.status).toBe(1);
    expect(result.output).toContain(`docs: ${live.url}docs answers 301 (to /cosmic-assault/docs/), not the built file`);
  });

  it('reports a site it cannot reach', async () => {
    const live = await serveLive(built());
    await live.close();
    const result = await compare(built(), live.url);

    expect(result.status).toBe(1);
    expect(result.output).toContain(`index.html: could not fetch ${live.url}index.html`);
  });

  it.each([
    ['no arguments', []],
    ['no address', ['dist']],
  ])('fails with its usage given %s', async (_name, args) => {
    const result = await compare(...args);
    expect(result.status).toBe(1);
    expect(result.output).toContain(USAGE);
  });

  it.each(['https://example.github.io/cosmic-assault', 'ftp://example.github.io/cosmic-assault/', 'not an address'])(
    'fails on the address %s, which is not an http(s) address ending in a slash',
    async (url) => {
      const result = await compare(built(), url);
      expect(result.status).toBe(1);
      expect(result.output).toContain(`${url} is not an http(s) address ending in a slash; pass the site's address`);
    },
  );

  it('fails with a hint when the build is missing', async () => {
    const result = await compare(join(built(), 'missing'), 'https://example.github.io/cosmic-assault/');
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not exist; run npm run build first');
  });
});
