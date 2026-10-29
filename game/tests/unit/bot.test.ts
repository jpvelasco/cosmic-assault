import { describe, expect, it } from 'vitest';
import type { BotProfile } from '../../src/bot/create';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import { World } from '../../src/sim/world';
import { copyControls, recordRun, REFERENCE_FIELD, replayControls } from '../helpers/botReplay';

const GALAXY = galaxyById('1-1');
const SECONDS = 20;

describe('bots', () => {
  it.each<BotProfile>(['statue', 'casual', 'expert'])('a %s run with the same seed gives the same result', (profile) => {
    const run = () => runGalaxy({ galaxy: GALAXY, seed: 7, profile, maxSeconds: SECONDS });
    expect(run()).toEqual(run());
  });

  it('a different seed gives a different expert run', () => {
    const run = (seed: number) => runGalaxy({ galaxy: GALAXY, seed, profile: 'expert', maxSeconds: SECONDS });
    expect(run(1)).not.toEqual(run(2));
  });

  it('the statue never sends input', () => {
    const sent: Controls[] = [];
    runGalaxy({ galaxy: GALAXY, seed: 3, profile: 'statue', maxSeconds: SECONDS, onStep: (_world, controls) => sent.push(copyControls(controls)) });
    expect(sent).toHaveLength(SECONDS / STEP_SECONDS);
    for (const controls of sent) expect(controls).toEqual(NO_CONTROLS);
  });

  it("a statue run steps the World exactly as no input does: bots never touch the World's streams", () => {
    const botEvents: SimEvent[] = [];
    runGalaxy({ galaxy: GALAXY, seed: 5, profile: 'statue', maxSeconds: SECONDS, onStep: (_world, _controls, events) => botEvents.push(...events.map((e) => ({ ...e }))) });
    const plain = new World({ seed: 5, field: REFERENCE_FIELD, rules: { kind: 'galaxy', galaxy: GALAXY, mode: 'free' } });
    const plainEvents: SimEvent[] = [];
    for (let i = 0; i < SECONDS / STEP_SECONDS; i++) plainEvents.push(...plain.step(STEP_SECONDS, NO_CONTROLS).map((e) => ({ ...e })));
    expect(botEvents.length).toBeGreaterThan(0);
    expect(botEvents).toEqual(plainEvents);
  });

  it.each<BotProfile>(['casual', 'expert'])('a %s bot reaches the World only through its controls: replaying them replays the run', (profile) => {
    const { result, controls, events } = recordRun({ galaxy: GALAXY, seed: 9, profile, maxSeconds: SECONDS });
    const replayed = replayControls(GALAXY, 9, controls);
    expect(controls.some((c) => c.fire)).toBe(true);
    expect(replayed.events).toEqual(events);
    expect(replayed.score).toBe(result.score);
  });

  it('replays a boss fight exactly: the expert against the Warden on 3-6, from the same seed and from its own controls', () => {
    const galaxy = galaxyById('3-6');
    const options = { galaxy, seed: 1, profile: 'expert', maxSeconds: 120 } as const;
    const { result, controls, events } = recordRun(options);
    expect(result.bossKillTime).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'bossWindup' && e.attack === 'lockOn')).toBe(true);
    expect(runGalaxy(options)).toEqual(result);
    const replayed = replayControls(galaxy, 1, controls);
    expect(replayed.events).toEqual(events);
    expect(replayed.score).toBe(result.score);
  }, 30_000);

  it('plays on a wider field when given an aspect', () => {
    const sizes: number[] = [];
    runGalaxy({ galaxy: GALAXY, seed: 1, profile: 'statue', maxSeconds: 1, aspect: 2, onStep: (world) => sizes.push(world.field.width) });
    expect(new Set(sizes)).toEqual(new Set([1440]));
  });

  it('refuses an aspect the game never plays at, saying which it takes', () => {
    expect(() => runGalaxy({ galaxy: GALAXY, seed: 1, profile: 'statue', aspect: 1 })).toThrow(/aspect/);
  });

  it('a statue loses lives and reports what a lost run scored', () => {
    const result = runGalaxy({ galaxy: galaxyById('1-3'), seed: 2, profile: 'statue' });
    expect(result.cleared).toBe(result.deaths < 3);
    expect(result.livesLost).toBe(result.deaths);
    expect(result.stars).toBe(result.cleared ? 3 - Math.min(2, result.deaths) : 0);
    expect(result.bossKillTime).toBeUndefined();
  });
});
