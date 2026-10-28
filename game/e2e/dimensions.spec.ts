import type { Page } from '@playwright/test';
import { BLACK_HOLE, HAZARD_RULES } from '../src/content/hazards';
import { STEP_SECONDS } from '../src/sim/config';
import { expect, fastForward, gameState, openGame, startRun, test } from './fixtures';
import {
  CRIMSON_GALAXY,
  WATCH_LIVES,
  CRIMSON_WATCH_SECONDS,
  GUNSHIP_GALAXY,
  GUNSHIP_WATCH_SECONDS,
  HOLE_DEATH_SECONDS,
  seedFor,
  SINGULARITY_GALAXY,
  VOID_RIFT_GALAXY,
  warnedSeconds,
} from './seeds';
import { FIGHT_SLACK_SECONDS } from '../tests/helpers/seedClaims';

/** The run's first hazard of `type` as the bridge shows it; fails if there is none. */
async function hazardOf(page: Page, type: CosmicAssaultTestState['hazards'][number]['type']): Promise<CosmicAssaultTestState['hazards'][number]> {
  const hazard = (await gameState(page)).hazards.find((h) => h.type === type);
  if (hazard === undefined) throw new Error(`No ${type} on the bridge: fast-forward to its warning first`);
  return hazard;
}

/** What a watch saw, each with the sim seconds into the watch it came at; null for what it never saw. */
interface Sightings {
  /** A gunship winding up, then a bolt it fired after. */
  readonly windup: { readonly id: number; readonly at: number } | null;
  readonly aimedBolt: { readonly id: number; readonly at: number } | null;
  /** A mine armed (charging), then a mine blast, with the id of the armed mine it took off the field (-1 if none went). */
  readonly armed: { readonly id: number; readonly at: number } | null;
  readonly blast: { readonly id: number; readonly at: number } | null;
  /** A bolt lying across the field's edge, the step it was gone at, and whether it ever turned up across the field. */
  readonly edge: { readonly id: number; readonly x: number; readonly y: number; readonly at: number; readonly goneAt: number | null; readonly wrapped: boolean } | null;
  readonly screen: string;
}

/**
 * Steps the run one fixed step at a time, in the page so no frame runs between, for up to `seconds` or until it has seen
 * what `want` names: a mine armed and then blasting, or a gunship's windup and then its bolt with a bolt crossing the
 * field edge and leaving. A bolt that wrapped would turn up near the far edge with the same id.
 */
function watch(page: Page, seconds: number, want: 'mine' | 'gunship'): Promise<Sightings> {
  return page.evaluate(([limit, step, wanted]) => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    let windup: Sightings['windup'] = null;
    let aimedBolt: Sightings['aimedBolt'] = null;
    let armed: Sightings['armed'] = null;
    let blast: Sightings['blast'] = null;
    let edge: { id: number; x: number; y: number; at: number; goneAt: number | null; wrapped: boolean } | null = null;
    const woundUp = new Set<number>();
    const armedIds = new Set<number>();
    let state = api.getState();
    const done = (): boolean => (wanted === 'mine' ? blast !== null : aimedBolt !== null && edge !== null && edge.goneAt !== null);
    for (let t = 0; t < limit && state.screen === 'playing' && !done(); t += step) {
      const blastsBefore = state.events.mineBlast ?? 0;
      api.fastForward(step);
      state = api.getState();
      const field = state.field;
      if (field === null) break;
      for (const foe of state.foes) {
        if (foe.kind === 'gunship' && foe.charging) {
          woundUp.add(foe.id);
          windup ??= { id: foe.id, at: t };
        }
        if (foe.kind === 'mine' && foe.charging) {
          armedIds.add(foe.id);
          armed ??= { id: foe.id, at: t };
        }
      }
      const aimed = state.bolts.find((bolt) => bolt.source === 'gunship' && woundUp.has(bolt.owner));
      if (aimed !== undefined) aimedBolt ??= { id: aimed.id, at: t };
      if (armed !== null && (state.events.mineBlast ?? 0) > blastsBefore) {
        // A mine's blast takes it off the field on the step it goes off.
        const gone = [...armedIds].find((id) => !state.foes.some((foe) => foe.id === id));
        blast ??= { id: gone ?? -1, at: t };
      }
      if (edge === null) {
        const across = state.bolts.find((b) => b.x < b.radius || b.x > field.width - b.radius || b.y < b.radius || b.y > field.height - b.radius);
        if (across !== undefined) edge = { id: across.id, x: across.x, y: across.y, at: t, goneAt: null, wrapped: false };
      } else if (edge.goneAt === null) {
        const { id, x, y } = edge;
        const same = state.bolts.find((b) => b.id === id);
        if (same === undefined) edge.goneAt = t;
        else if (Math.abs(same.x - x) > field.width / 2 || Math.abs(same.y - y) > field.height / 2) edge.wrapped = true;
      }
    }
    return { windup, aimedBolt, armed, blast, edge, screen: state.screen };
  }, [seconds, STEP_SECONDS, want] as const);
}

