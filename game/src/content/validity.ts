import { eventSeconds, warningSeconds } from './curves';
import { FOES } from './foes';
import { HAZARD_RULES, pullsShip } from './hazards';
import { lullStart, OPENING_SECONDS } from './pacingRules';
import { isPickupId, PICKUPS } from './pickups';
import { galaxyIdOf, type FoeKind, type GalaxyDef, type GalaxyEvent, type ThreatKind } from './types';

/** Seconds each scheduled event starts after the one before it, so no two arrive together. */
export const EVENT_SPACING_SECONDS = 10;
/** The most scheduled events running at once, showers included, each from its warning to its end. */
export const MAX_EVENTS_AT_ONCE = 2;
/** A gravity storm's intensities: a third would place no more wells than the second. */
export const STORM_INTENSITIES: readonly GalaxyEvent['intensity'][] = [1, 2];

const s = (seconds: number): string => `${String(seconds)} s`;
const named = (e: GalaxyEvent): string => `${e.type} at ${s(e.at)}`;
const warnedAt = (e: GalaxyEvent): number => e.at - warningSeconds(e);
const endsAt = (e: GalaxyEvent): number => e.at + eventSeconds(e);
/** Whether two events run at once at some moment, each from its warning to its end. */
const together = (a: GalaxyEvent, b: GalaxyEvent): boolean => warnedAt(a) < endsAt(b) && warnedAt(b) < endsAt(a);
const isFoe = (kind: ThreatKind): kind is FoeKind => kind in FOES;

function identityProblems(def: GalaxyDef): string[] {
  const problems: string[] = [];
  const id = galaxyIdOf(def.dimension, def.index);
  if (def.id !== id) problems.push(`id ${def.id} is not its Dimension and index, ${id}: make them agree`);
  if (def.kind === 'survival' && def.boss !== null) problems.push(`a survival galaxy names the boss ${def.boss}: set boss to null, or make it a boss galaxy`);
  if (def.kind === 'boss' && def.boss === null) problems.push('a boss galaxy names no boss: name the one it fights');
  if ((def.kind === 'boss') !== (def.index === 6)) problems.push(`galaxy ${String(def.index)} is a ${def.kind} galaxy, but galaxy 6 and only galaxy 6 is a Dimension's boss: change its kind or index`);
  if (def.kind === 'boss' && def.events.length > 0) problems.push('a boss galaxy schedules events, which its approach has no room for: drop them');
  return problems;
}

/** Each event in order, apart from the last, inside the opening and the lull, and from its Dimension on. */
function timingProblems(def: GalaxyDef): string[] {
  const problems: string[] = [];
  const lull = lullStart(def);
  def.events.forEach((e, i) => {
    const before = def.events[i - 1];
    if (before !== undefined && e.at < before.at) problems.push(`${named(e)} comes after the ${named(before)} in the list: sort the events by time`);
    else if (before !== undefined && e.at - before.at < EVENT_SPACING_SECONDS) {
      problems.push(`${named(e)} starts ${s(e.at - before.at)} after the ${named(before)}, which needs at least ${s(EVENT_SPACING_SECONDS)}: move it later`);
    }
    // A black hole may warn through the opening's last seconds, so that it opens as the opening ends.
    const earliest = e.type === 'blackHole' ? OPENING_SECONDS - warningSeconds(e) : OPENING_SECONDS;
    if (e.at < earliest) problems.push(`${named(e)} starts before ${s(earliest)}, inside the opening, which ends at ${s(OPENING_SECONDS)}: move it later`);
    if (endsAt(e) > lull) problems.push(`${named(e)} ends at ${s(endsAt(e))}, after the lull starts at ${s(lull)}: move it earlier`);
    if (e.type !== 'meteorShower' && HAZARD_RULES[e.type].from > def.dimension) {
      problems.push(`${named(e)} is a hazard of Dimension ${String(HAZARD_RULES[e.type].from)} on, not of Dimension ${String(def.dimension)}: drop it`);
    }
    if (e.type === 'gravityStorm' && !STORM_INTENSITIES.includes(e.intensity)) problems.push(`${named(e)} has intensity ${String(e.intensity)}, but a storm comes at intensity 1 or 2: lower it`);
  });
  return problems;
}

