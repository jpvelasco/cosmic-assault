import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type E2eHookDeps, type E2eHooks, installE2eHooks } from '../../src/app/e2eHooks';
import { galaxyById } from '../../src/content/galaxies';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { World } from '../../src/sim/world';

const FIELD = { width: 1280, height: 720 };

beforeEach(() => {
  vi.stubEnv('MODE', 'e2e');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const worldOf = (): World => new World({ seed: 1, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById('1-1'), mode: 'free' } });

/** Hooks installed over `world`, with `step` driving it the way the run controller does: its events go to the tally. */
/** The sprite-cache use the hooks' renderer stand-in reports. */
const CACHE_USE = { size: 12, evictions: 3 };

/** An attract mode stand-in, playing the 2-2 demo or, with `active` false, off. */
function attractStandIn(active = true) {
  const standIn = { active, demo: active ? { galaxy: '2-2' as const, seed: 1 } : null, frames: 40, halted: false, dueNow: vi.fn<() => void>() };
  return standIn satisfies E2eHookDeps['attract'];
}

function hooksFor(world: World | null, restartFrameStats: () => void = () => undefined, attract = attractStandIn()): { hooks: E2eHooks; step: () => readonly SimEvent[] } {
  const hooks: E2eHooks = {};
  const step = (): readonly SimEvent[] => {
    if (world === null) return [];
    const events = world.step(STEP_SECONDS, NO_CONTROLS);
    hooks.e2eEvents?.(events, world);
    return events;
  };
  installE2eHooks(hooks, { run: { world, step: () => void step() }, mode: () => 'playing', controls: () => NO_CONTROLS, redraw: () => undefined, restartFrameStats, spriteCache: () => CACHE_USE, attract });
  return { hooks, step };
}

describe('the e2e pickup grant', () => {
  it("drops the pickup at the next step, announced and collected with that step's events, and nothing sooner", () => {
    const world = worldOf();
    const { hooks, step } = hooksFor(world);
    hooks.e2eGrantPickup?.('doubleShot');
    expect(world.pickups).toEqual([]);
    expect(world.effects.doubleShot).toBe(0);

    const events = step();
    expect(events).toContainEqual(expect.objectContaining({ type: 'pickupDropped', kind: 'doubleShot' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'pickupCollected', kind: 'doubleShot' }));
    expect(world.effects.doubleShot).toBeGreaterThan(0);
    expect(world.pickups).toEqual([]);
  });

  it('is spent by one step, so a later step drops nothing more', () => {
    const { hooks, step } = hooksFor(worldOf());
    hooks.e2eGrantPickup?.('shield');
    step();
    expect(step().some((event) => event.type === 'pickupDropped')).toBe(false);
  });

  it('grants every pickup asked for before the step, each with its own id', () => {
    const world = worldOf();
    const { hooks, step } = hooksFor(world);
    hooks.e2eGrantPickup?.('doubleShot');
    hooks.e2eGrantPickup?.('shield');
    const dropped = step().filter((event) => event.type === 'pickupDropped');
    expect(dropped.map((event) => event.kind)).toEqual(['doubleShot', 'shield']);
    expect(new Set(dropped.map((event) => event.id)).size).toBe(2);
    expect(world.shield).toBe(true);
  });

  it('raises the weapon tier for a weapon core', () => {
    const world = worldOf();
    const { hooks, step } = hooksFor(world);
    hooks.e2eGrantPickup?.('weaponCore');
    step();
    expect(world.weaponTier).toBe(1);
  });

  it('refuses outside a run, saying how to start one', () => {
    const { hooks } = hooksFor(null);
    expect(() => hooks.e2eGrantPickup?.('shield')).toThrow('start a galaxy first');
  });
});

describe('the e2e event tally', () => {
  it('counts the events of the run in play by type', () => {
    const { hooks, step } = hooksFor(worldOf());
    step();
    step();
    expect(hooks.e2eEventCounts).toEqual({ galaxyStart: 1 });
    hooks.e2eGrantPickup?.('shield');
    step();
    expect(hooks.e2eEventCounts).toMatchObject({ galaxyStart: 1, pickupDropped: 1, pickupCollected: 1 });
  });

  it('starts a fresh count when a new run is played', () => {
    const { hooks } = hooksFor(null);
    const first = worldOf();
    const second = worldOf();
    hooks.e2eEvents?.(first.step(STEP_SECONDS, NO_CONTROLS), first);
    hooks.e2eEvents?.(first.step(STEP_SECONDS, NO_CONTROLS), first);
    expect(hooks.e2eEventCounts).toEqual({ galaxyStart: 1 });
    hooks.e2eEvents?.(second.step(STEP_SECONDS, NO_CONTROLS), second);
    expect(hooks.e2eEventCounts).toEqual({ galaxyStart: 1 });
  });
});

describe('the e2e frame-stats restart', () => {
  it('restarts the frame stats, warm-up and all, leaving the run alone', () => {
    const world = worldOf();
    const restart = vi.fn();
    const { hooks, step } = hooksFor(world, restart);
    step();
    hooks.e2eRestartFrameStats?.();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(hooks.e2eEventCounts).toEqual({ galaxyStart: 1 });
  });
});

describe('the e2e sprite-cache use', () => {
  it('reads the renderer\'s sprite cache as it stands now', () => {
    const { hooks } = hooksFor(worldOf());
    expect(hooks.e2eSpriteCache?.()).toEqual(CACHE_USE);
  });
});

describe('the e2e attract hooks', () => {
  it('count the idle stretch as over, and read attract mode as plain data', () => {
    const attract = attractStandIn();
    const { hooks } = hooksFor(null, undefined, attract);
    hooks.e2eAttractNow?.();
    expect(attract.dueNow).toHaveBeenCalledTimes(1);
    expect(hooks.e2eAttractState?.()).toEqual({ active: true, demo: '2-2', frames: 40, halted: false });
  });

  it('read no demo while attract mode is off', () => {
    const { hooks } = hooksFor(null, undefined, attractStandIn(false));
    expect(hooks.e2eAttractState?.()).toEqual({ active: false, demo: null, frames: 40, halted: false });
  });
});

describe('a release build', () => {
  it('installs no hook', () => {
    vi.stubEnv('MODE', 'production');
    const { hooks } = hooksFor(worldOf());
    expect(hooks).toEqual({});
  });
});

describe('the e2e boss damage', () => {
  it('lands every blow where it does harm: on the shards while they shield the core, then on the core', () => {
    const world = new World({ seed: 1, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById('1-6'), mode: 'free' } });
    const { hooks, step } = hooksFor(world);
    while (world.boss?.state !== 'fighting') step();
    const boss = world.boss;
    const health = (): number => boss.hp + boss.parts.reduce((sum, part) => sum + part.hp, 0);
    const before = { health: health(), core: boss.hp };
    hooks.e2eDamageBoss?.(boss.parts.length);
    expect(before.health - health()).toBe(boss.parts.length);
    expect(boss.vulnerable).toBe(true);
    expect(boss.hp).toBeLessThan(before.core);
  });
});
