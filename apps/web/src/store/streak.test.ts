import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { INITIAL_FREEZES, MAX_FREEZES } from '../lib/streak';
import { useStreak } from './streak';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

const pinDay = (offsetDays: number) => setClock(() => T0 + offsetDays * DAY);

describe('streak store (clock-injected)', () => {
  beforeEach(() => {
    useStreak.getState().reset();
    pinDay(0);
  });
  afterEach(() => setClock(null));

  it('touch() counts one per day and current() tracks rollover', () => {
    expect(useStreak.getState().current()).toBe(0);
    useStreak.getState().touch();
    useStreak.getState().touch(); // same day: no double count
    expect(useStreak.getState().count).toBe(1);

    pinDay(1);
    expect(useStreak.getState().current()).toBe(1); // yesterday's run still alive
    useStreak.getState().touch();
    expect(useStreak.getState().count).toBe(2);
    expect(useStreak.getState().current()).toBe(2);
  });

  it('uses a freeze across a single missed day, then resets when the bank is empty', () => {
    useStreak.getState().touch(); // day 0
    pinDay(2); // skipped day 1
    expect(useStreak.getState().atRisk()).toBe(true);
    const r = useStreak.getState().touch();
    expect(r.usedFreeze).toBe(true);
    expect(useStreak.getState().count).toBe(2);
    expect(useStreak.getState().freezes).toBe(INITIAL_FREEZES - 1);

    pinDay(4); // skipped day 3, no freezes left
    const r2 = useStreak.getState().touch();
    expect(r2.broke).toBe(true);
    expect(useStreak.getState().count).toBe(1);
  });

  it('reports milestones through touch()', () => {
    for (let d = 0; d < 2; d++) {
      pinDay(d);
      useStreak.getState().touch();
    }
    pinDay(2);
    const r = useStreak.getState().touch();
    expect(r.newMilestones).toEqual([3]);
    expect(useStreak.getState().milestonesAwarded).toEqual([3]);
  });

  it('exportState round-trips through importMerge', () => {
    for (let d = 0; d < 3; d++) {
      pinDay(d);
      useStreak.getState().touch();
    }
    const snap = useStreak.getState().exportState();
    useStreak.getState().reset();
    useStreak.getState().importMerge(snap);
    expect(useStreak.getState().exportState()).toEqual(snap);
  });

  it('importMerge: most recently active device owns the run; best/freezes/milestones merge monotonically', () => {
    useStreak.getState().touch(); // local: count 1, lastDay day 0
    useStreak.getState().importMerge({
      count: 9,
      best: 12,
      lastDay: '2026-07-02', // later than local → remote owns the run
      freezes: 5, // gets clamped
      milestonesAwarded: [3, 7],
    });
    const s = useStreak.getState();
    expect(s.count).toBe(9);
    expect(s.lastDay).toBe('2026-07-02');
    expect(s.best).toBe(12);
    expect(s.freezes).toBe(MAX_FREEZES);
    expect(s.milestonesAwarded).toEqual([3, 7]);

    // Older remote does not steal the run, but its best still merges.
    useStreak.getState().importMerge({ count: 2, best: 40, lastDay: '2026-06-01', freezes: 0, milestonesAwarded: [3] });
    expect(useStreak.getState().count).toBe(9);
    expect(useStreak.getState().best).toBe(40);
  });

  it('importMerge: a fresh device syncing on the same day does not wipe a longer live streak', () => {
    // Fresh browser: one activity before sign-in, then pullAndMerge brings the
    // server blob for the same account. The 50-day run must survive the merge
    // (and hence the immediate push back to the server).
    useStreak.getState().touch(); // local: count 1, lastDay 2026-07-01
    useStreak.getState().importMerge({ count: 50, best: 50, lastDay: '2026-07-01', freezes: 1, milestonesAwarded: [3, 7, 30] });
    expect(useStreak.getState().count).toBe(50);
    expect(useStreak.getState().current()).toBe(50);
  });

  it('importMerge: playing today on a fresh device CONTINUES a server run that ended yesterday', () => {
    pinDay(1); // today = 2026-07-02
    useStreak.getState().touch(); // fresh device: count 1, lastDay 2026-07-02
    useStreak.getState().importMerge({ count: 50, best: 50, lastDay: '2026-07-01', freezes: 1, milestonesAwarded: [3, 7, 30] });
    expect(useStreak.getState().count).toBe(51);
    expect(useStreak.getState().best).toBe(51);
    expect(useStreak.getState().lastDay).toBe('2026-07-02');
  });

  it('importMerge: the long-streak device keeps its run when it pulls the fresh device blob back', () => {
    // Seed the long-run device: 50 days ending yesterday.
    useStreak.getState().importMerge({ count: 50, best: 50, lastDay: '2026-07-01', freezes: 1, milestonesAwarded: [3, 7, 30] });
    pinDay(1);
    // The fresh device pushed {count:1, lastDay:today}; the merged result must be 51, not 1.
    useStreak.getState().importMerge({ count: 1, best: 1, lastDay: '2026-07-02', freezes: 1, milestonesAwarded: [] });
    expect(useStreak.getState().count).toBe(51);
    expect(useStreak.getState().current()).toBe(51);
  });

  it('importMerge ignores malformed payloads without throwing', () => {
    useStreak.getState().touch();
    const before = useStreak.getState().exportState();
    for (const bad of [null, undefined, 42, 'nope', [], { count: 'many' }, { milestonesAwarded: 'x' }]) {
      expect(() => useStreak.getState().importMerge(bad)).not.toThrow();
    }
    expect(useStreak.getState().exportState()).toEqual(before);
  });
});
