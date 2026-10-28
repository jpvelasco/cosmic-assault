import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK, SKIN_IDS, TRAIL_IDS, type Look } from '../../src/content/cosmetics';
import { galaxyById } from '../../src/content/galaxies';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { createSpriteBaker, type SpriteBaker } from '../../src/render/sprites';
import { STEP_SECONDS } from '../../src/sim/config';
import { fakeCanvas } from '../helpers/fakeCanvas';
import { digestPlay, playScripted, type DigestRun } from '../helpers/eventDigest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const FIELD = { width: 1280, height: 720 };
const SECONDS = 30;
/** The renderer draws every this many steps; it still takes every step's events, the particles and the stars. */
const DRAW_EVERY = 12;
const RUN = { seed: 4, galaxy: '3-2' as const };
/** Twenty-four rendered thirty-second runs take several seconds on a loaded host. */
const RENDERED_RUNS_TIMEOUT_MS = 60_000;

/** Every `.ts` file under `dir`, relative to `src/`. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(join(SRC, dir), { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.ts') && statSync(join(SRC, dir, name)).isFile())
    .map((name) => join(dir, name));
}

/** The import specifiers of `file` (relative to `src/`), static and dynamic. */
function importsOf(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

/** The module an import resolves to, relative to `src/`, or null for a package. */
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return relative(SRC, resolve(SRC, dirname(from), specifier)).replace(/\.ts$/, '');
}

/** The cosmetic modules: the skins and trails, the Hangar, and the settings that hold the choice. */
const COSMETIC = /(^|\/)(cosmetics|hangar|hangarCard|settings)$/;

/** The parts of the game that must never depend on a look: the simulation, the bots, the galaxy tables and the meta rules. */
function pureFiles(): string[] {
  return [
    ...sourcesUnder('sim'),
    ...sourcesUnder('bot'),
    'content/galaxies.ts',
    ...sourcesUnder('meta').filter((file) => file !== 'meta/cosmetics.ts'),
  ];
}

describe('cosmetics are only read by the drawing and the menus', () => {
  it('keeps the simulation, the bots, the galaxy tables and the meta rules free of every look', () => {
    const files = pureFiles();
    expect(files.length).toBeGreaterThan(40);
    const leaks = files.flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({ file, specifier, target: resolveImport(file, specifier) }))
        .filter(({ target }) => target !== null && COSMETIC.test(target)),
    );
    expect(leaks, leaks.map(({ file, specifier }) => `${file} imports ${specifier}`).join('\n')).toEqual([]);
  });

  it('lets only meta/cosmetics.ts read the looks among the meta rules', () => {
    const readers = sourcesUnder('meta').filter((file) =>
      importsOf(file).some((specifier) => resolveImport(file, specifier)?.includes('cosmetics') === true),
    );
    expect(readers).toEqual(['meta/cosmetics.ts']);
  });
});

/** The scripted thirty seconds, with the renderer taking every step (and drawing every few) when given one. */
function playThirtySeconds(renderer: Renderer | null, look?: Look): DigestRun {
  if (renderer !== null) {
    renderer.setPalette(galaxyById(RUN.galaxy).palette);
    if (look !== undefined) renderer.setLook(look);
    renderer.resize(FIELD.width, FIELD.height, FIELD);
  }
  return digestPlay((record) =>
    playScripted(
      RUN.galaxy,
      RUN.seed,
      (world, events, step) => {
        record(world, events, step);
        if (renderer === null) return;
        renderer.handle(events, world);
        renderer.advance(STEP_SECONDS, world, false);
        if (step % DRAW_EVERY === 0) renderer.draw(world, 1, world.score);
      },
      SECONDS,
    ),
  );
}

describe('a look never changes what happens in play', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: fakeCanvas });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Twenty-four rendered runs of thirty seconds each: a few seconds apiece, so the file gets an explicit timeout.
  it('plays the scripted thirty seconds to the same event digest unrendered and rendered under every look', () => {
    const unrendered = playThirtySeconds(null);
    expect(unrendered.status, 'the run is still in play at thirty seconds').toBe('playing');
    expect(unrendered.types).toContain('asteroidDestroyed');
    for (const skin of SKIN_IDS) {
      for (const trail of TRAIL_IDS) {
        const baker: SpriteBaker = createSpriteBaker();
        const renderer = createRenderer(fakeCanvas() as unknown as HTMLCanvasElement, { baker });
        expect(playThirtySeconds(renderer, { skin, trail }), `${skin} with ${trail}`).toEqual(unrendered);
        expect(baker.cached(`ship|${galaxyById(RUN.galaxy).palette}:${skin}|0`), `${skin} hull was baked`).toBeDefined();
        renderer.dispose();
      }
    }
  }, RENDERED_RUNS_TIMEOUT_MS);

  it('plays the same digest with the default look as with no look chosen at all', () => {
    const renderer = createRenderer(fakeCanvas() as unknown as HTMLCanvasElement, { baker: createSpriteBaker() });
    expect(playThirtySeconds(renderer, DEFAULT_LOOK)).toEqual(playThirtySeconds(null));
    renderer.dispose();
  }, RENDERED_RUNS_TIMEOUT_MS);
});
