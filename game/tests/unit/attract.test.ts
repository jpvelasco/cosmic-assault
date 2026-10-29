import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTRACT_DEMOS,
  ATTRACT_IDLE_SECONDS,
  attractDue,
  createAttract,
  DEMO_GAP_SECONDS,
  DEMO_SECONDS,
  type AttractDeps,
  type IdleState,
} from '../../src/app/attract';
import type { Screen } from '../../src/app/flow';
import { createBot } from '../../src/bot/run';
import { createView, readView } from '../../src/bot/view';
import { galaxyById } from '../../src/content/galaxies';
import type { PaletteId } from '../../src/content/types';
import { RingLog } from '../../src/platform/log';
import { STEP_SECONDS } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { World } from '../../src/sim/world';

const FIELD: Field = { width: 1280, height: 720 };
/** The palette in force before the demos: the last run's, which none of the demos uses. */
const RUN_PALETTE: PaletteId = 'singularity';
/** One display frame at 60 Hz. */
const FRAME = 1 / 60;

const BARE_TITLE: IdleState = { screen: 'title', covered: false, visible: true, reducedMotion: false, portrait: false, idleSeconds: ATTRACT_IDLE_SECONDS };

describe('attractDue', () => {
  it(`holds on the bare title after ${String(ATTRACT_IDLE_SECONDS)} s without input`, () => {
    expect(attractDue(BARE_TITLE)).toBe(true);
    expect(attractDue({ ...BARE_TITLE, idleSeconds: ATTRACT_IDLE_SECONDS + 30 })).toBe(true);
  });

  it('waits for the whole idle stretch', () => {
    expect(attractDue({ ...BARE_TITLE, idleSeconds: ATTRACT_IDLE_SECONDS - 0.01 })).toBe(false);
    expect(attractDue({ ...BARE_TITLE, idleSeconds: 0 })).toBe(false);
  });

  it.each<[string, Partial<IdleState>]>([
    ['a card covers the title', { covered: true }],
    ['the page is hidden', { visible: false }],
    ['the player asks for reduced motion', { reducedMotion: true }],
    ['the screen is upright', { portrait: true }],
  ])('never holds while %s', (_, change) => {
    expect(attractDue({ ...BARE_TITLE, ...change })).toBe(false);
  });

  it.each<Screen>(['modeSelect', 'confirmNewRank', 'map', 'galaxySelect', 'playing', 'paused', 'results', 'gameOver', 'rankComplete'])(
    'never holds on %s, only on the title',
    (screen) => {
      expect(attractDue({ ...BARE_TITLE, screen })).toBe(false);
    },
  );
});

/** A renderer stand-in that records what attract mode asks of it. */
function fakeRenderer() {
  const renderer = {
    palette: RUN_PALETTE,
    handle: vi.fn<AttractDeps['renderer']['handle']>(),
    advance: vi.fn<AttractDeps['renderer']['advance']>(),
    settle: vi.fn<AttractDeps['renderer']['settle']>(),
    draw: vi.fn<AttractDeps['renderer']['draw']>(),
    reset: vi.fn<AttractDeps['renderer']['reset']>(),
    setPalette: vi.fn((id: PaletteId) => {
      renderer.palette = id;
    }),
  };
  return renderer;
}

interface Harness {
  readonly attract: ReturnType<typeof createAttract>;
  readonly renderer: ReturnType<typeof fakeRenderer>;
  readonly scene: { screen: Screen; covered: boolean; visible: boolean; reducedMotion: boolean; portrait: boolean; field: Field | null };
  readonly log: RingLog;
  readonly changed: ReturnType<typeof vi.fn>;
  readonly started: ReturnType<typeof vi.fn>;
  /** Runs `seconds` of display frames; returns how many drew a demo frame. */
  frames(seconds: number): number;
}

