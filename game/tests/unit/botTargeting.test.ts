import { describe, expect, it } from 'vitest';
import { createCasual, REACTION_SECONDS } from '../../src/bot/casual';
import { chooseTarget, leadHeading, type Target } from '../../src/bot/targeting';
import { createView, readView, type BotView } from '../../src/bot/view';
import { galaxyById } from '../../src/content/galaxies';
import type { FoeKind } from '../../src/content/types';
import type { BossPart, BossView, Point } from '../../src/sim/boss/behaviour';
import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { Foe } from '../../src/sim/foes/foe';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { bossView } from '../helpers/bossView';
import { SCENE_FIELD, sceneView, stillRock } from '../helpers/botScene';

function foe(kind: FoeKind, x: number, y: number): Foe {
  return { id: 0, kind, x, y, vx: 0, vy: 0, px: x, py: y, rotation: 0, protation: 0, spin: 0, radius: 12, hp: 1, fromAttack: false };
}

function part(x: number, y: number, hp: number): BossPart {
  return { x, y, px: x, py: y, radius: 15, hp, maxHp: 2 };
}

/** A boss whose behaviour names `target` as where a shot does harm, its core open to harm just when there is one. */
function boss(target: Point | null, state: BossView['state'] = 'fighting', parts: readonly BossPart[] = []): BossView {
  return bossView({ state, vulnerable: target !== null, parts, target });
}

const target = (): Target => ({ x: 0, y: 0, vx: 0, vy: 0, wraps: true });

function chosen(view: BotView): Target | null {
  const out = target();
  return chooseTarget(view, out) ? out : null;
}

