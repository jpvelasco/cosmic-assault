import { describe, expect, it } from 'vitest';
import { Pilot } from '../../src/bot/expert';
import { idleIntent, type Intent } from '../../src/bot/hands';
import { createView, readView, type BotView } from '../../src/bot/view';
import { MINE } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyEvent } from '../../src/content/types';
import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { ZoneState } from '../../src/sim/hazards/hazard';
import { HazardField } from '../../src/sim/hazards/hazardField';
import { shipPullAt } from '../../src/sim/hazards/shipPull';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { flyingBolt, SCENE_FIELD, SCENE_SHIP, sceneView } from '../helpers/botScene';
import { foeAt } from '../helpers/foeAt';
import { MUTED_KINDS } from '../helpers/mute';

/** The pilot's intent after two looks at `view`. */
function decide(view: BotView): Intent {
  const pilot = new Pilot({ rng: createRng(1) });
  const intent = idleIntent();
  pilot.plan(view, intent);
  pilot.plan(view, intent);
  return intent;
}

/** A zone `w` by `h` centred on (x, y), at `stage` with `remaining` seconds to its next change. */
const zone = (x: number, y: number, stage: ZoneState['stage'], remaining: number, w = 120, h = 120): ZoneState => ({ id: 50, type: 'dangerZone', stage, x, y, w, h, intensity: 1, remaining });

describe('the expert in Crimson Nebula', () => {
  const ARM = MINE.armRadius + PLAYER.radius;

  it("keeps 20 clear of a mine's arm ring, and minds one well clear of it no more than a rock", () => {
    const near = sceneView();
    near.foes = [foeAt('mine', SCENE_SHIP.x + ARM + 20 + 10, SCENE_SHIP.y, { id: 70 })];
    expect(decide(near).thrust).toBe(true);
    const far = sceneView();
    far.foes = [foeAt('mine', SCENE_SHIP.x + ARM + 20 + 60, SCENE_SHIP.y, { id: 71 })];
    expect(decide(far).thrust).toBe(false);
  });

  it('shoots a mine from range, its nose on it', () => {
    const view = sceneView();
    view.foes = [foeAt('mine', SCENE_SHIP.x + 400, SCENE_SHIP.y, { id: 72 })];
    const intent = decide(view);
    expect(intent.fire).toBe(true);
    expect(intent.heading).toBeCloseTo(0, 6);
  });

  it('keeps out of an active zone and one within 1 s of starting, but not one that starts later', () => {
    // The zone's left side sits 30 from the ship's edge.
    const edge = SCENE_SHIP.x + PLAYER.radius + 30 + 60;
    for (const [stage, remaining, dodges] of [['active', 5, true], ['warning', 0.8, true], ['warning', 1.5, false]] as const) {
      const view = sceneView();
      view.hazards = [zone(edge, SCENE_SHIP.y, stage, remaining)];
      expect(decide(view).thrust, `${stage} ${String(remaining)} s`).toBe(dodges);
    }
  });

  it('leaves an active zone it finds itself in by the nearest way out', () => {
    const view = sceneView();
    view.hazards = [zone(SCENE_SHIP.x + 40, SCENE_SHIP.y, 'active', 5, 200, 400)];
    const intent = decide(view);
    expect(intent.thrust).toBe(true);
    expect(Math.cos(intent.heading ?? 0)).toBeLessThan(0);
  });

  it('ignores a bolt flying out past the far edge: bolts never wrap, so it is no threat from across the seam (Task 3 N-3)', () => {
    const view = sceneView();
    view.ship = { ...view.ship, x: 20 };
    view.bolts = [flyingBolt(80, SCENE_FIELD.width - 20, SCENE_SHIP.y, 0)];
    expect(decide(view).thrust).toBe(false);
    // The same bolt on the ship's side of the seam, flying at it, is dodged.
    view.bolts = [flyingBolt(81, 20 + 140, SCENE_SHIP.y, Math.PI)];
    expect(decide(view).thrust).toBe(true);
  });
});

describe("the expert's prediction of a hazard's pull (Task 1 N-1)", () => {
  const well = (at: number, type: GalaxyEvent['type'] = 'gravityWell'): GalaxyEvent => ({ at, type, intensity: 3 });

  /** The ship's velocity change over one step of `world`'s hazards, as the sim applies it, per second: the acceleration. */
  function simPull(world: World): { x: number; y: number } {
    const hazards = world['run']?.['hazards'] as HazardField;
    const ship = { ...world.ship };
    hazards.move(STEP_SECONDS, ship, [], []);
    return { x: (ship.vx - world.ship.vx) / STEP_SECONDS, y: (ship.vy - world.ship.vy) / STEP_SECONDS };
  }

  it.each([
    ['one well', [well(3)]],
    ['a well and a repulsion field at once, summed and capped', [well(3), well(3.5, 'repulsionField')]],
  ])('predicts with exactly the pull the sim applies: %s', (_name, events) => {
    const galaxy = { ...galaxyById('2-2'), kinds: MUTED_KINDS, events };
    const world = new World({ seed: 4, field: SCENE_FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' } });
    while (world.hazards.filter((h) => h.stage === 'active').length < events.length) world.step(STEP_SECONDS, NO_CONTROLS);
    // Off the centre, so the fields have a direction to pull in.
    Object.assign(world['shipState'], { x: 300, y: 200, vx: 0, vy: 0 });
    const view = readView(world, createView(world));
    const pilot = new Pilot({ rng: createRng(1) });
    pilot['predictShip'](view, null);
    const predicted = pilot['pull'];
    const applied = simPull(world);
    expect(Math.hypot(applied.x, applied.y)).toBeGreaterThan(0);
    expect(predicted.x).toBeCloseTo(applied.x, 6);
    expect(predicted.y).toBeCloseTo(applied.y, 6);
    expect(predicted).toEqual(shipPullAt(world.hazards, 300, 200, 1, { x: 0, y: 0 }));
  });
});
