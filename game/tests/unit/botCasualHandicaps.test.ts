import { describe, expect, it } from 'vitest';
import { createCasualPilot } from '../../src/bot/casual';
import { Pilot } from '../../src/bot/expert';
import { idleIntent } from '../../src/bot/hands';
import { STEP_SECONDS } from '../../src/sim/config';
import { turnBetween } from '../../src/sim/math';
import { createRng } from '../../src/sim/rng';
import { SCENE_SHIP, sceneView, stillRock } from '../helpers/botScene';

const WOBBLE_LIMIT = 0.25;
const WOBBLE_STEPS = Math.round(0.5 / STEP_SECONDS);
const DODGE_CHANCE = 0.6;

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
