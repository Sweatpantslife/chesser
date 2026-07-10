import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dayDiff, todayStr } from '../lib/clock';

/**
 * The progression layer: experience points, levels, and a configurable daily
 * goal with a "keep your streak" mechanic. Every gamified activity (solving a
 * puzzle, finishing a game, drilling a deck, a puzzle-rush run) funnels XP here
 * through lib/gamify.ts.
 *
 * Streak rule (Duolingo-style): your streak counts consecutive days you hit the
 * daily XP goal — being active but short of the goal doesn't extend it.
 */

const today = todayStr; // injectable clock (lib/clock.ts) so day rollover is testable

// Level curve: XP to go from level L to L+1 is BASE + STEP·L (gently rising).
const BASE = 60;
const STEP = 40;

/** Total XP required to *be* at the start of `level` (level 1 = 0 XP). */
export function xpToReachLevel(level: number): number {
  const n = Math.max(0, level - 1);
  return n * BASE + (STEP * n * (n + 1)) / 2;
}

export function levelFromXp(xp: number): number {
  let l = 1;
  while (xpToReachLevel(l + 1) <= xp) l++;
  return l;
}

export interface LevelProgress {
  level: number;
  intoLevel: number; // XP earned past this level's threshold
  span: number; // XP between this level and the next
  toNext: number; // XP still needed to level up
  pct: number; // 0–100
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const floor = xpToReachLevel(level);
  const ceil = xpToReachLevel(level + 1);
  const span = ceil - floor;
  const intoLevel = xp - floor;
  return { level, intoLevel, span, toNext: ceil - xp, pct: Math.round((intoLevel / span) * 100) };
}

export const GOAL_PRESETS = [20, 40, 80, 150];
const DEFAULT_GOAL = 40;

interface DayLog {
  xp: number;
  activities: number;
}

export interface AwardResult {
  xpGained: number;
  totalXp: number;
  prevLevel: number;
  level: number;
  leveledUp: boolean;
  goalJustMet: boolean;
  streak: number;
}

interface GamifyState {
  xp: number;
  days: Record<string, DayLog>;
  goalXp: number;
  streak: number;
  bestStreak: number;
  lastGoalDay: string;
  goalsMet: number; // distinct days the daily goal was met (counted at crossing time)

  award(amount: number, countsAsActivity?: boolean): AwardResult;
  setGoalXp(n: number): void;
  todayXp(): number;
  todayActivities(): number;
  goalMetToday(): boolean;
  /** Streak as displayed: 0 once a day has been missed. */
  activeStreak(): number;

  exportState(): Pick<GamifyState, 'xp' | 'days' | 'goalXp' | 'streak' | 'bestStreak' | 'lastGoalDay' | 'goalsMet'>;
  importMerge(remote: unknown): void;
  reset(): void;
}

export const useGamify = create<GamifyState>()(
  persist(
    (set, get) => ({
      xp: 0,
      days: {},
      goalXp: DEFAULT_GOAL,
      streak: 0,
      bestStreak: 0,
      lastGoalDay: '',
      goalsMet: 0,

      award(amount, countsAsActivity = true) {
        const s = get();
        const prevLevel = levelFromXp(s.xp);
        const d = today();
        const day = s.days[d] ?? { xp: 0, activities: 0 };
        const wasMet = day.xp >= s.goalXp;
        const newDay: DayLog = { xp: day.xp + amount, activities: day.activities + (countsAsActivity ? 1 : 0) };

        let { streak, bestStreak, lastGoalDay, goalsMet } = s;
        let goalJustMet = false;
        if (!wasMet && newDay.xp >= s.goalXp) {
          if (lastGoalDay === d) {
            // Today was already met earlier (e.g. the goal was raised mid-day and
            // re-crossed) — the streak/count already reflect it, so leave them be.
          } else {
            goalJustMet = true;
            // Continue the streak if yesterday's goal was met, else start fresh.
            streak = lastGoalDay && dayDiff(lastGoalDay, d) === 1 ? streak + 1 : 1;
            bestStreak = Math.max(bestStreak, streak);
            lastGoalDay = d;
            goalsMet += 1; // counted once per day, at crossing time (no retroactive shift)
          }
        }

        const totalXp = s.xp + amount;
        const level = levelFromXp(totalXp);
        set({ xp: totalXp, days: { ...s.days, [d]: newDay }, streak, bestStreak, lastGoalDay, goalsMet });
        return { xpGained: amount, totalXp, prevLevel, level, leveledUp: level > prevLevel, goalJustMet, streak };
      },

      setGoalXp(n) {
        set({ goalXp: Math.max(10, Math.round(n)) });
      },

      todayXp() {
        return get().days[today()]?.xp ?? 0;
      },
      todayActivities() {
        return get().days[today()]?.activities ?? 0;
      },
      goalMetToday() {
        return get().todayXp() >= get().goalXp;
      },
      activeStreak() {
        const s = get();
        if (!s.lastGoalDay) return 0;
        const gap = dayDiff(s.lastGoalDay, today());
        return gap <= 1 ? s.streak : 0;
      },

      exportState() {
        const { xp, days, goalXp, streak, bestStreak, lastGoalDay, goalsMet } = get();
        return { xp, days, goalXp, streak, bestStreak, lastGoalDay, goalsMet };
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<GamifyState>;
        const local = get();
        const days = { ...local.days };
        for (const [day, rl] of Object.entries(r.days ?? {})) {
          const l = days[day];
          const rd = rl as DayLog;
          days[day] = { xp: Math.max(l?.xp ?? 0, rd.xp ?? 0), activities: Math.max(l?.activities ?? 0, rd.activities ?? 0) };
        }
        const lastGoalDay = (r.lastGoalDay ?? '') > local.lastGoalDay ? r.lastGoalDay! : local.lastGoalDay;
        set({
          xp: Math.max(local.xp, r.xp ?? 0),
          days,
          goalXp: r.goalXp ?? local.goalXp,
          streak: Math.max(local.streak, r.streak ?? 0),
          bestStreak: Math.max(local.bestStreak, r.bestStreak ?? 0),
          lastGoalDay,
          goalsMet: Math.max(local.goalsMet, r.goalsMet ?? 0),
        });
      },

      reset() {
        set({ xp: 0, days: {}, goalXp: DEFAULT_GOAL, streak: 0, bestStreak: 0, lastGoalDay: '', goalsMet: 0 });
      },
    }),
    { name: 'chesser-gamify' },
  ),
);
