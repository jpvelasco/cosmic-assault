import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';

const { run: runGuard, tempRoot } = guardScript('check-base.mjs', 'check-base-');

function writeSite(indexHtml?: string): string {
  const root = tempRoot();
  if (indexHtml !== undefined) writeFileSync(join(root, 'index.html'), indexHtml);
  return root;
}

describe('check-base', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes a page whose asset URLs are relative, in the directory it is given', () => {
    expect(runGuard(writeSite('<script src="./assets/index.js"></script><link href="manifest.webmanifest">'))).toEqual({ status: 0, output: 'base ok\n' });
  });

  it.each(['<script src="/assets/index.js"></script>', '<link rel="manifest" href="/manifest.webmanifest">'])('fails a page with an absolute asset URL: %s', (html) => {
    const site = writeSite(html);
    const result = runGuard(site);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${join(site, 'index.html')} has absolute asset URLs; set base: './' in vite.config.ts`);
  });

  it('fails with a hint when the directory or its page is missing', () => {
    const missing = runGuard(join(writeSite(), 'missing'));
    expect(missing.status).toBe(1);
    expect(missing.output).toContain('does not exist; run npm run build first');

    const site = writeSite();
    mkdirSync(join(site, 'assets'));
    const pageless = runGuard(site);
    expect(pageless.status).toBe(1);
    expect(pageless.output).toContain(`${site} has no index.html; run npm run build`);
  });
});