describe('bot targeting', () => {
  it('chooses nothing on an empty field', () => {
    expect(chosen(sceneView())).toBeNull();
  });

  it('shoots a drone before a nearer rock, and a near rock before a far splitter', () => {
    const view = sceneView([stillRock(740, 360)]);
    view.foes = [foe('drone', 640, 660)];
    expect(chosen(view)).toMatchObject({ x: 640, y: 660 });
    view.foes = [foe('splitter', 1100, 360)];
    expect(chosen(view)).toMatchObject({ x: 740, y: 360 });
  });

  it('aims where its boss says a shot does harm, off the core included, and at none of it outside the fight', () => {
    const view = sceneView();
    view.boss = boss({ x: 640, y: 160 });
    expect(chosen(view)).toMatchObject({ x: 640, y: 160 });
    view.boss = boss(null);
    expect(chosen(view)).toBeNull();
    view.boss = boss({ x: 640, y: 100 }, 'intro');
    expect(chosen(view)).toBeNull();
  });

  it('chips the nearest live part off a shielded core, and goes for the core once it is bare', () => {
    const view = sceneView();
    const parts = [part(300, 100, 2), part(660, 290, 0), part(700, 220, 2)];
    view.boss = boss(null, 'fighting', parts);
    expect(chosen(view)).toMatchObject({ x: 700, y: 220 });
    view.boss = boss({ x: 640, y: 100 }, 'fighting', parts);
    expect(chosen(view)).toMatchObject({ x: 640, y: 100 });
  });

  it('passes over an armoured part for the nearest one a shot can hurt', () => {
    const view = sceneView();
    const parts = [part(300, 100, 2), { ...part(700, 220, 2), armoured: true }];
    view.boss = boss(null, 'fighting', parts);
    expect(chosen(view)).toMatchObject({ x: 300, y: 100 });
  });

  it('goes for an open core only along a clear line: a part in the way with HP to spare sends it to the nearest part a shot can hurt', () => {
    const view = sceneView();
    // The ship at (640, 360); the core straight above it, and a turret on the line between, 100 above the ship.
    const blocker = part(640, 260, 3);
    const aside = part(900, 200, 3);
    view.boss = boss({ x: 640, y: 100 }, 'fighting', [blocker, aside]);
    expect(chosen(view)).toMatchObject({ x: 640, y: 260 });
    // Off the line, the part no longer blocks: the core again.
    blocker.x = 760;
    expect(chosen(view)).toMatchObject({ x: 640, y: 100 });
    // A part beyond the core, or a broken one on the line, never blocks.
    view.boss = boss({ x: 640, y: 100 }, 'fighting', [part(640, 40, 3), part(640, 260, 0)]);
    expect(chosen(view)).toMatchObject({ x: 640, y: 100 });
  });

  it('shoots through a part in the line that one shot breaks, since that shot clears the way', () => {
    const view = sceneView();
    view.boss = boss({ x: 640, y: 100 }, 'fighting', [part(640, 260, 1), part(400, 200, 3)]);
    expect(chosen(view)).toMatchObject({ x: 640, y: 100 });
  });

  it('passes an armoured part on the line too, for the nearest part a shot can hurt', () => {
    const view = sceneView();
    view.boss = boss({ x: 640, y: 100 }, 'fighting', [{ ...part(640, 260, 3), armoured: true }, part(400, 200, 3)]);
    expect(chosen(view)).toMatchObject({ x: 400, y: 200 });
  });

  it('leads a weak point that is a part by the part\'s own motion, not the core\'s', () => {
    const view = sceneView();
    const tail = { ...part(900, 200, 3), px: 900 - 0.5, py: 200 };
    view.boss = { ...boss(null, 'fighting', [tail]), vulnerable: true, target: tail, px: 640, py: 100 - 1 };
    expect(chosen(view)).toMatchObject({ x: 900, y: 200 });
    const out = target();
    chooseTarget(view, out);
    expect(out.vx).toBeCloseTo(0.5 / STEP_SECONDS, 6);
    expect(out.vy).toBeCloseTo(0, 9);
  });

  it("leads a boss's weak point by its core's motion", () => {
    const view = sceneView();
    view.boss = { ...boss({ x: 640, y: 185 }), px: 640 - 40 * STEP_SECONDS };
    expect(chosen(view)).toMatchObject({ x: 640, y: 185, vx: expect.closeTo(40, 6) as number, vy: 0 });
  });

  it("aims at a boss's weak point across the field, never across the wrap, where its hull would turn the shot", () => {
    const view = sceneView();
    view.ship = { ...view.ship, y: 650 };
    view.boss = boss({ x: 640, y: 185 });
    const out = target();
    expect(chooseTarget(view, out)).toBe(true);
    expect(leadHeading(view, out)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('leads a crossing target so a shot meets it, and aims across the wrap', () => {
    const view = sceneView();
    const crossing = { x: 640 + 450, y: 360, vx: 0, vy: 225, wraps: true };
    const heading = leadHeading(view, crossing);
    const t = 450 / (PLAYER.projectileSpeed * Math.cos(heading));
    expect(Math.sin(heading) * PLAYER.projectileSpeed * t).toBeCloseTo(225 * t, 6);
    const acrossEdge = { x: 20, y: 360, vx: 0, vy: 0, wraps: true };
    view.ship = { ...view.ship, x: 1260 };
    expect(leadHeading(view, acrossEdge)).toBeCloseTo(0, 9);
  });
});

describe('the casual bot', () => {
  it('acts 0.3 s late: its first decisions send nothing', () => {
    const galaxy = galaxyById('1-1');
    // A rock in reach gives it something to shoot from the first step.
    const world = new World({ seed: 2, field: SCENE_FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' }, initialAsteroids: [stillRock(900, 360)] });
    const bot = createCasual(createRng(1));
    const view = createView(world);
    const delay = Math.round(REACTION_SECONDS / STEP_SECONDS);
    let firstInput = -1;
    for (let i = 0; i < 2 * delay && firstInput < 0; i++) {
      const controls = bot.decide(readView(world, view));
      if (controls.fire || controls.turn !== 0 || controls.stick !== null) firstInput = i;
      world.step(STEP_SECONDS, controls);
    }
    expect(firstInput).toBe(delay);
  });
});
