import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { todayStr } from '../lib/clock';
import {
  displayStreak,
  initialStreak,
  mergeStreaks,
  streakAtRisk,
  touchDay,
  type StreakData,
  type TouchResult,
} from '../lib/streak';

/**
 * Daily activity streak: persistence + sync around the pure logic in
 * lib/streak.ts. All mutation goes through `touch()`, which lib/gamify.ts
 * calls on every XP-earning activity — components only read.
 */

interface StreakState extends StreakData {
  /** Mark today active. Returns what happened (extension, freeze use, new milestones). */
  touch(): TouchResult;
  /** Streak as shown in the UI (0 once broken beyond freeze reach). */
  current(): number;
  /** True when only a banked freeze is keeping the run alive today. */
  atRisk(): boolean;

  exportState(): StreakData;
  importMerge(remote: unknown): void;
  reset(): void;
}

const pick = (s: StreakData): StreakData => ({
  count: s.count,
  best: s.best,
  lastDay: s.lastDay,
  freezes: s.freezes,
  milestonesAwarded: s.milestonesAwarded,
});

export const useStreak = create<StreakState>()(
  persist(
    (set, get) => ({
      ...initialStreak(),

      touch() {
        const res = touchDay(pick(get()), todayStr());
        set(res.data);
        return res;
      },

      current() {
        return displayStreak(pick(get()), todayStr());
      },

      atRisk() {
        return streakAtRisk(pick(get()), todayStr());
      },

      exportState() {
        return pick(get());
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<StreakData>;
        const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        // Sanitize the remote blob, then merge with the run-aware pure logic
        // (lib/streak.ts mergeStreaks): counts combine when the two runs are
        // really one continued streak, so a fresh device can't wipe a long run.
        const sanitized: StreakData = {
          count: num(r.count),
          best: num(r.best),
          lastDay: typeof r.lastDay === 'string' ? r.lastDay : '',
          freezes: num(r.freezes),
          milestonesAwarded: Array.isArray(r.milestonesAwarded)
            ? r.milestonesAwarded.filter((m): m is number => typeof m === 'number')
            : [],
        };
        set(mergeStreaks(pick(get()), sanitized));
      },

      reset() {
        set(initialStreak());
      },
    }),
    { name: 'chesser-streak' },
  ),
);
