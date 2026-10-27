import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app/game';
import { galaxyById } from '../../src/content/galaxies';
import { defaultSave } from '../../src/meta/save';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { World } from '../../src/sim/world';
import { exposeTestBridge } from '../../src/testBridge';

afterEach(() => {
  vi.unstubAllGlobals();
});

function bridgeFor(world: World | null, look: { palette: string; musicTheme: string } = { palette: 'drift', musicTheme: 'drift' }) {
  const fakeWindow: { __COSMIC_ASSAULT_TEST_API__?: CosmicAssaultTestApi } = {};
  vi.stubGlobal('window', fakeWindow);
  const app = {
    mode: 'playing',
    run: { world, flow: { galaxy: null, rankRun: null }, save: defaultSave() },
    hudRects: [],
    drawCount: 0,
    visualScale: { ship: 1, rock: 1, shot: 1, effect: 1 },
    quality: { index: 0, level: { name: 'high' } },
    frameStats: { count: 0, p50: 0, p95: 0, longFrames: 0 },
    muted: false,
    ...look,
    settings: {},
    motion: { reducedMotion: false, shake: true },
    audioState: 'none',
    log: { size: 0 },
    fullscreen: false,
  } as unknown as App;
  exposeTestBridge(app, {});
  const api = fakeWindow.__COSMIC_ASSAULT_TEST_API__;
  if (api === undefined) throw new Error('the bridge must be set');
  return api;
}

describe('the test bridge look and music', () => {
  it('reports the palette and the music theme in force, beside the version-3 fields', () => {
    const api = bridgeFor(null);
    expect(api.version).toBe(3);
    expect(api.getState()).toMatchObject({ palette: 'drift', musicTheme: 'drift' });
    expect(bridgeFor(null, { palette: 'ionReach', musicTheme: 'ionReachBoss' }).getState()).toMatchObject({ palette: 'ionReach', musicTheme: 'ionReachBoss' });
  });
});

describe('the test bridge pickup state', () => {
  it('is empty and at tier 0 outside a run', () => {
    const state = bridgeFor(null).getState();
    expect(state).toMatchObject({ pickups: [], effects: {}, weaponTier: 0, shield: false });
  });

  it('reports the weapon tier, the pickups on the field and the effects running, as plain data', () => {
    const world = new World({ seed: 1, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById('2-1'), mode: 'rank' }, startTier: 2 });
    world['run']?.loadout.collect('doubleShot');
    world['run']?.loadout.collect('shield');
    world['run']?.['pickupField'].list.push({ id: 7, kind: 'rapidFire', x: 100, y: 200, px: 100, py: 200, vx: 0, vy: 0, expiresIn: 5 });
    world.step(STEP_SECONDS, NO_CONTROLS);
    const state = bridgeFor(world).getState();
    expect(state.weaponTier).toBe(2);
    expect(state.shield).toBe(true);
    expect(state.effects.doubleShot).toBeCloseTo(12 - STEP_SECONDS, 9);
    expect(state.effects.shield).toBeCloseTo(15 - STEP_SECONDS, 9);
    expect(Object.keys(state.effects).sort()).toEqual(['doubleShot', 'shield']);
    expect(state.pickups).toHaveLength(1);
    expect(state.pickups[0]).toMatchObject({ id: 7, kind: 'rapidFire' });
    expect(Object.keys(state.pickups[0] ?? {}).sort()).toEqual(['expiresIn', 'id', 'kind', 'x', 'y']);
  });

  it('hands out copies, so a spec that edits them cannot change the game', () => {
    const world = new World({ seed: 1, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById('1-1'), mode: 'free' } });
    world['run']?.loadout.collect('doubleShot');
    const api = bridgeFor(world);
    (api.getState().effects as Record<string, number>)['doubleShot'] = 99;
    expect(world.effects.doubleShot).toBe(12);
    expect(api.getState().effects.doubleShot).toBe(12);
  });
});
