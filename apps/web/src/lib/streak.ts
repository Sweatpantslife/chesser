/**
 * Daily activity streak — pure logic, no stores, never reads the current time.
 * The store (store/streak.ts) owns persistence and feeds in "today" from
 * lib/clock.
 *
 * Rules (the product spec, in one place):
 * - Any XP-earning activity marks a day active; the streak counts consecutive
 *   active days (unlike the daily-goal streak, hitting the goal is not required).
 * - Streak freezes forgive missed days: skipping exactly ONE day consumes one
 *   banked freeze and the streak continues as if unbroken. Skipping two or more
 *   days in a row (or skipping with an empty bank) resets the streak to 1 on
 *   the next active day.
 * - You start with 1 freeze and earn 1 more every 7 consecutive streak days
 *   (at 7, 14, 21, …). The bank caps at 2.
 * - Milestones at 3 / 7 / 30 / 100 days pay a one-time XP bonus (once per
 *   account, not once per run — rebuilding a broken streak does not re-pay).
 */

import { dayDiff } from './clock';

export const STREAK_MILESTONES = [3, 7, 30, 100] as const;
export const STREAK_MILESTONE_XP: Record<number, number> = { 3: 25, 7: 75, 30: 250, 100: 1000 };
export const MAX_FREEZES = 2;
export const INITIAL_FREEZES = 1;
const FREEZE_EARN_EVERY = 7;

export interface StreakData {
  count: number; // length of the current run, in active days
  best: number; // longest run ever
  lastDay: string; // YYYY-MM-DD of the most recent active day ('' = never active)
  freezes: number; // banked streak freezes
  milestonesAwarded: number[]; // milestone day-counts already paid out (once ever)
}

export function initialStreak(): StreakData {
  return { count: 0, best: 0, lastDay: '', freezes: INITIAL_FREEZES, milestonesAwarded: [] };
}

export interface TouchResult {
  data: StreakData;
  extended: boolean; // the streak grew (includes starting at 1 from 0)
  usedFreeze: boolean; // a banked freeze was consumed to bridge one missed day
  broke: boolean; // a previous run was lost and the streak restarted at 1
  earnedFreeze: boolean; // this day crossed a 7-day multiple and banked a freeze
  newMilestones: number[]; // milestones first reached by this touch (pay these out)
}

/** Register activity on `day` (YYYY-MM-DD). Pure: returns the next state + what happened. */
export function touchDay(s: StreakData, day: string): TouchResult {
  const none: TouchResult = { data: s, extended: false, usedFreeze: false, broke: false, earnedFreeze: false, newMilestones: [] };
  if (s.lastDay) {
    const gap = dayDiff(s.lastDay, day);
    if (gap <= 0) return none; // same day (or clock skew / merged remote from the future): already counted
    let count: number;
    let freezes = s.freezes;
    let usedFreeze = false;
    let broke = false;
    if (gap === 1) {
      count = s.count + 1;
    } else if (gap === 2 && freezes > 0) {
      freezes -= 1; // one missed day, bridged by a freeze
      usedFreeze = true;
      count = s.count + 1;
    } else {
      count = 1;
      broke = s.count > 0;
    }
    return finish({ ...s, count, freezes }, day, usedFreeze, broke);
  }
  return finish({ ...s, count: 1 }, day, false, false);
}

function finish(s: StreakData, day: string, usedFreeze: boolean, broke: boolean): TouchResult {
  const earnedFreeze = s.count > 0 && s.count % FREEZE_EARN_EVERY === 0 && s.freezes < MAX_FREEZES;
  const newMilestones = STREAK_MILESTONES.filter((m) => s.count >= m && !s.milestonesAwarded.includes(m));
  const data: StreakData = {
    ...s,
    lastDay: day,
    best: Math.max(s.best, s.count),
    freezes: earnedFreeze ? s.freezes + 1 : s.freezes,
    milestonesAwarded: newMilestones.length ? [...s.milestonesAwarded, ...newMilestones] : s.milestonesAwarded,
  };
  return { data, extended: true, usedFreeze, broke, earnedFreeze, newMilestones };
}

/**
 * The streak as displayed on `today`: full count while the run is still alive
 * (active today or yesterday, or one missed day that a banked freeze can still
 * bridge), 0 once it is truly broken.
 */
export function displayStreak(s: StreakData, today: string): number {
  if (!s.lastDay || s.count === 0) return 0;
  const gap = dayDiff(s.lastDay, today);
  if (gap <= 1) return s.count;
  if (gap === 2 && s.freezes > 0) return s.count; // savable: playing today consumes the freeze
  return 0;
}

/** True when the streak survives only thanks to a still-unspent freeze (UI nudge: "play today!"). */
export function streakAtRisk(s: StreakData, today: string): boolean {
  if (!s.lastDay || s.count === 0) return false;
  return dayDiff(s.lastDay, today) === 2 && s.freezes > 0;
}

/** A side that has never recorded activity carries no run to merge. */
const runless = (s: StreakData): boolean => !s.lastDay || s.count <= 0;

/**
 * Merge two views of the same account's streak (cross-device sync). Pure and
 * commutative — both devices compute the same result from the same two blobs.
 *
 * The run ending on the later `lastDay` is the live one, but the two runs are
 * often the SAME streak seen from different devices, so the count must not
 * blindly follow the later day: a fresh device syncing {count:1, lastDay:today}
 * against a 50-day run ending today or yesterday would wipe the streak and
 * push the wipe everywhere. Rules, given `gap` days between the runs' ends:
 * - same day: the runs overlap — take the larger count.
 * - newer count > older count: the newer run already subsumes the older one
 *   (e.g. it IS a previous merge result) — keep it.
 * - runs touch (`newer.count >= gap`): one continued streak — older.count + gap.
 * - exactly one uncovered day between them and a freeze is banked: bridge it,
 *   exactly as touchDay would, consuming the freeze.
 * - otherwise the old run is truly broken and the newer one stands alone.
 * Everything monotonic (best, freezes, paid milestones) merges as max/union.
 */
export function mergeStreaks(a: StreakData, b: StreakData): StreakData {
  const [older, newer] = a.lastDay <= b.lastDay ? [a, b] : [b, a];
  const freezes = Math.min(MAX_FREEZES, Math.max(a.freezes, b.freezes));
  const milestonesAwarded = [...new Set([...a.milestonesAwarded, ...b.milestonesAwarded])].sort((x, y) => x - y);

  let count: number;
  let lastDay: string;
  let spentFreeze = false;
  if (runless(newer)) {
    count = older.count;
    lastDay = older.lastDay;
  } else if (runless(older)) {
    count = newer.count;
    lastDay = newer.lastDay;
  } else {
    lastDay = newer.lastDay;
    const gap = dayDiff(older.lastDay, newer.lastDay);
    if (gap === 0) {
      count = Math.max(a.count, b.count);
    } else if (newer.count > older.count) {
      count = newer.count;
    } else if (newer.count >= gap) {
      count = older.count + gap;
    } else if (newer.count === gap - 1 && freezes > 0) {
      count = older.count + newer.count;
      spentFreeze = true;
    } else {
      count = newer.count;
    }
  }
  return {
    count,
    best: Math.max(a.best, b.best, count),
    lastDay,
    freezes: spentFreeze ? freezes - 1 : freezes,
    milestonesAwarded,
  };
}
