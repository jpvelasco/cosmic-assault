import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { practiceLog, type PracticeRunLog } from '../helpers/practiceLog';

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/practice-log.json', import.meta.url), 'utf8')) as PracticeRunLog[];

describe('the practice ruleset', () => {
  const runs = practiceLog();

  it('covers 4 seeds at 7 levels, like the recorded log', () => {
    expect(runs.map((r) => [r.seed, r.level])).toEqual(FIXTURE.map((r) => [r.seed, r.level]));
    expect(runs).toHaveLength(28);
  });

  it.each(FIXTURE.map((recorded, i) => [recorded.seed, recorded.level, i] as const))(
    'replays seed %i at level %i event for event, as recorded before the rules split',
    (_seed, _level, i) => {
      expect(runs[i]).toEqual(FIXTURE[i]);
    },
  );
});
