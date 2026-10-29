import type { GalaxyDef } from '../content/types';
import { FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, STEP_SECONDS } from '../sim/config';
import type { Controls } from '../sim/controls';
import type { SimEvent } from '../sim/events';
import type { Field } from '../sim/field';
import type { GalaxyMode, Stars } from '../sim/scoring';
import { hasEnded, World } from '../sim/world';
import { createBot, type BotProfile } from './create';
import { createView, readView } from './view';

/** The 1280×720 reference field. */
const REFERENCE_ASPECT = 16 / 9;
/** How long past its timer a survival galaxy may run (its warp lasts 1.5 s), and how long a boss fight may last. */
const SURVIVAL_OVERRUN_SECONDS = 5;
const BOSS_FIGHT_SECONDS = 300;

export interface RunOptions {
  readonly galaxy: GalaxyDef;
  readonly seed: number;
  readonly profile: BotProfile;
  /** 'rank', 'free' or 'daily'; defaults to 'free'. */
  readonly mode?: GalaxyMode;
  /** Rank only, 1–5; Free play and the Daily always start with 3. */
  readonly startLives?: number;
  /** When to give up on a run still going; past its timer by a little for a survival galaxy, 300 s of fight for a boss one. */
  readonly maxSeconds?: number;
  /** The field's width over its 720-unit height, from 4:3 to 21:9; defaults to 16:9, the 1280×720 reference. */
  readonly aspect?: number;
  /** Sees every step: the World after it, the controls it took and its events, valid until the next step. */
  readonly onStep?: (world: World, controls: Controls, events: readonly SimEvent[]) => void;
}

export interface RunResult {
  readonly cleared: boolean;
  /** Seconds into the run it was cleared (as the warp began), lost, or given up on. */
  readonly time: number;
  readonly deaths: number;
  /** 0 for a run not cleared. */
  readonly stars: Stars | 0;
  /** The final score, with any clear bonus. */
  readonly score: number;
  /** Lives the run ended with fewer than it started with; a Shield's save costs none. */
  readonly livesLost: number;
  /** Seconds from the boss's arrival to the blow that beat it, for a boss galaxy won. */
  readonly bossKillTime?: number;
}

function fieldFor(aspect: number): Field {
  if (!(aspect >= MIN_ASPECT && aspect <= MAX_ASPECT)) {
    throw new RangeError(`runGalaxy() needs an aspect from 4:3 to 21:9, as the game plays at (got ${String(aspect)}); omit it for the 16:9 reference field`);
  }
  return { width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT };
}

/** Plays one galaxy with a bot, headless: no DOM and no drawing, just the World stepped at the fixed 1/120 s. */
export function runGalaxy(options: RunOptions): RunResult {
  const { galaxy, seed, profile, mode = 'free', startLives, onStep } = options;
  const maxSeconds = options.maxSeconds ?? galaxy.duration + (galaxy.kind === 'boss' ? BOSS_FIGHT_SECONDS : SURVIVAL_OVERRUN_SECONDS);
  const world = new World({ seed, field: fieldFor(options.aspect ?? REFERENCE_ASPECT), rules: { kind: 'galaxy', galaxy, mode }, ...(startLives === undefined ? {} : { startLives }) });
  const startedWith = world.lives;
  const bot = createBot(profile, seed);
  const view = createView(world);
  const maxSteps = Math.round(maxSeconds / STEP_SECONDS);
  let clearedAt: number | null = null;
  let stars: Stars | 0 = 0;
  let bossAt: number | null = null;
  for (let i = 0; i < maxSteps && !hasEnded(world.status); i++) {
    const controls = bot.decide(readView(world, view));
    const events = world.step(STEP_SECONDS, controls);
    for (const event of events) {
      if (event.type === 'bossIntro') bossAt = world.elapsed;
      else if (event.type === 'galaxyCleared') {
        clearedAt = world.elapsed;
        stars = event.stars;
      }
    }
    onStep?.(world, controls, events);
  }
  const result = { cleared: clearedAt !== null, time: clearedAt ?? world.elapsed, deaths: world.deaths, stars, score: world.score, livesLost: startedWith - world.lives };
  return clearedAt !== null && bossAt !== null ? { ...result, bossKillTime: clearedAt - bossAt } : result;
}
