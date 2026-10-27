import { STEP_SECONDS } from '../sim/config';
import type { Rng } from '../sim/rng';
import { Pilot } from './expert';
import { copyIntent, Hands, idleIntent, type Intent } from './hands';
import type { Bot } from './view';

/** How late a casual player acts on what it sees. */
export const REACTION_SECONDS = 0.3;
const DELAY_STEPS = Math.round(REACTION_SECONDS / STEP_SECONDS);
/** Radians a casual player's aim strays either way. */
const AIM_WOBBLE = 0.25;
/** The share of danger episodes a casual player dodges at all. */
const DODGE_CHANCE = 0.6;

/**
 * The casual's judgement: the expert's, with an aim that strays by up to ±0.25 rad (redrawn every 0.5 s) and a 60%
 * chance of dodging.
 *
 * The dodge is rolled once per danger episode, not per step or per threat. An episode starts when coasting would bring
 * a threat within 45 units over the look-ahead, and lasts until every threat is 70 units clear. One roll covers every
 * threat that passes during it: a casual that rolls "no" ignores the lot until the field calms, and one that rolls
 * "yes" dodges them all. Rolling every step would dodge nearly always.
 */
export function createCasualPilot(rng: Rng): Pilot {
  return new Pilot({ rng, dodgeChance: DODGE_CHANCE, aimWobble: AIM_WOBBLE });
}

/**
 * A casual player: the casual pilot's intents, acted on 0.3 s late through a delay line. An intent waiting in the line
 * is turned into controls against the ship as it is when it comes out, so a late turn still stops at its heading
 * rather than overshooting.
 */
export function createCasual(rng: Rng): Bot {
  const pilot = createCasualPilot(rng);
  const hands = new Hands();
  const line: Intent[] = Array.from({ length: DELAY_STEPS }, idleIntent);
  const due = idleIntent();
  let head = 0;
  return {
    decide(view) {
      const slot = line[head] as Intent;
      copyIntent(slot, due);
      pilot.plan(view, slot);
      head = (head + 1) % DELAY_STEPS;
      return hands.apply(due, view.ship.angle);
    },
  };
}
