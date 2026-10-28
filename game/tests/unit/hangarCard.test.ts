import { describe, expect, it } from 'vitest';
import { SKIN_IDS, SKINS, TRAIL_IDS, TRAILS } from '../../src/content/cosmetics';
import { hangarChoices, lockedCost } from '../../src/ui/hangarCard';

describe('hangarChoices', () => {
  it('lists every skin in order, marking the unlocked ones and the one drawn', () => {
    const choices = hangarChoices(SKIN_IDS, SKINS, ['classic', 'ember'], 'ember');
    expect(choices.map(({ id }) => id)).toEqual([...SKIN_IDS]);
    expect(choices.map(({ locked }) => locked)).toEqual([false, false, true, true, true, true]);
    expect(choices.filter(({ checked }) => checked).map(({ id }) => id)).toEqual(['ember']);
  });

  it('names each choice and keeps its star cost', () => {
    const [classic, , glacier] = hangarChoices(SKIN_IDS, SKINS, ['classic'], 'classic');
    expect(classic).toMatchObject({ name: 'Classic', stars: 0, locked: false });
    expect(glacier).toMatchObject({ name: 'Glacier', stars: 24, locked: true });
  });

  it('works for the trails as well', () => {
    const trails = hangarChoices(TRAIL_IDS, TRAILS, ['standard', 'comet'], 'standard');
    expect(trails.map(({ name }) => name)).toEqual(['Standard', 'Comet', 'Ion', 'Prism']);
    expect(trails.map(({ locked }) => locked)).toEqual([false, false, true, true]);
  });
});

describe('lockedCost', () => {
  it('shows what a locked choice costs in stars', () => {
    expect(lockedCost({ stars: 24, locked: true })).toBe('★ 24');
  });

  it('shows nothing on an unlocked choice', () => {
    expect(lockedCost({ stars: 9, locked: false })).toBe('');
  });
});
