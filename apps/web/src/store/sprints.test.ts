import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { useSprints } from './sprints';

const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

describe('sprints store (personal bests, clock-injected)', () => {
  beforeEach(() => {
    useSprints.getState().reset();
    setClock(() => T0);
  });
  afterEach(() => setClock(null));

  it('starts empty', () => {
    const s = useSprints.getState();
    expect(s.puzzleRushBest.timed3).toEqual({ score: 0, bestStreak: 0, at: 0 });
    expect(s.puzzleRushBest.survival).toEqual({ score: 0, bestStreak: 0, at: 0 });
    expect(s.puzzleStormBest).toEqual({ score: 0, bestStreak: 0, at: 0 });
  });

  it('records a rush best per variant and stamps it with the injected clock', () => {
    expect(useSprints.getState().recordRushRun('timed3', 12, 7)).toBe(true);
    expect(useSprints.getState().puzzleRushBest.timed3).toEqual({ score: 12, bestStreak: 7, at: T0 });
    // the other variant is untouched
    expect(useSprints.getState().puzzleRushBest.survival.score).toBe(0);
  });

  it('only improves: worse or equal runs do not overwrite a best', () => {
    useSprints.getState().recordRushRun('survival', 20, 10);
    setClock(() => T0 + 1000);
    expect(useSprints.getState().recordRushRun('survival', 15, 15)).toBe(false);
    expect(useSprints.getState().recordRushRun('survival', 20, 20)).toBe(false);
    expect(useSprints.getState().puzzleRushBest.survival).toEqual({ score: 20, bestStreak: 10, at: T0 });
    expect(useSprints.getState().recordRushRun('survival', 21, 3)).toBe(true);
    expect(useSprints.getState().puzzleRushBest.survival).toEqual({ score: 21, bestStreak: 3, at: T0 + 1000 });
  });

  it('records storm bests independently of rush', () => {
    expect(useSprints.getState().recordStormRun(145, 9)).toBe(true);
    expect(useSprints.getState().puzzleStormBest).toEqual({ score: 145, bestStreak: 9, at: T0 });
    expect(useSprints.getState().puzzleRushBest.timed3.score).toBe(0);
  });

  it('a zero-score run is not a record', () => {
    expect(useSprints.getState().recordRushRun('timed3', 0, 0)).toBe(false);
    expect(useSprints.getState().recordStormRun(0, 0)).toBe(false);
  });

  it('importMerge takes the higher score per slot and ignores junk', () => {
    useSprints.getState().recordRushRun('timed3', 10, 5);
    useSprints.getState().recordStormRun(100, 6);
    useSprints.getState().importMerge({
      puzzleRushBest: {
        timed3: { score: 8, bestStreak: 8, at: 111 }, // lower — ignored
        survival: { score: 30, bestStreak: 12, at: 222 }, // higher — taken
      },
      puzzleStormBest: { score: 250, bestStreak: 20, at: 333 }, // higher — taken
    });
    const s = useSprints.getState();
    expect(s.puzzleRushBest.timed3).toEqual({ score: 10, bestStreak: 5, at: T0 });
    expect(s.puzzleRushBest.survival).toEqual({ score: 30, bestStreak: 12, at: 222 });
    expect(s.puzzleStormBest).toEqual({ score: 250, bestStreak: 20, at: 333 });

    // junk shapes never corrupt the store
    useSprints.getState().importMerge(null);
    useSprints.getState().importMerge('nope');
    useSprints.getState().importMerge({ puzzleRushBest: { timed3: { score: 'NaN' } }, puzzleStormBest: 5 });
    useSprints.getState().importMerge({ puzzleStormBest: { score: Number.POSITIVE_INFINITY, bestStreak: 1, at: 1 } });
    expect(useSprints.getState().puzzleRushBest.timed3).toEqual({ score: 10, bestStreak: 5, at: T0 });
    expect(useSprints.getState().puzzleStormBest).toEqual({ score: 250, bestStreak: 20, at: 333 });
  });

  it('exportState returns the exact synced shape', () => {
    useSprints.getState().recordRushRun('timed3', 3, 2);
    const exported = useSprints.getState().exportState();
    expect(exported).toEqual({
      puzzleRushBest: {
        timed3: { score: 3, bestStreak: 2, at: T0 },
        survival: { score: 0, bestStreak: 0, at: 0 },
      },
      puzzleStormBest: { score: 0, bestStreak: 0, at: 0 },
    });
  });
});
