import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRIFT } from '../../src/render/palette';
import { NOT_PRECACHED } from '../../vite/precache';
import { readPng } from '../helpers/png';

const PUBLIC = new URL('../../public/', import.meta.url);
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/** Width and height of the PNG at `path` in public/. */
function pngSize(path: string): { width: number; height: number } {
  const { width, height } = readPng(new URL(path, PUBLIC));
  return { width, height };
}

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: string;
}

const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', PUBLIC), 'utf8')) as Record<string, unknown> & {
  icons: ManifestIcon[];
};

/** The value of `attribute` on the tag that `match` (a regular expression source) finds in index.html. */
function tagAttribute(match: string, attribute: string): string | undefined {
  const tag = new RegExp(`<(?:link|meta)\\b[^>]*${match}[^>]*>`).exec(html)?.[0];
  return tag === undefined ? undefined : new RegExp(`\\b${attribute}="([^"]*)"`).exec(tag)?.[1];
}

const isRelative = (url: string): boolean => !/^(\/|[a-z][a-z0-9+.-]*:)/i.test(url);

describe('the app icons', () => {
  it.each([
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
    ['icons/icon-maskable-512.png', 512],
    ['icons/apple-touch-icon.png', 180],
  ])('%s is %i px square', (path, size) => {
    expect(pngSize(path)).toEqual({ width: size, height: size });
  });
});

/** The most bytes the icons every visit's cache carries may take: those the worker precaches, all but the 512 px ones. */
const PRECACHED_ICON_BYTES = 200 * 1024;

describe('the precached icons', () => {
  it(`take ${String(PRECACHED_ICON_BYTES / 1024)} KB at most`, () => {
    const precached = readdirSync(new URL('icons/', PUBLIC)).map((name) => `icons/${name}`).filter((path) => !NOT_PRECACHED.includes(path));
    expect(precached.length).toBeGreaterThan(0);
    const bytes = precached.reduce((sum, path) => sum + statSync(new URL(path, PUBLIC)).size, 0);
    expect(bytes, precached.join(', ')).toBeLessThanOrEqual(PRECACHED_ICON_BYTES);
  });
});

describe('manifest.webmanifest', () => {
  it('names the app and opens it full screen in landscape from its own directory', () => {
    expect(manifest).toMatchObject({
      name: 'Cosmic Assault',
      short_name: 'Cosmic Assault',
      display: 'standalone',
      orientation: 'landscape',
      start_url: './',
      scope: './',
    });
  });

  it('takes its theme and background from the Drift sky', () => {
    expect(manifest['theme_color']).toBe(DRIFT.skyStops[0]);
    expect(manifest['background_color']).toBe(DRIFT.skyStops[0]);
  });

  it('lists the 192 and 512 icons for any use and the 512 maskable one', () => {
    expect(manifest.icons).toEqual([
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('leaves id out, so the app\'s identity follows start_url: a relative id resolves against the origin, not this path', () => {
    expect(manifest).not.toHaveProperty('id');
  });

  it('uses only relative URLs, each naming a file of the size it claims', () => {
    for (const key of ['start_url', 'scope'] as const) expect(isRelative(String(manifest[key])), key).toBe(true);
    for (const { src, sizes } of manifest.icons) {
      expect(isRelative(src), src).toBe(true);
      const { width, height } = pngSize(src);
      expect(`${String(width)}x${String(height)}`).toBe(sizes);
    }
  });
});

describe('index.html install metadata', () => {
  it('links the manifest and the Apple touch icon with relative URLs to files in public/', () => {
    for (const rel of ['manifest', 'apple-touch-icon']) {
      const href = tagAttribute(`rel="${rel}"`, 'href') ?? '';
      expect(isRelative(href), `${rel} href "${href}"`).toBe(true);
      expect(existsSync(new URL(href, PUBLIC)), `${rel} href "${href}"`).toBe(true);
    }
  });

  it('colours the browser chrome with the Drift sky', () => {
    expect(tagAttribute('name="theme-color"', 'content')).toBe(DRIFT.skyStops[0]);
  });

  it('lets iOS open it from the home screen as a full-screen app named Cosmic Assault', () => {
    expect(tagAttribute('name="apple-mobile-web-app-capable"', 'content')).toBe('yes');
    expect(tagAttribute('name="apple-mobile-web-app-title"', 'content')).toBe('Cosmic Assault');
  });
});