function harness(): Harness {
  const scene = { screen: 'title' as Screen, covered: false, visible: true, reducedMotion: false, portrait: false, field: FIELD as Field | null };
  const renderer = fakeRenderer();
  const log = new RingLog();
  const changed = vi.fn();
  const started = vi.fn();
  const attract = createAttract({
    renderer,
    log,
    field: () => scene.field,
    screen: () => scene.screen,
    covered: () => scene.covered,
    visible: () => scene.visible,
    reducedMotion: () => scene.reducedMotion,
    portrait: () => scene.portrait,
    now: () => 0,
    demoStarted: started,
    activeChanged: changed,
  });
  const frames = (seconds: number): number => {
    let drawn = 0;
    for (let t = 0; t < seconds - 1e-9; t += FRAME) if (attract.frame(FRAME)) drawn++;
    return drawn;
  };
  return { attract, renderer, scene, log, changed, started, frames };
}

/** The World the demo last drew. */
function drawnWorld(h: Harness): World {
  const world = h.renderer.draw.mock.lastCall?.[0];
  if (world === undefined) throw new Error('no demo frame was drawn');
  return world;
}

describe('the attract demo', () => {
  it(`starts after ${String(ATTRACT_IDLE_SECONDS)} s on the bare title, playing the first demo with no HUD`, () => {
    const h = harness();
    expect(h.frames(ATTRACT_IDLE_SECONDS - 0.5)).toBe(0);
    expect(h.attract.active).toBe(false);
    expect(h.frames(1)).toBeGreaterThan(0);
    expect(h.attract.active).toBe(true);
    expect(h.attract.demo).toEqual(ATTRACT_DEMOS[0]);
    expect(h.changed).toHaveBeenCalledTimes(1);
    expect(h.started).toHaveBeenCalledTimes(1);
    const first = ATTRACT_DEMOS[0];
    if (first === undefined) throw new Error('no demos');
    expect(h.renderer.setPalette).toHaveBeenLastCalledWith(galaxyById(first.galaxy).palette);
    // A null score draws the scene without the HUD.
    expect(h.renderer.draw.mock.lastCall?.[2]).toBeNull();
    expect(drawnWorld(h).galaxy?.id).toBe(first.galaxy);
    expect(h.attract.frames).toBe(h.renderer.draw.mock.calls.length);
  });

  it('caps a long frame, so a tab coming back from the background does not start a demo at once', () => {
    const h = harness();
    expect(h.attract.frame(60)).toBe(false);
    expect(h.attract.active).toBe(false);
  });

  it('restarts the idle count on any input', () => {
    const h = harness();
    h.frames(ATTRACT_IDLE_SECONDS - 1);
    expect(h.attract.interrupt()).toBe(false);
    h.frames(ATTRACT_IDLE_SECONDS - 1);
    expect(h.attract.active).toBe(false);
    h.frames(2);
    expect(h.attract.active).toBe(true);
  });

  it.each<[string, (scene: Harness['scene']) => void]>([
    ['a card opens', (scene) => (scene.covered = true)],
    ['the page is hidden', (scene) => (scene.visible = false)],
    ['reduced motion turns on', (scene) => (scene.reducedMotion = true)],
    ['the screen turns upright', (scene) => (scene.portrait = true)],
    ['the title gives way to another screen', (scene) => (scene.screen = 'modeSelect')],
  ])('stops when %s, and counts the idle stretch from the start again', (_, change) => {
    const h = harness();
    h.frames(ATTRACT_IDLE_SECONDS + 1);
    expect(h.attract.active).toBe(true);
    const restore = { ...h.scene };
    change(h.scene);
    expect(h.attract.frame(FRAME)).toBe(false);
    expect(h.attract.active).toBe(false);
    expect(h.renderer.palette).toBe(RUN_PALETTE);
    Object.assign(h.scene, restore);
    h.frames(ATTRACT_IDLE_SECONDS - 1);
    expect(h.attract.active).toBe(false);
  });

  it('never starts under reduced motion, a cover, a hidden page or upright', () => {
    for (const change of [{ reducedMotion: true }, { covered: true }, { visible: false }, { portrait: true }]) {
      const h = harness();
      Object.assign(h.scene, change);
      expect(h.frames(ATTRACT_IDLE_SECONDS * 2)).toBe(0);
      expect(h.renderer.draw).not.toHaveBeenCalled();
    }
  });

  it('waits for the field before it builds a World', () => {
    const h = harness();
    h.scene.field = null;
    expect(h.frames(ATTRACT_IDLE_SECONDS + 1)).toBe(0);
    h.scene.field = FIELD;
    expect(h.frames(FRAME * 2)).toBeGreaterThan(0);
  });

  it('ends on an input, which it reports so the input can be swallowed, and puts the palette back', () => {
    const h = harness();
    h.frames(ATTRACT_IDLE_SECONDS + 1);
    const world = drawnWorld(h);
    expect(h.attract.interrupt()).toBe(true);
    expect(h.attract.active).toBe(false);
    expect(h.attract.demo).toBeNull();
    expect(world.status).toBe('gameOver');
    expect(h.renderer.palette).toBe(RUN_PALETTE);
    expect(h.renderer.reset).toHaveBeenCalledTimes(2);
    expect(h.changed).toHaveBeenCalledTimes(2);
    expect(h.attract.interrupt()).toBe(false);
  });

  it('flies the expert in a free-mode World on the demo seed, exactly as a headless run does', () => {
    const h = harness();
    h.attract.dueNow();
    h.frames(20);
    const shown = drawnWorld(h);
    const first = ATTRACT_DEMOS[0];
    if (first === undefined) throw new Error('no demos');
    const replay = new World({ seed: first.seed, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById(first.galaxy), mode: 'free' } });
    const bot = createBot('expert', first.seed);
    const view = createView(replay);
    while (replay.elapsed < shown.elapsed - 1e-9) replay.step(STEP_SECONDS, bot.decide(readView(replay, view)));
    expect(replay.elapsed).toBeCloseTo(shown.elapsed, 9);
    expect({ x: shown.ship.x, y: shown.ship.y, angle: shown.ship.angle }).toEqual({ x: replay.ship.x, y: replay.ship.y, angle: replay.ship.angle });
    expect(shown.score).toBeGreaterThan(0);
    expect(shown.score).toBe(replay.score);
    expect(shown.lives).toBe(3);
    expect(shown['run']?.['mode']).toBe('free');
  });

  it('feeds the renderer every step of the demo World and nothing of its own', () => {
    const h = harness();
    h.attract.dueNow();
    h.frames(1);
    const world = drawnWorld(h);
    expect(h.renderer.handle.mock.calls.length).toBe(Math.round(world.elapsed / STEP_SECONDS));
    for (const [, seen] of h.renderer.handle.mock.calls) expect(seen).toBe(world);
  });

  it('resizes the demo World with the field', () => {
    const h = harness();
    h.attract.dueNow();
    h.frames(FRAME * 2);
    const wide = { width: 1600, height: 720 };
    h.attract.resize(wide);
    expect(drawnWorld(h).field).toEqual(wide);
  });

  it(
    `plays each demo for ${String(DEMO_SECONDS)} s, waits ${String(DEMO_GAP_SECONDS)} s, then plays the next, round the list`,
    { timeout: 30_000 },
    () => {
      const h = harness();
      h.attract.dueNow();
      const played: string[] = [];
      for (let round = 0; round <= ATTRACT_DEMOS.length; round++) {
        h.frames(FRAME);
        played.push(drawnWorld(h).galaxy?.id ?? '');
        h.frames(DEMO_SECONDS - 0.1);
        const world = drawnWorld(h);
        expect(world.status).toBe('playing');
        h.frames(0.2);
        // The demo has stopped stepping: the gap shows it still, its particles settling.
        expect(drawnWorld(h)).toBe(world);
        expect(world.elapsed).toBeCloseTo(DEMO_SECONDS, 1);
        h.frames(DEMO_GAP_SECONDS - 0.3);
        expect(drawnWorld(h)).toBe(world);
        h.frames(0.2);
        expect(drawnWorld(h)).not.toBe(world);
        expect(h.attract.active).toBe(true);
      }
      expect(played).toEqual([...ATTRACT_DEMOS, ATTRACT_DEMOS[0]].map((demo) => demo?.galaxy));
      expect(h.started).toHaveBeenCalledTimes(ATTRACT_DEMOS.length + 2);
      expect(h.changed).toHaveBeenCalledTimes(1);
    },
  );

  it('moves on as soon as a demo galaxy ends, after the gap', () => {
    const h = harness();
    h.renderer.handle.mockImplementationOnce((_events, world) => {
      world.endRun();
    });
    h.attract.dueNow();
    h.frames(FRAME);
    const ended = drawnWorld(h);
    h.frames(DEMO_GAP_SECONDS + 0.1);
    expect(drawnWorld(h)).not.toBe(ended);
    expect(drawnWorld(h).galaxy?.id).toBe(ATTRACT_DEMOS[1]?.galaxy);
  });

  it('carries on round the list where the last session left off', () => {
    const h = harness();
    h.attract.dueNow();
    h.frames(FRAME);
    h.attract.interrupt();
    h.attract.dueNow();
    h.frames(FRAME);
    expect(h.attract.demo).toEqual(ATTRACT_DEMOS[1]);
  });

  describe('when a demo throws', () => {
    it.each<[string, (h: Harness) => void]>([
      ['a step', (h) => h.renderer.handle.mockImplementation(() => { throw new Error('step broke'); })],
      ['a draw', (h) => h.renderer.draw.mockImplementation(() => { throw new Error('draw broke'); })],
    ])('in %s, stops for the session and writes the log, without throwing', (_, breakIt) => {
      const h = harness();
      breakIt(h);
      h.attract.dueNow();
      expect(() => h.frames(FRAME * 3)).not.toThrow();
      expect(h.attract.active).toBe(false);
      expect(h.attract.halted).toBe(true);
      expect(h.renderer.palette).toBe(RUN_PALETTE);
      const [entry] = h.log.entries();
      expect(entry?.kind).toBe('error');
      expect(entry?.message).toMatch(/attract demo stopped.*broke/is);
      h.renderer.handle.mockReset();
      h.renderer.draw.mockReset();
      h.attract.dueNow();
      expect(h.frames(ATTRACT_IDLE_SECONDS * 2)).toBe(0);
      expect(h.attract.interrupt()).toBe(false);
    });
  });
});