/** No more than two events at once, none of one type before the last has ended, and no other pull while a storm runs. */
function overlapProblems(events: readonly GalaxyEvent[]): string[] {
  const problems: string[] = [];
  events.forEach((e, i) => {
    const running = events.filter((o) => warnedAt(o) <= warnedAt(e) && warnedAt(e) < endsAt(o)).length;
    if (running > MAX_EVENTS_AT_ONCE) problems.push(`${String(running)} events run at once at ${s(warnedAt(e))}, as the ${named(e)} is warned: no more than ${String(MAX_EVENTS_AT_ONCE)} may, so move it`);
    for (const o of events.slice(0, i)) {
      if (o.type === e.type && together(o, e)) problems.push(`${named(e)} is warned at ${s(warnedAt(e))}, before the one at ${s(o.at)} ends at ${s(endsAt(o))}: start it later`);
    }
    if (e.type !== 'gravityStorm') return;
    for (const o of events) {
      if (o !== e && o.type !== 'meteorShower' && pullsShip(o.type) && together(o, e)) {
        problems.push(`${named(o)} pulls while the ${named(e)} runs: a storm is the only pull on the field, so move one of them`);
      }
    }
  });
  return problems;
}

function rampProblems(def: GalaxyDef): string[] {
  const problems: string[] = [];
  for (const [kind, ramp] of Object.entries(def.kinds) as [ThreatKind, GalaxyDef['kinds'][ThreatKind]][]) {
    const { from, base, step, max } = ramp;
    const all = `from ${String(from)}, base ${String(base)}, step ${String(step)}, max ${String(max)}`;
    if (![from, base, step, max].every(Number.isFinite)) problems.push(`the ${kind} ramp (${all}) is not all numbers: give each part a finite value`);
    else if (!(from >= 0 && step >= 0 && base >= 0 && base <= max && max <= 1)) {
      problems.push(`the ${kind} ramp (${all}) is not a probability: from and step must be 0 or more, and base from 0 to max, which is at most 1`);
    }
    if (isFoe(kind) && max > 0 && FOES[kind].from > def.dimension) {
      problems.push(`the ${kind} is a foe of Dimension ${String(FOES[kind].from)} on, not of Dimension ${String(def.dimension)}: give it a max of 0`);
    }
  }
  return problems;
}

function pickupProblems(def: GalaxyDef): string[] {
  const problems: string[] = [];
  for (const id of def.pickups) {
    if (!isPickupId(id)) problems.push(`${String(id)} is no such pickup: drop it`);
    else if (PICKUPS[id].from > def.dimension) problems.push(`${id} drops from Dimension ${String(PICKUPS[id].from)} on, not in Dimension ${String(def.dimension)}: drop it`);
  }
  for (const id of def.featured) if (!def.pickups.includes(id)) problems.push(`it features ${id}, which its pickups do not hold: add it to them or stop featuring it`);
  return problems;
}

/** What is wrong with a galaxy's events alone: their order, spacing and timing, and what runs at once. Empty when nothing is. */
export function scheduleProblems(def: GalaxyDef): string[] {
  return [...timingProblems(def), ...overlapProblems(def.events)];
}

/**
 * Everything wrong with a galaxy, each saying what to change: its identity, its schedule, its ramps and its pickups.
 * Empty for a galaxy fit to play. Every authored galaxy and every generated one is held to it.
 */
export function galaxyProblems(def: GalaxyDef): string[] {
  return [...identityProblems(def), ...scheduleProblems(def), ...rampProblems(def), ...pickupProblems(def)];
}
