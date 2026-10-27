import { describe, expect, it } from 'vitest';
import { createCasual, createCasualPilot } from '../../src/bot/casual';
import { Pilot } from '../../src/bot/expert';
import { idleIntent } from '../../src/bot/hands';
import { createView, readView, type BotView } from '../../src/bot/view';
import { galaxyById } from '../../src/content/galaxies';
import { MIN_WINDUP_SECONDS } from '../../src/sim/boss/bossRunner';
import type { BossView } from '../../src/sim/boss/behaviour';
import { VOLLEY_REACH } from '../../src/sim/boss/monolith';
import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { Foe } from '../../src/sim/foes/foe';
import { turnBetween } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { SCENE_FIELD, SCENE_SHIP, sceneView, stage, stillRock } from '../helpers/botScene';
import { MUTED_KINDS } from '../helpers/mute';

const WOBBLE_LIMIT = 0.25;
const WOBBLE_STEPS = Math.round(0.5 / STEP_SECONDS);
const DODGE_CHANCE = 0.6;
const TELEGRAPH_DODGE_CHANCE = 0.85;

/** Sets the staged boss's windup, keeping the rest of it. */
function windUp(view: BotView, windup: BossView['windup']): void {
  view.boss = { ...(view.boss as BossView), windup };
}

/** A drone `id` 100 units to the ship's right, flying straight at it. */
const oncoming = (id: number): Foe =>
  ({ id, kind: 'drone', x: SCENE_SHIP.x + 100, y: SCENE_SHIP.y, vx: -110, vy: 0, px: SCENE_SHIP.x + 101, py: SCENE_SHIP.y, rotation: Math.PI, protation: Math.PI, spin: 0, radius: 12, hp: 1 });

/** About how long a volley's shards take, once thrown, to pass where the ship was as the windup began. */
const VOLLEY_ARRIVES = 0.6;
/** A telegraph long enough to get clear in after the delay, at full thrust from rest. */
const LONG_WINDUP = 1.2;

/**
 * Whether the casual, through its 0.3 s delay, has got clear of a shard volley's lane by the time its shards arrive:
 * the ship starts on the lane's end, at rest, in a field that spawns nothing, and the volley winds up for `windup` s.
 */
