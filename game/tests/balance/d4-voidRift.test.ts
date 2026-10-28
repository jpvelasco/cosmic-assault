import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { FIELD_HEIGHT, MIN_ASPECT } from '../../src/sim/config';
import type { GalaxyId } from '../../src/content/types';
import { BOT_SEEDS } from '../helpers/botRuns';
import { QUARTER_SECOND_STEPS, strobeGaps } from '../helpers/riftStrobe';
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
    for (let seed = 1; seed <= 60; seed++) for (const { where, gap } of strobeGaps(seed, field)) expect(gap, where).toBeGreaterThanOrEqual(QUARTER_SECOND_STEPS);
  });
});

