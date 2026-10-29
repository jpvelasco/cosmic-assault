import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** The page left at the retired preview address, copied as is from public/ into the build. */
const html = readFileSync(new URL('../../public/next/index.html', import.meta.url), 'utf8');

/** Each script element of `source`: its attributes and its code. */
function scriptsOf(source: string): { attributes: string; code: string }[] {
  const lower = source.toLowerCase();
  const found: { attributes: string; code: string }[] = [];
  for (let open = lower.indexOf('<script'); open >= 0; open = lower.indexOf('<script', open + 1)) {
    const openEnd = source.indexOf('>', open);
    const close = lower.indexOf('</script', openEnd);
    found.push({ attributes: source.slice(open + '<script'.length, openEnd).trim(), code: source.slice(openEnd + 1, close) });
  }
  return found;
}

/** The text a visitor sees: what lies between tags, apart from the code of a script or style. */
function visibleText(source: string): string {
  const texts: string[] = [];
  let hidden: string | null = null;
  for (const part of source.split('<').slice(1)) {
    const tagEnd = part.indexOf('>');
    const name = (part.slice(0, tagEnd).split(/\s/)[0] ?? '').toLowerCase();
    if (hidden === null && (name === 'script' || name === 'style')) hidden = name;
    else if (hidden === name.slice(1) && name.startsWith('/')) {
      hidden = null;
      texts.push(part.slice(tagEnd + 1));
    } else if (hidden === null) texts.push(part.slice(tagEnd + 1));
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

const scripts = scriptsOf(html);
const script = scripts[0]?.code ?? '';
const text = visibleText(html);

describe('the retired preview page', () => {
  it('keeps itself out of search results and points them at the game', () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<link rel="canonical" href="../">');
  });

  it('says where the game went, links to it and tells an installed preview what to do', () => {
    expect(html).toMatch(/<h1>Cosmic Assault has moved<\/h1>/);
    expect(html).toContain('<p>The game now lives at its main address. Taking you there…</p>');
    expect(html).toContain('<a href="../">Play Cosmic Assault</a>');
    expect(html).toContain('<p>Installed the preview as an app? You can remove it and install the game from the main address.</p>');
    expect(text).toBe(
      'Cosmic Assault has moved Cosmic Assault has moved The game now lives at its main address. Taking you there… Play Cosmic Assault Installed the preview as an app? You can remove it and install the game from the main address.',
    );
  });

  it('moves on to the game after 3 s without a script', () => {
    expect(html).toContain('<meta http-equiv="refresh" content="3; url=../">');
  });

  it('registers the retiring worker, asks it to update, and leaves for the game after 2 s or on any failure', () => {
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.attributes, 'an inline classic script').toBe('');
    expect(() => new Script(script)).not.toThrow();
    expect(script).toMatch(/register\('\.\/sw\.js'\)\s*\.then\(\(registration\) => registration\.update\(\)\)\s*\.catch\(leave\)/);
    expect(script).toContain("location.replace('../')");
    expect(script).toMatch(/setTimeout\(leave, 2000\)/);
  });

  it('keeps no state of its own: the worker owns the caches and the registration', () => {
    expect(script).not.toMatch(/localStorage|sessionStorage|indexedDB|cookie|caches|unregister|getRegistration/);
  });

  it('loads nothing from anywhere and names no absolute address', () => {
    expect(html).not.toMatch(/<(img|iframe|object|embed|link\b(?![^>]*rel="canonical"))/);
    expect(html).not.toMatch(/\bsrc=|@import|url\(/);
    expect(html).not.toMatch(/\/\/|(href|content|src)="\/|url=\/|'\//);
    for (const [, target] of html.matchAll(/(?:href="|url=|replace\(')([^"')]*)/g)) expect(target).toBe('../');
  });
});
