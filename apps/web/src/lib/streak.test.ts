import { describe, expect, it } from 'vitest';
import {
  displayStreak,
  initialStreak,
  streakAtRisk,
  touchDay,
  INITIAL_FREEZES,
  MAX_FREEZES,
  STREAK_MILESTONES,
  type StreakData,
} from './streak';

/** Run consecutive daily touches starting at `startDay` and return the final state. */
function runDays(s: StreakData, startDay: string, n: number): StreakData {
  let cur = s;
  const start = Date.parse(startDay);
  for (let i = 0; i < n; i++) {
    cur = touchDay(cur, new Date(start + i * 86_400_000).toISOString().slice(0, 10)).data;
  }
  return cur;
}

describe('streak pure logic', () => {
  it('starts at 1 on first activity and increments on consecutive days', () => {
    const d0 = initialStreak();
    const r1 = touchDay(d0, '2026-07-01');
    expect(r1.data.count).toBe(1);
    expect(r1.extended).toBe(true);
    expect(r1.broke).toBe(false);

    const r2 = touchDay(r1.data, '2026-07-02');
    expect(r2.data.count).toBe(2);
    expect(r2.data.best).toBe(2);
    expect(r2.extended).toBe(true);
  });

  it('is idempotent within the same day (and ignores backwards days)', () => {
    const s = touchDay(initialStreak(), '2026-07-01').data;
    const again = touchDay(s, '2026-07-01');
    expect(again.data).toEqual(s);
    expect(again.extended).toBe(false);
    const past = touchDay(s, '2026-06-28');
    expect(past.data).toEqual(s);
  });

  it('bridges exactly one missed day by consuming a freeze', () => {
    let s = runDays(initialStreak(), '2026-07-01', 2); // count 2, freezes = INITIAL_FREEZES
    expect(s.freezes).toBe(INITIAL_FREEZES);
    const r = touchDay(s, '2026-07-04'); // skipped 07-03
    expect(r.usedFreeze).toBe(true);
    expect(r.broke).toBe(false);
    expect(r.data.count).toBe(3);
    expect(r.data.freezes).toBe(INITIAL_FREEZES - 1);
  });

  it('resets after one missed day when no freeze is banked', () => {
    let s = runDays(initialStreak(), '2026-07-01', 2);
    s = { ...s, freezes: 0 };
    const r = touchDay(s, '2026-07-04');
    expect(r.broke).toBe(true);
    expect(r.usedFreeze).toBe(false);
    expect(r.data.count).toBe(1);
    expect(r.data.best).toBe(2); // best survives the break
  });

  it('resets after two or more missed days even with freezes banked', () => {
    const s = runDays(initialStreak(), '2026-07-01', 2);
    const r = touchDay(s, '2026-07-05'); // gap of 3 days
    expect(r.broke).toBe(true);
    expect(r.usedFreeze).toBe(false);
    expect(r.data.count).toBe(1);
    expect(r.data.freezes).toBe(s.freezes); // freeze only covers a single missed day
  });

  it('earns a freeze every 7th consecutive day, capped at MAX_FREEZES', () => {
    let s = runDays(initialStreak(), '2026-07-01', 6);
    expect(s.freezes).toBe(INITIAL_FREEZES);
    const day7 = touchDay(s, '2026-07-07');
    expect(day7.earnedFreeze).toBe(true);
    expect(day7.data.freezes).toBe(INITIAL_FREEZES + 1);
    expect(day7.data.freezes).toBe(MAX_FREEZES);
    // day 14 would earn another, but the bank is full
    const s14 = runDays(day7.data, '2026-07-08', 7);
    expect(s14.count).toBe(14);
    expect(s14.freezes).toBe(MAX_FREEZES);
  });

  it('pays each milestone exactly once, even across a broken and rebuilt streak', () => {
    const r3 = runDays(initialStreak(), '2026-07-01', 2);
    const hit3 = touchDay(r3, '2026-07-03');
    expect(hit3.newMilestones).toEqual([3]);

    // Same touch never re-reports; later days report the next milestone only.
    const r4 = touchDay(hit3.data, '2026-07-04');
    expect(r4.newMilestones).toEqual([]);
    let s = runDays(r4.data, '2026-07-05', 2); // days 5..6 → count 6
    const day7 = touchDay(s, '2026-07-07');
    expect(day7.newMilestones).toEqual([7]);

    // Break the streak, rebuild to 3 → milestone 3 does NOT pay again.
    const broken = touchDay(day7.data, '2026-07-20');
    expect(broken.data.count).toBe(1);
    const rebuilt = runDays(broken.data, '2026-07-21', 2);
    expect(rebuilt.count).toBe(3);
    expect(rebuilt.milestonesAwarded).toEqual([3, 7]);
  });

  it('covers all milestone thresholds up to 100', () => {
    const s = runDays(initialStreak(), '2026-01-01', 100);
    expect(s.count).toBe(100);
    expect(s.milestonesAwarded).toEqual([...STREAK_MILESTONES]);
  });

  describe('displayStreak / streakAtRisk', () => {
    const base = runDays(initialStreak(), '2026-07-01', 3); // count 3, lastDay 07-03

    it('shows the count while active today or yesterday', () => {
      expect(displayStreak(base, '2026-07-03')).toBe(3);
      expect(displayStreak(base, '2026-07-04')).toBe(3);
      expect(streakAtRisk(base, '2026-07-04')).toBe(false);
    });

    it('still shows the count (at risk) when one day was missed and a freeze is banked', () => {
      expect(displayStreak(base, '2026-07-05')).toBe(3);
      expect(streakAtRisk(base, '2026-07-05')).toBe(true);
      const noFreeze = { ...base, freezes: 0 };
      expect(displayStreak(noFreeze, '2026-07-05')).toBe(0);
    });

    it('shows 0 once truly broken', () => {
      expect(displayStreak(base, '2026-07-06')).toBe(0);
      expect(displayStreak(initialStreak(), '2026-07-06')).toBe(0);
    });
  });
});