function escapes(windup: number, seed: number): boolean {
  const galaxy = { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [] };
  const world = new World({ seed: 1, field: SCENE_FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' }, initialShip: { ...SCENE_SHIP, angle: 0 } });
  const bot = createCasual(createRng(seed));
  const view = createView(world);
  for (let step = 0; step * STEP_SECONDS < windup + VOLLEY_ARRIVES; step++) {
    const winding = step * STEP_SECONDS < windup;
    stage(readView(world, view), { windup: winding ? 'shardVolley' : null });
    if (!winding) view.boss = { ...(view.boss as BossView), active: 'shardVolley' };
    world.step(STEP_SECONDS, bot.decide(view));
  }
  return Math.hypot(world.ship.x - SCENE_SHIP.x, world.ship.y - SCENE_SHIP.y) > VOLLEY_REACH + PLAYER.radius;
}

describe("the casual bot's handicaps", () => {
  it('aims off the true lead by a spread of errors within ±0.25 rad, drawn afresh every half second', () => {
    // A lone rock far enough off that neither pilot dodges: both aim at it, and only the wobble tells them apart.
    const view = sceneView([stillRock(SCENE_SHIP.x + 260, SCENE_SHIP.y)]);
    const casual = createCasualPilot(createRng(11));
    const expert = new Pilot({ rng: createRng(11) });
    const [ci, ei] = [idleIntent(), idleIntent()];
    const errors: number[] = [];
    const windows = 200;
    for (let step = 0; step < windows * WOBBLE_STEPS; step++) {
      casual.plan(view, ci);
      expert.plan(view, ei);
      expect(ci.thrust || ei.thrust).toBe(false);
      if (step % WOBBLE_STEPS === 0) errors.push(turnBetween(ei.heading ?? NaN, ci.heading ?? NaN));
    }
    const mean = errors.reduce((a, e) => a + e, 0) / errors.length;
    const spread = Math.sqrt(errors.reduce((a, e) => a + (e - mean) ** 2, 0) / errors.length);
    expect(Math.max(...errors.map(Math.abs))).toBeLessThanOrEqual(WOBBLE_LIMIT);
    // A uniform draw over ±0.25 has a standard deviation of 0.25 / √3 ≈ 0.144.
    expect(spread).toBeGreaterThan(0.1);
    expect(spread).toBeLessThan(0.18);
    expect(new Set(errors).size).toBe(windows);
  });

  it('dodges about 60% of danger episodes, with one roll holding for a whole episode', () => {
    // A tiny rock 100 units off, flying straight at the ship: in danger at once. An empty field ends the episode.
    const danger = sceneView([{ x: SCENE_SHIP.x + 100, y: SCENE_SHIP.y, size: 3, angle: Math.PI, speedMultiplier: 1 }]);
    const calm = sceneView();
    const pilot = createCasualPilot(createRng(5));
    const intent = idleIntent();
    const episodes = 1000;
    let dodged = 0;
    for (let i = 0; i < episodes; i++) {
      const choices = new Set<boolean>();
      // Six steps are three judgements, at 60 Hz: the roll must not change within the episode.
      for (let step = 0; step < 6; step++) choices.add(pilot.plan(danger, intent).thrust);
      expect(choices.size).toBe(1);
      if (choices.has(true)) dodged++;
      for (let step = 0; step < 2; step++) pilot.plan(calm, intent);
    }
    expect(Math.abs(dodged / episodes - DODGE_CHANCE)).toBeLessThan(0.05);
  });

  it('dodges about 85% of a boss\'s telegraphed attacks, with one roll per windup holding for the whole attack', () => {
    // A volley winding up on the ship, its lane laid from the core to it: in danger at once. Then the boss rests.
    const pilot = createCasualPilot(createRng(9));
    const intent = idleIntent();
    const attacks = 1000;
    let dodged = 0;
    for (let i = 0; i < attacks; i++) {
      const view = stage(sceneView(), { windup: 'shardVolley' });
      const choices = new Set<boolean>();
      for (let step = 0; step < 6; step++) choices.add(pilot.plan(view, intent).thrust);
      expect(choices.size).toBe(1);
      if (choices.has(true)) dodged++;
      windUp(view, null);
      for (let step = 0; step < 2; step++) pilot.plan(sceneView(), intent);
    }
    expect(Math.abs(dodged / attacks - TELEGRAPH_DODGE_CHANCE)).toBeLessThan(0.04);
  });

  it('gets clear of a telegraphed attack more often the longer its windup: the dodge still waits out the delay', () => {
    const rate = (windup: number): number => Array.from({ length: 100 }, (_, seed) => escapes(windup, seed + 1)).filter(Boolean).length / 100;
    const shortest = rate(MIN_WINDUP_SECONDS);
    const long = rate(LONG_WINDUP);
    // Hardly ever out of the way after the shortest telegraph, which the delay all but uses up; after a long one, on
    // about the 85% it chose to dodge.
    expect(shortest).toBeLessThan(0.1);
    expect(Math.abs(long - TELEGRAPH_DODGE_CHANCE)).toBeLessThan(0.1);
  });

  it('dodges the drones a telegraphed launch sends out at the launch\'s 85%, and other drones at the episode\'s 60%', () => {
    const rate = (launched: boolean, seed: number): number => {
      const pilot = createCasualPilot(createRng(seed));
      const intent = idleIntent();
      const waves = 1000;
      let dodged = 0;
      for (let i = 0; i < waves; i++) {
        // The launch winds up with nothing yet in reach; its wave appears as it runs, while the boss rests.
        const view = stage(sceneView(), { windup: launched ? 'launch' : null });
        for (let step = 0; step < 2; step++) pilot.plan(view, intent);
        windUp(view, null);
        view.foes = [oncoming(i + 1)];
        const choices = new Set<boolean>();
        for (let step = 0; step < 6; step++) choices.add(pilot.plan(view, intent).thrust);
        expect(choices.size).toBe(1);
        if (choices.has(true)) dodged++;
        for (let step = 0; step < 2; step++) pilot.plan(stage(sceneView(), {}), intent);
      }
      return dodged / waves;
    };
    expect(Math.abs(rate(true, 13) - TELEGRAPH_DODGE_CHANCE)).toBeLessThan(0.04);
    expect(Math.abs(rate(false, 13) - DODGE_CHANCE)).toBeLessThan(0.05);
  });

  it('the expert dodges every such episode, so the casual\'s misses are its handicap', () => {
    const danger = sceneView([{ x: SCENE_SHIP.x + 100, y: SCENE_SHIP.y, size: 3, angle: Math.PI, speedMultiplier: 1 }]);
    const calm = sceneView();
    const pilot = new Pilot({ rng: createRng(5) });
    const intent = idleIntent();
    for (let i = 0; i < 50; i++) {
      expect(pilot.plan(danger, intent).thrust).toBe(true);
      pilot.plan(danger, intent);
      pilot.plan(calm, intent);
      pilot.plan(calm, intent);
    }
  });
});
