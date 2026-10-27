import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { ASTEROID, FIELD_HEIGHT, MIN_ASPECT, PLAYER } from '../../src/sim/config';
import type { Asteroid } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';
import { hazardStreams, HazardField } from '../../src/sim/hazards/hazardField';
import { createShip } from '../../src/sim/ship';
import type { GalaxyId } from '../../src/content/types';
import { BOT_SEEDS } from '../helpers/botRuns';
import { auditFoeAttacks, auditTelegraphs, type FoeAttackPair, type TelegraphPair, type TimedEvent } from '../helpers/telegraphAudit';

/** Void Rift's survival galaxies, each played on the ten bot seeds. */
const VOID_RIFT: readonly GalaxyId[] = ['4-1', '4-2', '4-3', '4-4', '4-5'];
const TIMEOUT_MS = 600_000;

interface Played {
  readonly id: GalaxyId;
  readonly seed: number;
  readonly result: RunResult;
  readonly log: readonly TimedEvent[];
}

function play(profile: BotProfile): Played[] {
  return VOID_RIFT.flatMap((id) =>
    BOT_SEEDS.map((seed) => {
      const log: TimedEvent[] = [];
      const result = runGalaxy({
        galaxy: galaxyById(id),
        seed,
        profile,
        onStep: (world, _controls, events) => {
          for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
        },
      });
      return { id, seed, result, log };
    }),
  );
}

describe('Void Rift, played by the bots', { timeout: TIMEOUT_MS }, () => {
  let expert: Played[] = [];
  let casual: Played[] = [];
  beforeAll(() => {
    expert = play('expert');
    casual = play('casual');
  }, TIMEOUT_MS);

  it('is cleared by the expert on every seed of every survival galaxy, 4-1 to 4-5 (balance smoke)', () => {
    const lost = expert.filter((p) => !p.result.cleared).map((p) => `${p.id} seed ${String(p.seed)}`);
    expect(lost).toEqual([]);
  });

  it('meets every rift and repulsion field its schedule shows on every cleared expert run, 4-2 to 4-5', () => {
    for (const { id, seed, result, log } of expert) {
      if (!result.cleared) continue;
      // A rift shows a pair per intensity to two; a repulsion field one per event.
      const expected = galaxyById(id).events.reduce((sum, e) => sum + (e.type === 'warpRift' ? Math.min(e.intensity, 2) : e.type === 'repulsionField' ? 1 : 0), 0);
      expect(auditTelegraphs(log).length, `${id} seed ${String(seed)}`).toBe(expected);
    }
  });

  it('warns of every rift, repulsion field and phaser blink for its whole telegraph, as the expert and the casual play, and sees each new threat at work', () => {
    const telegraphs: TelegraphPair[] = [];
    const attacks: FoeAttackPair[] = [];
    const seen = new Map<string, number>();
    for (const { log } of [...expert, ...casual]) {
      telegraphs.push(...auditTelegraphs(log));
      attacks.push(...auditFoeAttacks(log));
      for (const { event } of log) seen.set(event.type, (seen.get(event.type) ?? 0) + 1);
    }
    expect(telegraphs.filter((p) => p.kind === 'warpRift').length).toBeGreaterThan(0);
    expect(telegraphs.filter((p) => p.kind === 'repulsionField').length).toBeGreaterThan(0);
    expect(attacks.filter((p) => p.kind === 'phaser').length).toBeGreaterThan(0);
    expect(seen.get('foeDeflected') ?? 0).toBeGreaterThan(0);
    expect(seen.get('riftJump') ?? 0).toBeGreaterThan(0);
  });
});

/** Carries a body for 2 s from every exit of every 4:3 configuration of 60 seeds: no body may jump twice in a quarter second. */
describe('warp rift strobe sweep, 4:3', { timeout: 600_000 }, () => {
  it('never carries a body through a second pair more than once in any quarter second, from every exit of 60 seeds at 4:3', () => {
    const field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
    const DT = 1 / 120;
    const RADII = [PLAYER.radius, 15, 40, ASTEROID.radii[0]];
    const QUARTER_SECOND_STEPS = 30;
    let rockId = 1000;
    for (let seed = 1; seed <= 60; seed++) {
      let id = 0;
      const ship = createShip(5, 5);
      ship.invulnerable = false;
      const hazards = new HazardField([{ at: 20, type: 'warpRift', intensity: 2 }], hazardStreams(seed), () => ++id);
      hazards.move(0, ship, [], [], []);
      hazards.step(22, field, []);
      const entries = hazards.states.flatMap((state) => (state.type === 'warpRift' ? [{ x: state.x, y: state.y }, { x: state.toX, y: state.toY }] : []));
      for (const entry of entries)
        for (const radius of RADII)
          for (let h = 0; h < 16; h++) {
            const angle = (h * 2 * Math.PI) / 16;
            const rock = { id: rockId++, x: entry.x, y: entry.y, px: entry.x, py: entry.y, vx: Math.cos(angle) * 100, vy: Math.sin(angle) * 100, radius, size: 0 } as unknown as Asteroid;
            const jumpSteps: number[] = [];
            for (let step = 0; step < 240; step++) {
              const out: SimEvent[] = [];
              hazards.step(22 + (step + 1) * DT, field, out);
              rock.px = rock.x;
              rock.py = rock.y;
              hazards.move(DT, ship, [rock], [], out);
              if (out.some((e) => e.type === 'riftJump' && !e.ship)) jumpSteps.push(step);
              rock.x += rock.vx * DT;
              rock.y += rock.vy * DT;
            }
            const gaps = jumpSteps.slice(1).map((step, i) => step - (jumpSteps[i] ?? 0));
            expect(Math.min(Infinity, ...gaps), `seed ${String(seed)} radius ${String(radius)} heading ${String(h)}`).toBeGreaterThanOrEqual(QUARTER_SECOND_STEPS);
          }
    }
  });
});

