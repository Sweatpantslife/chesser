/**
 * The badge catalogue. Each achievement reads a single number out of an
 * aggregated snapshot of the player's stats (`AchievementCtx`) and compares it
 * to a target — so progress bars and "earned?" both fall out of one `value`.
 *
 * Pure and store-free on purpose: lib/gamify.ts builds the ctx from the stores
 * and calls `evaluateAchievements` after every relevant event.
 *
 * i18n: this module must NOT import src/i18n (it sits in store/game's static
 * import graph, whose tests run under plain `node --test`). `name` / `desc` /
 * ACHIEVEMENT_CATEGORY_LABELS are the CANONICAL ENGLISH strings; the UI
 * resolves display text by id via the `progress` namespace —
 * t(`progress:achievements.${id}.name` / `.desc`,
 *   `progress:achievementCategories.${category}`) with these as defaultValue.
 * Keep locales/<lng>/progress.json in sync when adding/renaming a badge.
 */
import type { RatingCategory } from '../store/ratings';
import { LESSON_COUNT } from '../learn/meta';

export type AchievementCategory = 'learn' | 'tactics' | 'play' | 'ladder' | 'streak' | 'rating' | 'rush' | 'storm' | 'dedication' | 'quests' | 'coach';

export interface AchievementCtx {
  level: number;
  streak: number;
  bestStreak: number;
  goalMetToday: boolean;
  goalsMet: number; // distinct days the daily goal was met
  ratings: Record<RatingCategory, { elo: number; glicko: number; peak: number; played: number; won: number }>;
  puzzlesSolved: number;
  gamesPlayed: number;
  gamesWon: number;
  bestWinStreak: number; // longest run of consecutive game wins (bots + blitz)
  botsBeaten: number; // distinct ladder bots defeated
  topBotBeatenRating: number; // strongest ladder bot defeated
  rushBest: number;
  stormBest: number; // best Puzzle Storm score (combo-multiplied points)
  reviews: number; // total SRS reviews across decks
  activeDays: number;
  lessonsCompleted: number; // distinct lessons finished on the Learn tab
  questsCompleted: number; // lifetime daily quests completed
  questDaysAllDone: number; // days where the whole daily-quest slate was finished
  weaknessTrainings: number; // rated attempts in the coach's "Train this weakness" drills
  weaknessesCleared: number; // distinct weaknesses at the cleared bar (lib/gamify WEAKNESS_CLEARED_*)
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  category: AchievementCategory;
  xp: number; // bonus XP awarded on unlock
  target: number;
  value: (c: AchievementCtx) => number;
}

/** Helper for tiered badge families (e.g. solve 10 / 50 / 200 puzzles). */
function tiers(
  base: Omit<Achievement, 'id' | 'name' | 'target' | 'xp'>,
  steps: { suffix: string; name: string; target: number; xp: number }[],
): Achievement[] {
  return steps.map((s) => ({ ...base, id: `${base.category}-${s.suffix}`, name: s.name, target: s.target, xp: s.xp }));
}