test.describe(`Crimson Nebula ${CRIMSON_GALAXY}`, () => {
  test('a danger zone warns, then turns lethal, and a mine arms, then blasts', async ({ page, isMobile }) => {
    await openGame(page, { seed: seedFor('crimson-hazards'), galaxy: CRIMSON_GALAXY, lives: WATCH_LIVES });
    await startRun(page, isMobile);

    const warned = warnedSeconds(CRIMSON_GALAXY, 'dangerZone');
    await fastForward(page, warned);
    const warning = await hazardOf(page, 'dangerZone');
    expect(warning).toMatchObject({ stage: 'warning' });
    expect(warning.remaining).toBeGreaterThan(0);
    expect(warning.remaining).toBeLessThanOrEqual(HAZARD_RULES.dangerZone.telegraph);
    expect(warning.w).toBeGreaterThan(0);
    expect(warning.h).toBeGreaterThan(0);

    await fastForward(page, FIGHT_SLACK_SECONDS);
    expect(await hazardOf(page, 'dangerZone')).toMatchObject({ id: warning.id, stage: 'active', x: warning.x, y: warning.y, w: warning.w, h: warning.h });
    expect((await gameState(page)).events).toMatchObject({ zoneWarning: expect.any(Number), zoneStart: expect.any(Number) });

    const seen = await watch(page, CRIMSON_WATCH_SECONDS, 'mine');
    expect(seen.armed, 'a mine armed').not.toBeNull();
    expect(seen.blast?.at, 'that mine blasting after it armed').toBeGreaterThan(seen.armed?.at ?? Infinity);
    expect(seen.blast?.id, 'the blast is the armed mine\'s').toBe(seen.armed?.id);
    expect(seen.screen).toBe('playing');
  });
});

test.describe(`a gunship in ${GUNSHIP_GALAXY}`, () => {
  test('winds up, then fires a bolt, and a bolt leaves across the field edge rather than wrapping', async ({ page, isMobile }) => {
    await openGame(page, { seed: seedFor('gunship-bolt'), galaxy: GUNSHIP_GALAXY, lives: WATCH_LIVES });
    await startRun(page, isMobile);

    const seen = await watch(page, GUNSHIP_WATCH_SECONDS, 'gunship');
    expect(seen.windup, 'a gunship winding up').not.toBeNull();
    expect(seen.aimedBolt, 'a bolt from a gunship that wound up').not.toBeNull();
    expect(seen.aimedBolt?.at).toBeGreaterThan(seen.windup?.at ?? Infinity);
    expect(seen.edge, 'a bolt across the field edge').not.toBeNull();
    expect(seen.edge).toMatchObject({ wrapped: false });
    expect(seen.edge?.goneAt, 'the bolt gone off the field').not.toBeNull();
    expect(seen.screen).toBe('playing');
  });
});

test.describe(`Void Rift ${VOID_RIFT_GALAXY}`, () => {
  test('a warp rift shows its two mouths as a warning, then opens them, with the idle ship still in play', { tag: '@desktop' }, async ({ page }) => {
    await openGame(page, { seed: seedFor('void-rift'), galaxy: VOID_RIFT_GALAXY });
    await startRun(page, false);

    await fastForward(page, warnedSeconds(VOID_RIFT_GALAXY, 'warpRift'));
    const warning = await hazardOf(page, 'warpRift');
    expect(warning).toMatchObject({ stage: 'warning' });
    expect(warning.remaining).toBeLessThanOrEqual(HAZARD_RULES.warpRift.telegraph);
    // Two mouths, far apart.
    expect(Math.hypot((warning.toX ?? warning.x) - warning.x, (warning.toY ?? warning.y) - warning.y)).toBeGreaterThan(100);

    await fastForward(page, FIGHT_SLACK_SECONDS);
    const open = await gameState(page);
    expect(open.hazards.find((h) => h.type === 'warpRift')).toMatchObject({ id: warning.id, stage: 'active', x: warning.x, y: warning.y, toX: warning.toX, toY: warning.toY });
    expect(open.events).toMatchObject({ riftWarning: expect.any(Number), riftOpen: expect.any(Number) });
    expect({ screen: open.screen, lives: open.lives }).toEqual({ screen: 'playing', lives: 3 });
  });
});

test.describe(`Singularity ${SINGULARITY_GALAXY}`, () => {
  test('a black hole warns at the centre, then forms, and a ship it takes comes back clear of it', { tag: '@desktop' }, async ({ page }) => {
    await openGame(page, { seed: seedFor('singularity-hole'), galaxy: SINGULARITY_GALAXY });
    await startRun(page, false);

    await fastForward(page, warnedSeconds(SINGULARITY_GALAXY, 'blackHole'));
    const { field } = await gameState(page);
    const warning = await hazardOf(page, 'blackHole');
    expect(warning).toMatchObject({ stage: 'warning', x: (field?.width ?? 0) / 2, y: (field?.height ?? 0) / 2 });
    expect(warning.remaining).toBeLessThanOrEqual(HAZARD_RULES.blackHole.telegraph);

    // Step by step to the first life lost, so the respawn is read on the step it lands.
    const after = await page.evaluate(([limit, step]) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
      let state = api.getState();
      for (let t = 0; t < limit && state.lives === 3 && state.screen === 'playing'; t += step) {
        api.fastForward(step);
        state = api.getState();
      }
      return state;
    }, [HOLE_DEATH_SECONDS, STEP_SECONDS] as const);
    expect({ screen: after.screen, lives: after.lives }).toEqual({ screen: 'playing', lives: 2 });
    const hole = after.hazards.find((h) => h.type === 'blackHole');
    expect(hole).toMatchObject({ id: warning.id, stage: 'active' });
    expect(after.ship?.invulnerable).toBe(true);
    const away = Math.hypot((after.ship?.x ?? 0) - warning.x, (after.ship?.y ?? 0) - warning.y);
    expect(away, 'the respawn lies outside the reach the hole takes a ship from').toBeGreaterThanOrEqual(BLACK_HOLE.exitReach);
  });
});
