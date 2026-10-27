import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import { World, type WorldStatus } from '../../src/sim/world';
import { practiceScript } from './practiceLog';

/** The galaxies whose play the digests pin: every one of Dimensions 1 and 2. */
export const DIGEST_GALAXIES: readonly GalaxyId[] = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '2-1', '2-2', '2-3', '2-4', '2-5', '2-6'];
export const DIGEST_SEEDS: readonly number[] = [1, 2, 3];
/** Longer than any D1–D2 galaxy lasts, so a run ends cleared or lost well before it. */
const MAX_SECONDS = 240;
const FIELD = { width: 1280, height: 720 };

/**
 * Fields added to an event since M5 that label it without changing what happens: a well event's hazard `kind`, which
 * is always `'gravityWell'` in Dimensions 1–2, and a well warning's `id`, the id its `wellStart` already carries. The
 * digest leaves them out, so it pins what happens, not how the events are labelled.
 */
const LABELS: Partial<Record<SimEvent['type'], readonly string[]>> = {
  wellWarning: ['kind', 'id'],
  wellStart: ['kind'],
  wellEnd: ['kind'],
};

/** `event` as one line of text: its fields in key order, labels left out, numbers written exactly. */
export function canonicalEvent(event: SimEvent): string {
  const skip = LABELS[event.type] ?? [];
  const fields = Object.entries(event).filter(([key]) => !skip.includes(key));
  fields.sort(([a], [b]) => (a < b ? -1 : 1));
  return fields.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
}

/**
 * Plays a Free play run of `id` on seed `seed` under the practice log's fixed input schedule until it is cleared or
 * lost, handing each step's events to `onStep` (valid until the next step), and returns the World.
 */
export function playScripted(id: GalaxyId, seed: number, onStep: (world: World, events: readonly SimEvent[], step: number) => void): World {
  const world = new World({ seed, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById(id), mode: 'free' } });
  for (let step = 0; step < MAX_SECONDS / STEP_SECONDS && world.status !== 'cleared' && world.status !== 'gameOver'; step++) {
    onStep(world, world.step(STEP_SECONDS, practiceScript(step)), step);
  }
  return world;
}

/**
 * Plays `id` on seed `seed` with the expert bot, as the balance suite does, to the run's end (it clears every D1–D2
 * galaxy), handing each step's events to `onStep`, and returns the World.
 */
export function playExpert(id: GalaxyId, seed: number, onStep: (world: World, events: readonly SimEvent[], step: number) => void): World {
  let last = null as World | null;
  let step = 0;
  runGalaxy({
    galaxy: galaxyById(id),
    seed,
    profile: 'expert',
    onStep: (world, _controls, events) => {
      last = world;
      onStep(world, events, step++);
    },
  });
  if (last === null) throw new Error(`the expert's run of ${id} on seed ${String(seed)} took no step`);
  return last;
}

/** The two inputs the digests are played under: the fixed schedule, and the expert bot, which plays every galaxy to its end. */
export const DIGEST_INPUTS = { scripted: playScripted, expert: playExpert } as const;
export type DigestInput = keyof typeof DIGEST_INPUTS;

export interface DigestRun {
  /** The sha-256 of every event, tagged with its step, then the final score, lives, status and elapsed time. */
  readonly digest: string;
  readonly status: WorldStatus;
  /** Every event type the run logged, for the tests that keep the digests' coverage from eroding. */
  readonly types: ReadonlySet<SimEvent['type']>;
}

export function digestRun(input: DigestInput, id: GalaxyId, seed: number): DigestRun {
  const hash = createHash('sha256');
  const types = new Set<SimEvent['type']>();
  const world = DIGEST_INPUTS[input](id, seed, (_world, events, step) => {
    for (const event of events) {
      types.add(event.type);
      hash.update(`${String(step)} ${canonicalEvent(event)}\n`);
    }
  });
  hash.update(`end score=${String(world.score)} lives=${String(world.lives)} status=${world.status} elapsed=${String(world.elapsed)}\n`);
  return { digest: hash.digest('hex'), status: world.status, types };
}

export const digestKey = (id: GalaxyId, seed: number): string => `${id} seed ${String(seed)}`;

/** Every run under `input`, keyed `'<galaxy> seed <n>'`. */
export function digestRuns(input: DigestInput): Record<string, DigestRun> {
  return Object.fromEntries(DIGEST_GALAXIES.flatMap((id) => DIGEST_SEEDS.map((seed) => [digestKey(id, seed), digestRun(input, id, seed)])));
}

/** Just the digests of `digestRuns(input)`, as the fixture holds them. */
export const digestsOf = (runs: Readonly<Record<string, DigestRun>>): Record<string, string> => Object.fromEntries(Object.entries(runs).map(([key, run]) => [key, run.digest]));

interface DigestFixture {
  readonly recordedAt: string;
  readonly digests: Readonly<Record<DigestInput, Readonly<Record<string, string>>>>;
}

const FIXTURE_URL = new URL('../fixtures/d1-d2-digests.json', import.meta.url);
/** The expert plays 36 whole galaxies; a loaded CI runner needs more than Vitest's 5 s default. */
const PLAY_TIMEOUT_MS = 120_000;

/**
 * Pins every D1–D2 run under `input` to the fixture, event for event, and hands the runs to `more` for that input's
 * coverage tests. Recording is a ruling's call, never a fix for a failing digest: run the file with
 * `RECORD_D1D2_DIGESTS='<ruling or commit>'` to rewrite `input`'s digests, leaving the other input's as they are.
 */
export function describeDigests(input: DigestInput, more: (runs: () => Readonly<Record<string, DigestRun>>) => void = () => undefined): void {
  const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as DigestFixture;
  const recorded = fixture.digests[input];
  let runs: Record<string, DigestRun> = {};

  describe(`Dimensions 1 and 2 do not move under the ${input} input`, () => {
    beforeAll(() => {
      runs = digestRuns(input);
      const label = process.env.RECORD_D1D2_DIGESTS;
      if (label !== undefined && label !== '') {
        const digests = { ...fixture.digests, [input]: digestsOf(runs) };
        writeFileSync(FIXTURE_URL, `${JSON.stringify({ recordedAt: label, digests }, null, 2)}\n`);
      }
    }, PLAY_TIMEOUT_MS);

    it('covers every D1–D2 galaxy on seeds 1–3', () => {
      const keys = DIGEST_GALAXIES.flatMap((id) => DIGEST_SEEDS.map((seed) => digestKey(id, seed)));
      expect(keys).toHaveLength(36);
      expect(Object.keys(recorded)).toEqual(keys);
      expect(Object.keys(runs)).toEqual(keys);
    });

    it.each(Object.keys(recorded))(`plays %s event for event as recorded at the M5 tip`, (key) => {
      expect(runs[key]?.digest, `${input} ${key} moved: a change has altered D1–D2 play; find it, or get a ruling to re-record the digests`).toBe(recorded[key]);
    });

    more(() => runs);
  });
}
