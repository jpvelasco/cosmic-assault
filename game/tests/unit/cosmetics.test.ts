import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, SKIN_IDS, SKINS, TRAIL_IDS, TRAILS, type SkinId, type TrailId } from '../../src/content/cosmetics';
import { ALL_STARS, DIMENSION_NUMBERS, GALAXY_INDEXES } from '../../src/content/galaxies';
import { galaxyIdOf, type GalaxyId } from '../../src/content/types';
import { effectiveLook, newlyUnlocked, totalStars, unlockedLooks } from '../../src/meta/cosmetics';
import { defaultSave, type GalaxyProgress, type SaveData } from '../../src/meta/save';

/** A save holding `stars` stars, three to a galaxy, filled in Dimension order. */
function saveWithStars(stars: number): SaveData {
  const galaxies: Partial<Record<GalaxyId, GalaxyProgress>> = {};
  let left = stars;
  for (const d of DIMENSION_NUMBERS) {
    for (const index of GALAXY_INDEXES) {
      const won = Math.min(3, left) as GalaxyProgress['stars'];
      left -= won;
      if (won > 0) galaxies[galaxyIdOf(d, index)] = { bestScore: 100, stars: won };
    }
  }
  return { ...defaultSave(), galaxies };
}

describe('the look tables', () => {
  it('thresholds are the spec table: skins at 0, 9, 24, 45, 66 and 90 stars, trails at 0, 15, 36 and 60', () => {
    expect(SKIN_IDS.map((id) => SKINS[id].stars)).toEqual([0, 9, 24, 45, 66, 90]);
    expect(TRAIL_IDS.map((id) => TRAILS[id].stars)).toEqual([0, 15, 36, 60]);
  });

  it('lists the looks in order of their thresholds, and the classic look is free', () => {
    expect(SKIN_IDS.map((id) => SKINS[id].name)).toEqual(['Classic', 'Ember', 'Glacier', 'Aurora', 'Solar', 'Nova']);
    expect(TRAIL_IDS.map((id) => TRAILS[id].name)).toEqual(['Standard', 'Comet', 'Ion', 'Prism']);
    expect(DEFAULT_LOOK).toEqual({ skin: 'classic', trail: 'standard' });
  });

  it('gives the classic skin the spec rim and no panel lines, so its hull is today\'s', () => {
    expect(SKINS.classic).toMatchObject({ rim: '#ffffff', panel: null, cockpit: null });
    expect(SKINS.ember).toMatchObject({ rim: '#ffd27a', panel: '#ff7a3d', cockpit: '#ffe9c2' });
  });
});

describe('totalStars', () => {
  it('is 0 on a new save', () => {
    expect(totalStars(defaultSave())).toBe(0);
  });

  it('sums the stars of every Dimension, one through five', () => {
    const save: SaveData = {
      ...defaultSave(),
      galaxies: {
        '1-1': { bestScore: 1, stars: 3 },
        '1-6': { bestScore: 1, stars: 1 },
        '3-2': { bestScore: 1, stars: 2 },
        '5-6': { bestScore: 1, stars: 3 },
      },
    };
    expect(totalStars(save)).toBe(9);
  });

  it('reaches every star when every galaxy of every Dimension is won with three, which is what the last skin costs', () => {
    expect(ALL_STARS).toBe(90);
    expect(totalStars(saveWithStars(ALL_STARS))).toBe(ALL_STARS);
    expect(SKINS.nova.stars).toBe(ALL_STARS);
  });
});

describe('unlockedLooks', () => {
  it('offers only the classic skin and the standard trail with no stars', () => {
    expect(unlockedLooks(defaultSave())).toEqual({ skins: ['classic'], trails: ['standard'] });
  });

  it.each<[number, SkinId[], TrailId[]]>([
    [8, ['classic'], ['standard']],
    [9, ['classic', 'ember'], ['standard']],
    [15, ['classic', 'ember'], ['standard', 'comet']],
    [24, ['classic', 'ember', 'glacier'], ['standard', 'comet']],
    [36, ['classic', 'ember', 'glacier'], ['standard', 'comet', 'ion']],
    [45, ['classic', 'ember', 'glacier', 'aurora'], ['standard', 'comet', 'ion']],
    [60, ['classic', 'ember', 'glacier', 'aurora'], ['standard', 'comet', 'ion', 'prism']],
    [66, ['classic', 'ember', 'glacier', 'aurora', 'solar'], ['standard', 'comet', 'ion', 'prism']],
    [90, [...SKIN_IDS], [...TRAIL_IDS]],
  ])('at %i stars offers the looks within reach', (stars, skins, trails) => {
    expect(unlockedLooks(saveWithStars(stars))).toEqual({ skins, trails });
  });
});

describe('effectiveLook', () => {
  it('draws the chosen look when it is unlocked', () => {
    expect(effectiveLook({ skin: 'glacier', trail: 'comet' }, saveWithStars(24))).toEqual({ skin: 'glacier', trail: 'comet' });
  });

  it('draws the default for a chosen look that is not unlocked, such as after a save reset', () => {
    const chosen = { skin: 'nova', trail: 'prism' } as const;
    expect(effectiveLook(chosen, saveWithStars(90))).toEqual(chosen);
    expect(effectiveLook(chosen, defaultSave())).toEqual(DEFAULT_LOOK);
  });

  it('falls back per item: a locked skin keeps an unlocked trail', () => {
    expect(effectiveLook({ skin: 'nova', trail: 'ion' }, saveWithStars(36))).toEqual({ skin: 'classic', trail: 'ion' });
  });
});

describe('newlyUnlocked', () => {
  it('names the look a clear unlocks, once, when its threshold is crossed', () => {
    const before = saveWithStars(8);
    const crossed = saveWithStars(9);
    expect(newlyUnlocked(before, crossed)).toEqual(['Ember trim']);
    expect(newlyUnlocked(crossed, saveWithStars(10))).toEqual([]);
  });

  it('names every look a single jump unlocks, skins before trails', () => {
    expect(newlyUnlocked(saveWithStars(0), saveWithStars(66))).toEqual([
      'Ember trim',
      'Glacier trim',
      'Aurora trim',
      'Solar trim',
      'Comet trail',
      'Ion trail',
      'Prism trail',
    ]);
  });

  it('names nothing when nothing crosses a threshold', () => {
    expect(newlyUnlocked(defaultSave(), defaultSave())).toEqual([]);
  });
});
