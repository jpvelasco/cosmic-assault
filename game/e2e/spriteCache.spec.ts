import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import type { GalaxyId } from '../src/content/types';
import { SKIN_IDS, TRAILS, TRAIL_IDS, type Look, type TrailId } from '../src/content/cosmetics';
import { SPRITE_CACHE_CAPACITY } from '../src/render/sprites';
import { ALL_STARS_SAVE, expect, fastForward, gameState, openGame, seedLook, seedSave, startRun, test } from './fixtures';
import { CACHE_GALAXY, CACHE_HOLD_SECONDS, CACHE_LIVES, ECLIPSE_GALAXY, LEVIATHAN_GALAXY, seedFor, TO_BOSS_FIGHT_SECONDS, WARDEN_GALAXY, type ClaimId } from './seeds';

/** Evictions the cache may make in a scene's steady play: a cache sized for the scene should make next to none. */
const MAX_STEADY_EVICTIONS = 10;
/** How much room the capacity must leave over the most sprites a scene holds at once. */
const CAPACITY_HEADROOM = 1.5;
/** How often the spec reads the cache during a hold, in ms. */
const SAMPLE_MS = 250;
const REPORT_PATH = 'test-results/sprite-cache.json';

/** The glow colours a trail bakes: its colours, and its core when it draws one. */
const trailColours = (id: TrailId): number => new Set([...TRAILS[id].colors, ...(TRAILS[id].coreShare > 0 ? [TRAILS[id].core] : [])]).size;
/**
 * The scenes are played in the look that bakes the most sprites: the trail with the most glow colours (a skin bakes
 * one hull whichever it is), so the capacity holds for every look a player can choose.
 */
const HEAVIEST_LOOK: Look = {
  skin: SKIN_IDS[SKIN_IDS.length - 1] ?? 'classic',
  trail: TRAIL_IDS.reduce((most, id) => (trailColours(id) > trailColours(most) ? id : most)),
};

interface CacheScene {
  readonly name: string;
  readonly galaxy: GalaxyId;
  readonly claim: ClaimId;
  /** Sim seconds skipped before the hold: none for a field, the approach and intro for a boss fight. */
  readonly skipSeconds: number;
}

const SCENES: readonly CacheScene[] = [
  { name: 'field', galaxy: CACHE_GALAXY, claim: 'cache-field', skipSeconds: 0 },
  { name: 'warden', galaxy: WARDEN_GALAXY, claim: 'warden-cache', skipSeconds: TO_BOSS_FIGHT_SECONDS },
  { name: 'leviathan', galaxy: LEVIATHAN_GALAXY, claim: 'leviathan-cache', skipSeconds: TO_BOSS_FIGHT_SECONDS },
  { name: 'eclipse', galaxy: ECLIPSE_GALAXY, claim: 'eclipse-cache', skipSeconds: TO_BOSS_FIGHT_SECONDS },
];

const reports: Record<string, unknown> = {};

test.afterAll(() => {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify({ capacity: SPRITE_CACHE_CAPACITY, scenes: reports }, null, 2)}\n`);
});

/** The cache's use as the bridge reports it; fails in a build without the hook. */
async function cacheUse(page: Page): Promise<{ size: number; evictions: number }> {
  const { spriteCache } = await gameState(page);
  if (spriteCache === null) throw new Error('The bridge reports no sprite cache: run the e2e build, which sets the e2eSpriteCache hook');
  return spriteCache;
}

for (const scene of SCENES) {
  test(`the sprite cache holds ${scene.name} in ${scene.galaxy} without evicting what it draws`, async ({ page }) => {
    test.setTimeout(CACHE_HOLD_SECONDS * 1000 + 40_000);
    await seedSave(page, ALL_STARS_SAVE);
    await seedLook(page, HEAVIEST_LOOK);
    await openGame(page, { seed: seedFor(scene.claim), galaxy: scene.galaxy, lives: CACHE_LIVES });
    expect((await gameState(page)).look, 'the scene is played in the heaviest look').toEqual(HEAVIEST_LOOK);
    await startRun(page, false);
    if (scene.skipSeconds > 0) await fastForward(page, scene.skipSeconds);

    // Fire and turn left through the hold, as the perf spec does, so shots, hits and breaks bake their sprites too.
    await page.keyboard.down('Space');
    await page.keyboard.down('ArrowLeft');
    const start = await cacheUse(page);
    let peak = start.size;
    let last = start;
    for (let held = 0; held < CACHE_HOLD_SECONDS * 1000; held += SAMPLE_MS) {
      await page.waitForTimeout(SAMPLE_MS);
      last = await cacheUse(page);
      peak = Math.max(peak, last.size);
    }
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Space');

    const { screen } = await gameState(page);
    const evictions = last.evictions - start.evictions;
    reports[scene.name] = { galaxy: scene.galaxy, seed: seedFor(scene.claim), look: HEAVIEST_LOOK, holdMs: CACHE_HOLD_SECONDS * 1000, peak, evictions, endSize: last.size, screen };
    console.log(`sprite cache ${scene.name}: ${JSON.stringify(reports[scene.name])}`);

    expect(screen, 'the scene stays in play through the hold').toBe('playing');
    expect(evictions, `evictions in steady play, at a capacity of ${String(SPRITE_CACHE_CAPACITY)}`).toBeLessThanOrEqual(MAX_STEADY_EVICTIONS);
    expect(peak * CAPACITY_HEADROOM, `the capacity (${String(SPRITE_CACHE_CAPACITY)}) against ${String(CAPACITY_HEADROOM)} times the peak in use`).toBeLessThanOrEqual(SPRITE_CACHE_CAPACITY);
  });
}
