import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { todayStr } from '../lib/clock';
import {
  displayStreak,
  initialStreak,
  streakAtRisk,
  touchDay,
  MAX_FREEZES,
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
        const local = pick(get());
        // The device that was active most recently owns the run; everything
        // monotonic (best, freezes, paid milestones) merges as max/union.
        const remoteDay = typeof r.lastDay === 'string' ? r.lastDay : '';
        const remoteOwns = remoteDay > local.lastDay;
        const milestones = new Set(local.milestonesAwarded);
        for (const m of r.milestonesAwarded ?? []) if (typeof m === 'number') milestones.add(m);
        set({
          count: remoteOwns ? (typeof r.count === 'number' ? r.count : 0) : local.count,
          lastDay: remoteOwns ? remoteDay : local.lastDay,
          best: Math.max(local.best, typeof r.best === 'number' ? r.best : 0),
          freezes: Math.min(MAX_FREEZES, Math.max(local.freezes, typeof r.freezes === 'number' ? r.freezes : 0)),
          milestonesAwarded: [...milestones].sort((a, b) => a - b),
        });
      },

      reset() {
        set(initialStreak());
      },
    }),
    { name: 'chesser-streak' },
  ),
);
