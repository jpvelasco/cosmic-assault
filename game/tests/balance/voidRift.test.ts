import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
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
