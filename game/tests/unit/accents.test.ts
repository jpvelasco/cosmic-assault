import { describe, expect, it } from 'vitest';
import { DRIFT, ION_REACH } from '../../src/render/palette';
import { applyAccents } from '../../src/ui/accents';

describe('applyAccents', () => {
  it('sets the three accent custom properties from the palette', () => {
    const set = new Map<string, string>();
    applyAccents({ setProperty: (name, value) => void set.set(name, value ?? '') }, ION_REACH);
    expect([...set]).toEqual([
      ['--accent-1', ION_REACH.accent[0]],
      ['--accent-2', ION_REACH.accent[1]],
      ['--accent-3', ION_REACH.accent[2]],
    ]);
  });

  it('puts the Drift back when it is applied again', () => {
    const set = new Map<string, string>();
    const style = { setProperty: (name: string, value: string | null) => void set.set(name, value ?? '') };
    applyAccents(style, ION_REACH);
    applyAccents(style, DRIFT);
    expect([...set.values()]).toEqual([...DRIFT.accent]);
  });
});
