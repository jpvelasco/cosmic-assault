import { describe, expect, it } from 'vitest';
import { createCasualPilot } from '../../src/bot/casual';
import { Pilot } from '../../src/bot/expert';
import { idleIntent } from '../../src/bot/hands';
import type { BotView } from '../../src/bot/view';
import type { Bolt } from '../../src/sim/foes/bolts';
import type { Foe } from '../../src/sim/foes/foe';
import type { HazardState } from '../../src/sim/hazards/hazard';
import { createRng } from '../../src/sim/rng';
import { flyingBolt, SCENE_SHIP, sceneView } from '../helpers/botScene';
import { foeAt } from '../helpers/foeAt';

const DODGE_CHANCE = 0.6;
const TELEGRAPH_DODGE_CHANCE = 0.85;
const TRIALS = 1000;

/** What a trial puts on the field: first while the foe winds up (or not), then the threat it brings. */
interface Trial {
  readonly before: (view: BotView, id: number) => void;
  readonly threat: (view: BotView, id: number) => void;
}

/**
 * The share of `TRIALS` threats a pilot dodges: each trial shows `before` for two steps, then `threat`, in danger at
 * once with one choice held for three judgements, then a calm field. Each trial uses fresh ids, rising.
 */
function dodgeRate(pilot: Pilot, { before, threat }: Trial): number {
  const intent = idleIntent();
  let dodged = 0;
  for (let i = 0; i < TRIALS; i++) {
    const view = sceneView();
    before(view, 2 * i + 1);
    for (let step = 0; step < 2; step++) pilot.plan(view, intent);
    threat(view, 2 * i + 1);
    const choices = new Set<boolean>();
    for (let step = 0; step < 6; step++) choices.add(pilot.plan(view, intent).thrust);
    expect(choices.size).toBe(1);
    if (choices.has(true)) dodged++;
    for (let step = 0; step < 2; step++) pilot.plan(sceneView(), intent);
  }
  return dodged / TRIALS;
}

/** A gunship `id` far to the ship's left, out of reach, aiming or not. */
const gunship = (id: number, charging: boolean): Foe => foeAt('gunship', SCENE_SHIP.x - 300, SCENE_SHIP.y, { id, charging });

/** Gunship `owner`'s bolt, its id the next, 110 units to the ship's right and flying straight at it. */
const gunshipBolt = (owner: number): Bolt => ({ ...flyingBolt(owner + 1, SCENE_SHIP.x + 110, SCENE_SHIP.y, Math.PI), source: 'gunship', owner });

/** A gunship that winds up and then fires at the ship, as it does when its windup ends. */
const aimedShot = (charging: boolean): Trial => ({
  before: (view, id) => { view.foes = [gunship(id, charging)]; },
  threat: (view, id) => {
    view.foes = [gunship(id, false)];
    view.bolts = [gunshipBolt(id)];
  },
});

/** A mine `id` beside the ship, inside the reach the pilot keeps from one: armed, counting down, or not. */
const mine = (id: number, charging: boolean): Foe => foeAt('mine', SCENE_SHIP.x + 100, SCENE_SHIP.y, { id, charging });
const mineBeside = (charging: boolean): Trial => ({ before: () => undefined, threat: (view, id) => { view.foes = [mine(id, charging)]; } });

describe("the casual's foe telegraphs", () => {
  it("judges a gunship's bolt on the 85% roll drawn as its windup began, and a bolt with no windup seen on the episode's 60%", () => {
    expect(Math.abs(dodgeRate(createCasualPilot(createRng(21)), aimedShot(true)) - TELEGRAPH_DODGE_CHANCE)).toBeLessThan(0.04);
    expect(Math.abs(dodgeRate(createCasualPilot(createRng(21)), aimedShot(false)) - DODGE_CHANCE)).toBeLessThan(0.05);
  });

  it("dodges an armed mine at its windup's 85%, and a mine that has not armed at the episode's 60%", () => {
    expect(Math.abs(dodgeRate(createCasualPilot(createRng(23)), mineBeside(true)) - TELEGRAPH_DODGE_CHANCE)).toBeLessThan(0.04);
    expect(Math.abs(dodgeRate(createCasualPilot(createRng(23)), mineBeside(false)) - DODGE_CHANCE)).toBeLessThan(0.05);
  });

  it('always keeps clear of an active black hole: a hazard on show for over a minute is no surprise to roll for', () => {
    const hole: HazardState = { id: 99, type: 'blackHole', stage: 'active', x: SCENE_SHIP.x + 70, y: SCENE_SHIP.y, intensity: 1, remaining: 30 };
    const near: Trial = { before: () => undefined, threat: (view) => { view.hazards = [hole]; } };
    expect(dodgeRate(createCasualPilot(createRng(25)), near)).toBe(1);
  });

  it('leaves the expert dodging every one, drawing nothing from its stream', () => {
    const rng = createRng(27);
    const pilot = new Pilot({ rng });
    expect(dodgeRate(pilot, aimedShot(true))).toBe(1);
    expect(dodgeRate(pilot, mineBeside(true))).toBe(1);
    expect(rng.next()).toBe(createRng(27).next());
  });
});

describe("the expert's danger zones", () => {
  it('steers off an active zone it is drifting into even while it cannot be hurt, since the zone outlasts that', () => {
    const zone: HazardState = { id: 98, type: 'dangerZone', stage: 'active', x: SCENE_SHIP.x + 170, y: SCENE_SHIP.y, w: 120, h: 220, intensity: 1, remaining: 8 };
    const view = sceneView();
    view.ship = { ...view.ship, vx: 300, vy: 0, invulnerable: true, invulnerableFor: 3 };
    view.hazards = [zone];
    const intent = new Pilot({ rng: createRng(29) }).plan(view, idleIntent());
    expect(intent.thrust).toBe(true);
    expect(Math.cos(intent.heading ?? 0)).toBeLessThan(0);
  });
});
