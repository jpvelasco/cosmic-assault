import { describe, expect, it } from 'vitest';
import { Pilot } from '../../src/bot/expert';
import { idleIntent, type Intent } from '../../src/bot/hands';
import type { BotView } from '../../src/bot/view';
import type { BossView } from '../../src/sim/boss/behaviour';
import { createRng } from '../../src/sim/rng';
import { wrapDelta } from '../../src/sim/wrap';
import { SCENE_SHIP, sceneView, stage, stillRock, threatOf, type Staged } from '../helpers/botScene';

/** The pilot's intent on the step `seconds` after its first look at `view`, which it watches throughout. */
function after(view: BotView, seconds: number): Intent {
  const pilot = new Pilot({ rng: createRng(1) });
  const intent = idleIntent();
  pilot.plan(view, intent);
  view.elapsed += seconds;
  pilot.plan(view, intent);
  pilot.plan(view, intent);
  return intent;
}

describe('the expert pilot against a boss', () => {
  it('holds its fire while nowhere on the boss can be hurt and nothing else is left to shoot', () => {
    const view = stage(sceneView(), { id: 'hiveCarrier', at: { x: 640, y: 108 }, radius: 100, target: null });
    expect(after(view, 0).fire).toBe(false);
    view.boss = { ...(view.boss as BossView), vulnerable: true, target: { x: 640, y: 193 } };
    view.ship = { ...view.ship, angle: -Math.PI / 2 };
    expect(after(view, 0).fire).toBe(true);
  });

  it('fires at a boss only with its nose on the lead, so that no shot is spent turning toward it', () => {
    const view = stage(sceneView(), { id: 'hiveCarrier', at: { x: 640, y: 108 }, radius: 100, target: { x: 640, y: 193 } });
    view.ship = { ...view.ship, angle: -Math.PI / 2 + 0.5 };
    expect(after(view, 0).fire).toBe(false);
  });

  it("keeps out of the lane of an attack aimed at where it was, and stays put for one that is not", () => {
    const lunge = stage(sceneView(), { id: 'sentinel', at: { x: 640, y: 150 }, radius: 70, windup: 'lunge' });
    expect(after(lunge, 0).thrust).toBe(true);
    for (const windup of ['launch', 'broadside', 'quake', 'pulse'] as const) {
      expect(after(stage(sceneView(), { id: 'sentinel', at: { x: 640, y: 150 }, radius: 70, windup }), 0).thrust, windup).toBe(false);
    }
  });

  it("keeps only as far from a shard volley's line as its shards reach, not a whole core's width", () => {
    // The volley is aimed where the ship was as its windup began, seen here between runs; then the ship stands 120 to the side.
    const strafed = (x: number): Intent => {
      const view = stage(sceneView(), { windup: 'shardVolley' });
      const pilot = new Pilot({ rng: createRng(1) });
      const intent = idleIntent();
      view.ship = { ...view.ship, y: 400 };
      view.status = 'warping';
      pilot.plan(view, intent);
      view.status = 'playing';
      view.ship = { ...view.ship, x };
      pilot.plan(view, intent);
      return pilot.plan(view, intent);
    };
    expect(strafed(640).thrust).toBe(true);
    expect(strafed(640 + 120).thrust).toBe(false);
  });

  it("sees a pulse's shove coming and gets clear of the rock it would throw the ship onto", () => {
    const rock = stillRock(SCENE_SHIP.x, SCENE_SHIP.y + 90);
    const late = threatOf('pulse').windup - 0.1;
    expect(after(stage(sceneView([rock]), {}), late).thrust).toBe(false);
    expect(after(stage(sceneView([rock]), { windup: 'pulse' }), late).thrust).toBe(true);
  });

  it("lets a boss's own rocks, which fly straight, pass closer than the field's before it dodges", () => {
    const passing = { x: SCENE_SHIP.x + 80, y: SCENE_SHIP.y + 40, size: 3, angle: Math.PI, speedMultiplier: 1 } as const;
    const boss: Staged = { at: { x: 640, y: 100 } };
    const fieldRock = stage(sceneView([passing]), boss);
    expect(after(fieldRock, 0).thrust).toBe(true);
    const bossRock = stage(sceneView([passing]), boss);
    bossRock.asteroids = bossRock.asteroids.map((rock) => ({ ...rock, transient: true }));
    expect(after(bossRock, 0).thrust).toBe(false);
  });

  it('closes in on a boss out of range, toward the side it faces, by the shortest way', () => {
    const view = stage(sceneView(), { id: 'hiveCarrier', at: { x: 1100, y: 108 }, radius: 100, target: null });
    view.ship = { ...view.ship, x: 100, y: 650 };
    const intent = after(view, 0);
    expect(intent.thrust).toBe(true);
    const station = { x: 1100, y: 108 + 300 };
    expect(intent.heading).toBeCloseTo(Math.atan2(wrapDelta(station.y - 650, 720), wrapDelta(station.x - 100, 1280)), 6);
  });
});
