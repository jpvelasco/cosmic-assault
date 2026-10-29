import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardScript, SPAWN_TIMEOUT_MS } from '../helpers/guardScript';
import { sharedReleaseBuild } from '../helpers/releaseBuild';

const { run: runGuard, tempRoot } = guardScript('check-pages.mjs', 'check-pages-');

const PASSED = 'site layout ok: the game at the root, only the moved page and the retiring worker in next/, and relative URLs throughout\n';

/** A real release build, which every case copies and changes in one way. */
const { dir: built, copy: mutant } = sharedReleaseBuild(tempRoot);

function write(dir: string, path: string, text: string): void {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** The built game script, under its hashed name. */
function gameScript(dir: string): string {
  const name = readdirSync(join(dir, 'assets')).find((file) => file.endsWith('.js'));
  if (name === undefined) throw new Error('the release build has no script in assets/');
  return `assets/${name}`;
}

function editManifest(dir: string, edit: (manifest: Record<string, unknown> & { icons: { src: string }[] }) => void): void {
  const path = join(dir, 'manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> & { icons: { src: string }[] };
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

/** Runs the guard on `dir` and expects it to fail with each of `messages`. */
function expectFailure(dir: string, ...messages: string[]): void {
  const result = runGuard(dir);
  expect(result.status, result.output).toBe(1);
  for (const message of messages) expect(result.output).toContain(message);
}

describe('check-pages', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes a real release build', () => {
    expect(runGuard(built())).toEqual({ status: 0, output: PASSED });
  });

  it('passes relative links to next/ from the root and back to the root from next/', () => {
    const dir = mutant((site) => {
      appendFileSync(join(site, 'index.html'), '<a href="next/">old</a><a href="./next/">old</a>');
      appendFileSync(join(site, gameScript(site)), ';const back="../next/";');
    });
    expect(runGuard(dir)).toEqual({ status: 0, output: PASSED });
  });

  it('fails with a hint when the directory is missing', () => {
    const result = runGuard(join(tempRoot(), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not exist; run npm run build first');
  });

  it.each([
    ['index.html', 'index.html'],
    ['sw.js', 'src/sw/worker.ts'],
    ['manifest.webmanifest', 'public/manifest.webmanifest'],
  ])('fails when %s is missing at the root, naming where it comes from', (file, owner) => {
    const dir = mutant((site) => {
      rmSync(join(site, file));
    });
    expectFailure(dir, `${dir} has no ${file} at its root;`, owner);
  });

  it.each([
    ['next/index.html', 'public/next/index.html'],
    ['next/sw.js', 'src/sw/retire.ts'],
  ])('fails when %s is missing, naming where it comes from', (file, owner) => {
    const dir = mutant((site) => {
      rmSync(join(site, file));
    });
    expectFailure(dir, `${dir} has no ${file};`, owner);
  });

  it('fails when next/ holds anything but the moved page and the retiring worker, naming each extra file', () => {
    const dir = mutant((site) => {
      write(site, 'next/preview.js', 'go()');
      write(site, 'next/assets/old.js', 'go()');
    });
    expectFailure(
      dir,
      `${dir} has next/preview.js, but next/ holds only the moved page and the retiring worker;`,
      `${dir} has next/assets/old.js, but next/ holds only the moved page and the retiring worker;`,
    );
  });

  it.each(['sw.js', 'next/sw.js'])('fails when %s does not compile as a classic script', (file) => {
    const dir = mutant((site) => {
      appendFileSync(join(site, file), '\nexport {};\n');
    });
    expectFailure(dir, `${join(dir, file)} is not a classic script`, 'build it with no import or export');
  });

  it.each([
    ['index.html', '<link rel="canonical" href="https://example.github.io/cosmic-assault/">'],
    ['next/index.html', '<a href="/cosmic-assault/">Play</a>'],
  ])('fails when %s names the project path', (file, text) => {
    const dir = mutant((site) => {
      appendFileSync(join(site, file), text);
    });
    expectFailure(dir, `${join(dir, file)} names /cosmic-assault/;`, 'make the URL relative');
  });

  it('fails when the game script names the project path', () => {
    let script = '';
    const dir = mutant((site) => {
      script = gameScript(site);
      appendFileSync(join(site, script), ';fetch("/cosmic-assault/sw.js");');
    });
    expectFailure(dir, `${join(dir, script)} names /cosmic-assault/;`);
  });

  it.each([
    ['index.html', '<a href="/next/">old</a>', '/next/'],
    ['sw.js', ';const old="https://example.github.io/next/";', 'https://example.github.io/next/'],
    ['next/index.html', '<a href="//example.github.io/next/">old</a>', '//example.github.io/next/'],
  ])('fails when %s has an absolute URL to next/', (file, text, url) => {
    const dir = mutant((site) => {
      appendFileSync(join(site, file), text);
    });
    expectFailure(dir, `${join(dir, file)} has an absolute URL to next/ (${url});`, 'make it relative');
  });

  it.each([
    ['start_url', 'https://example.github.io/'],
    ['start_url', '../'],
    ['scope', '/'],
  ])('fails when the manifest %s is %s, which is absolute or leaves the site', (key, value) => {
    const dir = mutant((site) => {
      editManifest(site, (manifest) => {
        manifest[key] = value;
      });
    });
    expectFailure(dir, `manifest.webmanifest ${key} is ${JSON.stringify(value)}, which is absolute or leaves the site;`);
  });

  it('fails when the manifest leaves start_url out', () => {
    const dir = mutant((site) => {
      editManifest(site, (manifest) => {
        delete manifest['start_url'];
      });
    });
    expectFailure(dir, 'manifest.webmanifest start_url is undefined, which is absolute or leaves the site;');
  });

  it('fails when the manifest has an id, whose relative form resolves against the origin', () => {
    const dir = mutant((site) => {
      editManifest(site, (manifest) => {
        manifest['id'] = './';
      });
    });
    expectFailure(dir, 'manifest.webmanifest has an id; leave it out so an installed app\'s identity follows start_url');
  });

  it('fails when an icon src is absolute, or names a file the site lacks', () => {
    const dir = mutant((site) => {
      editManifest(site, (manifest) => {
        const [first, second] = manifest.icons;
        if (first === undefined || second === undefined) throw new Error('the manifest lists fewer than two icons');
        first.src = '/icons/icon-192.png';
        second.src = 'icons/icon-1024.png';
      });
    });
    expectFailure(
      dir,
      'manifest.webmanifest icon src is "/icons/icon-192.png", which is absolute or leaves the site;',
      'manifest.webmanifest lists the icon icons/icon-1024.png, which the site lacks;',
    );
  });

  it('fails when the manifest is not JSON', () => {
    const dir = mutant((site) => {
      writeFileSync(join(site, 'manifest.webmanifest'), '{ "name": ');
    });
    expectFailure(dir, `${join(dir, 'manifest.webmanifest')} is not valid JSON`);
  });

  it.each(['game-modular.js', 'modules/core/Game.js', 'style.css'])('fails when the classic site\'s %s is present', (file) => {
    const dir = mutant((site) => {
      write(site, file, 'classic');
    });
    const name = file.split('/')[0] ?? file;
    expectFailure(dir, `${dir} has ${name} from the classic site;`, 'without copying the classic site into it');
  });

  it('reports every problem in one run', () => {
    const dir = mutant((site) => {
      rmSync(join(site, 'next', 'sw.js'));
      write(site, 'style.css', 'classic');
    });
    expectFailure(dir, `${dir} has no next/sw.js;`, `${dir} has style.css from the classic site;`);
  });
});
