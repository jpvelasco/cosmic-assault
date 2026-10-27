import { describe, expect, it } from 'vitest';
import { createExpert } from '../../src/bot/expert';
import { createView, readView } from '../../src/bot/view';
import { BLACK_HOLE } from '../../src/content/hazards';
import { galaxyById } from '../../src/content/galaxies';
import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';

const FIELD = { width: 1280, height: 720 };
const CENTRE = { x: FIELD.width / 2, y: FIELD.height / 2 };
const HOLE_AT = 12;
const CONTACT = BLACK_HOLE.horizon + PLAYER.radius;

/** A Singularity run of 5-1 with the ship parked at (x, y) and held there, unhurt, until `seconds`. */
function parked(seconds: number, x: number, y: number): World {
  const world = new World({ seed: 1, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById('5-1'), mode: 'free' } });
  while (world.elapsed < seconds) {
    Object.assign(world['shipState'], { x, y, vx: 0, vy: 0, invulnerable: true, invulnerableFor: 1 });
    world.step(STEP_SECONDS, NO_CONTROLS);
  }
  return world;
}

const distance = (world: World): number => Math.hypot(world.ship.x - CENTRE.x, world.ship.y - CENTRE.y);

describe('the expert near a black hole', () => {
  it('thrusts away once an active hole is within 260 units of it, and gets clear of that range', () => {
    const world = parked(HOLE_AT - 0.5, CENTRE.x + 200, CENTRE.y);
    const bot = createExpert(createRng(1));
    const view = createView(world);
    const deaths = world.deaths;
    let thrusting = 0;
    while (world.elapsed < HOLE_AT + 3) {
      const controls = bot.decide(readView(world, view));
      // The expert thrusts on the stick, at full: a stick held toward its heading.
      if (controls.stick !== null) thrusting++;
      world.step(STEP_SECONDS, controls);
    }
    expect(world.deaths).toBe(deaths);
    expect(thrusting).toBeGreaterThan(0);
    expect(distance(world)).toBeGreaterThan(260);
  });

  it('keeps out of the horizon: from 120 units out, facing the hole and at rest, it is never touched', () => {
    const world = parked(HOLE_AT - 0.5, CENTRE.x + 120, CENTRE.y);
    const bot = createExpert(createRng(1));
    const view = createView(world);
    let closest = Infinity;
    while (world.elapsed < HOLE_AT + 6 && world.status === 'playing') {
      world.step(STEP_SECONDS, bot.decide(readView(world, view)));
      if (world.elapsed > HOLE_AT) closest = Math.min(closest, distance(world));
    }
    expect(world.status).toBe('playing');
    expect(closest).toBeGreaterThanOrEqual(CONTACT);
  });
});