export const ACHIEVEMENTS: Achievement[] = [
  // — Learning —
  ...tiers(
    { category: 'learn', icon: '🎓', desc: 'Complete interactive lessons.', value: (c) => c.lessonsCompleted },
    [
      { suffix: 'lesson-1', name: 'First Steps', target: 1, xp: 20 },
      { suffix: 'lesson-10', name: 'Eager Student', target: 10, xp: 60 },
      { suffix: 'lesson-all', name: 'Graduate', target: LESSON_COUNT, xp: 150 },
    ],
  ),
  ...tiers(
    { category: 'learn', icon: '🧠', desc: 'Review flashcards across your decks (openings · mates · anti-blunder).', value: (c) => c.reviews },
    [
      { suffix: 'reviews-50', name: 'Memory Spark', target: 50, xp: 40 },
      { suffix: 'reviews-250', name: 'Iron Memory', target: 250, xp: 120 },
    ],
  ),
  // — Tactics —
  ...tiers(
    { category: 'tactics', icon: '🎯', desc: 'Solve rated tactics puzzles.', value: (c) => c.puzzlesSolved },
    [
      { suffix: 'solve-10', name: 'First Blood', target: 10, xp: 30 },
      { suffix: 'solve-50', name: 'Sharp Eye', target: 50, xp: 60 },
      { suffix: 'solve-200', name: 'Tactician', target: 200, xp: 120 },
      { suffix: 'solve-500', name: 'Sniper', target: 500, xp: 200 },
      { suffix: 'solve-1000', name: 'Combination Machine', target: 1000, xp: 300 },
    ],
  ),
  // — Play vs bots —
  ...tiers(
    { category: 'play', icon: '♟️', desc: 'Win games against the bots.', value: (c) => c.gamesWon },
    [
      { suffix: 'win-1', name: 'First Win', target: 1, xp: 30 },
      { suffix: 'win-10', name: 'Giant Slayer', target: 10, xp: 60 },
      { suffix: 'win-50', name: 'Seasoned', target: 50, xp: 150 },
      { suffix: 'win-150', name: 'Conqueror', target: 150, xp: 300 },
    ],
  ),
  ...tiers(
    { category: 'play', icon: '🎮', desc: 'Play games against the bots.', value: (c) => c.gamesPlayed },
    [
      { suffix: 'play-10', name: 'Getting the Reps', target: 10, xp: 30 },
      { suffix: 'play-100', name: 'Centurion', target: 100, xp: 150 },
    ],
  ),
  ...tiers(
    { category: 'play', icon: '⚔️', desc: 'Win consecutive games without a draw or loss in between.', value: (c) => c.bestWinStreak },
    [
      { suffix: 'winstreak-3', name: 'Hat-Trick', target: 3, xp: 40 },
      { suffix: 'winstreak-5', name: 'On a Tear', target: 5, xp: 90 },
      { suffix: 'winstreak-10', name: 'Untouchable', target: 10, xp: 250 },
    ],
  ),
  // — Ladder —
  ...tiers(
    { category: 'ladder', icon: '🪜', desc: 'Climb the bot ladder.', value: (c) => c.botsBeaten },
    [
      { suffix: 'climb-3', name: 'Up the Rungs', target: 3, xp: 40 },
      { suffix: 'climb-8', name: 'Halfway There', target: 8, xp: 100 },
      { suffix: 'climb-15', name: 'Ladder Conqueror', target: 15, xp: 250 },
    ],
  ),
  {
    id: 'ladder-master',
    name: 'Slayer of Titans',
    desc: 'Beat a ladder bot rated 2500+.',
    icon: '🦾',
    category: 'ladder',
    xp: 200,
    target: 2500,
    value: (c) => c.topBotBeatenRating,
  },
  // — Streaks / daily goals —
  ...tiers(
    { category: 'streak', icon: '🔥', desc: 'Train on consecutive days to keep your streak alive.', value: (c) => Math.max(c.streak, c.bestStreak) },
    [
      { suffix: 'streak-3', name: 'Warming Up', target: 3, xp: 30 },
      { suffix: 'streak-7', name: 'Week Strong', target: 7, xp: 80 },
      { suffix: 'streak-30', name: 'Unbreakable', target: 30, xp: 300 },
      { suffix: 'streak-100', name: 'Eternal Flame', target: 100, xp: 500 },
    ],
  ),
  {
    id: 'streak-first-goal',
    name: 'Goal!',
    desc: 'Meet your daily goal for the first time.',
    icon: '✅',
    category: 'streak',
    xp: 20,
    target: 1,
    value: (c) => c.goalsMet,
  },
  ...tiers(
    { category: 'streak', icon: '🏁', desc: 'Meet your daily XP goal on different days.', value: (c) => c.goalsMet },
    [
      { suffix: 'goal-7', name: 'Consistent', target: 7, xp: 60 },
      { suffix: 'goal-30', name: 'Relentless', target: 30, xp: 200 },
    ],
  ),
  // — Levels —
  ...tiers(
    { category: 'dedication', icon: '⭐', desc: 'Earn XP and level up.', value: (c) => c.level },
    [
      { suffix: 'level-5', name: 'Rising Star', target: 5, xp: 50 },
      { suffix: 'level-10', name: 'Devotee', target: 10, xp: 120 },
      { suffix: 'level-25', name: 'Grandmaster of Grind', target: 25, xp: 400 },
    ],
  ),
  // — Daily quests —
  ...tiers(
    { category: 'quests', icon: '🗺️', desc: 'Complete daily quests.', value: (c) => c.questsCompleted },
    [
      { suffix: 'first', name: 'First Quest', target: 1, xp: 15 },
      { suffix: '25', name: 'Adventurer', target: 25, xp: 75 },
    ],
  ),
  ...tiers(
    { category: 'quests', icon: '🏅', desc: 'Finish every daily quest in a single day.', value: (c) => c.questDaysAllDone },
    [
      { suffix: 'clean-1', name: 'Clean Sweep', target: 1, xp: 30 },
      { suffix: 'clean-7', name: 'Sweep Week', target: 7, xp: 150 },
    ],
  ),
  // — Coach —
  ...tiers(
    { category: 'coach', icon: '🧑‍🏫', desc: 'Train your diagnosed weaknesses with targeted drills.', value: (c) => c.weaknessTrainings },
    [
      { suffix: 'train-1', name: 'Coachable', target: 1, xp: 15 },
      { suffix: 'train-50', name: 'Star Pupil', target: 50, xp: 100 },
    ],
  ),
  ...tiers(
    {
      category: 'coach',
      icon: '💪',
      desc: 'Clear a weakness — solve 8 of your last 10 targeted drills (10+ attempts).',
      value: (c) => c.weaknessesCleared,
    },
    [
      { suffix: 'clear-1', name: 'Weakness No More', target: 1, xp: 50 },
      { suffix: 'clear-3', name: 'Turnaround Artist', target: 3, xp: 150 },
    ],
  ),
  // — Ratings —
  {
    id: 'rating-puzzles-1600',
    name: 'Puzzle Expert',
    desc: 'Reach a 1600 puzzle rating.',
    icon: '🧩',
    category: 'rating',
    xp: 100,
    target: 1600,
    value: (c) => c.ratings.puzzles.peak,
  },
  {
    id: 'rating-puzzles-2000',
    name: 'Puzzle Master',
    desc: 'Reach a 2000 puzzle rating.',
    icon: '💎',
    category: 'rating',
    xp: 250,
    target: 2000,
    value: (c) => c.ratings.puzzles.peak,
  },
  {
    id: 'rating-bots-1800',
    name: 'Club Strength',
    desc: 'Reach an 1800 rating against the bots.',
    icon: '📈',
    category: 'rating',
    xp: 120,
    target: 1800,
    value: (c) => c.ratings.bots.peak,
  },
  {
    id: 'rating-blitz-1600',
    name: 'Speed Demon',
    desc: 'Reach a 1600 blitz rating.',
    icon: '⚡',
    category: 'rating',
    xp: 120,
    target: 1600,
    value: (c) => c.ratings.blitz.peak,
  },
  {
    id: 'rating-bots-2000',
    name: 'Master of Machines',
    desc: 'Reach a 2000 rating against the bots.',
    icon: '🤖',
    category: 'rating',
    xp: 250,
    target: 2000,
    value: (c) => c.ratings.bots.peak,
  },
  // — Puzzle rush —
  ...tiers(
    { category: 'rush', icon: '🏃', desc: 'Score in Puzzle Rush.', value: (c) => c.rushBest },
    [
      { suffix: 'rush-15', name: 'Quick Thinker', target: 15, xp: 40 },
      { suffix: 'rush-30', name: 'Rush Hour', target: 30, xp: 100 },
      { suffix: 'rush-50', name: 'Blitz Brain', target: 50, xp: 200 },
    ],
  ),
  // — Puzzle storm — (targets are combo-multiplied points, so they run higher
  //   than the rush solve counts; the top tier sits just under the server's
  //   plausibility ceiling for a synced storm best — see the account
  //   progress-validator's stormScoreCap)
  ...tiers(
    { category: 'storm', icon: '🌩️', desc: 'Score points in Puzzle Storm.', value: (c) => c.stormBest },
    [
      { suffix: 'storm-100', name: 'Storm Rider', target: 100, xp: 40 },
      { suffix: 'storm-200', name: 'Eye of the Storm', target: 200, xp: 100 },
      { suffix: 'storm-350', name: 'Force of Nature', target: 350, xp: 200 },
    ],
  ),
  // — Dedication —
  ...tiers(
    { category: 'dedication', icon: '📅', desc: 'Train on different days.', value: (c) => c.activeDays },
    [
      { suffix: 'days-7', name: 'Regular', target: 7, xp: 50 },
      { suffix: 'days-30', name: 'Habitual', target: 30, xp: 150 },
      { suffix: 'days-100', name: 'Devoted', target: 100, xp: 300 },
    ],
  ),
];

export const ACHIEVEMENTS_BY_ID: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  learn: 'Learning',
  tactics: 'Tactics',
  play: 'Playing',
  ladder: 'The Ladder',
  streak: 'Streaks',
  rating: 'Ratings',
  rush: 'Puzzle Rush',
  storm: 'Puzzle Storm',
  dedication: 'Dedication',
  quests: 'Daily Quests',
  coach: 'The Coach',
};

export function achievementProgress(a: Achievement, ctx: AchievementCtx): { value: number; target: number; pct: number; done: boolean } {
  const value = a.value(ctx);
  const pct = Math.min(100, Math.round((value / a.target) * 100));
  return { value, target: a.target, pct, done: value >= a.target };
}

/** Ids of every achievement currently satisfied by `ctx`. */
export function evaluateAchievements(ctx: AchievementCtx): string[] {
  return ACHIEVEMENTS.filter((a) => a.value(ctx) >= a.target).map((a) => a.id);
}