describe('stopping the attract demo for the session', () => {
  it('ends a demo playing, puts the palette back and starts none again, with nothing logged', () => {
    const h = harness();
    h.frames(ATTRACT_IDLE_SECONDS + 1);
    expect(h.attract.active).toBe(true);
    h.attract.stop();
    expect(h.attract.active).toBe(false);
    expect(h.attract.halted).toBe(true);
    expect(h.renderer.palette).toBe(RUN_PALETTE);
    expect(h.changed).toHaveBeenCalledTimes(2);
    h.attract.dueNow();
    expect(h.frames(ATTRACT_IDLE_SECONDS * 2)).toBe(0);
    expect(h.log.entries()).toEqual([]);
  });

  it('never throws, even when tidying the demo away does, and logs that instead', () => {
    const h = harness();
    h.frames(ATTRACT_IDLE_SECONDS + 1);
    h.renderer.reset.mockImplementation(() => {
      throw new Error('reset broke');
    });
    expect(() => {
      h.attract.stop();
    }).not.toThrow();
    expect(h.attract.active).toBe(false);
    expect(h.log.entries()[0]?.message).toMatch(/could not tidy up.*reset broke/is);
  });
});

describe('the attract demo and storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes nothing to storage through a whole cycle of the demos', { timeout: 30_000 }, () => {
    const stores = ['localStorage', 'sessionStorage'].map((name) => {
      const store = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(() => null), length: 0 };
      vi.stubGlobal(name, store);
      return store;
    });
    const h = harness();
    h.attract.dueNow();
    h.frames((DEMO_SECONDS + DEMO_GAP_SECONDS) * ATTRACT_DEMOS.length + 1);
    h.attract.interrupt();
    expect(h.renderer.draw.mock.calls.length).toBeGreaterThan(0);
    for (const store of stores) {
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.removeItem).not.toHaveBeenCalled();
      expect(store.clear).not.toHaveBeenCalled();
    }
  });
});
