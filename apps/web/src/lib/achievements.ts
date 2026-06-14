/**
 * The badge catalogue. Each achievement reads a single number out of an
 * aggregated snapshot of the player's stats (`AchievementCtx`) and compares it
 * to a target — so progress bars and "earned?" both fall out of one `value`.
 *
 * Pure and store-free on purpose: lib/gamify.ts builds the ctx from the stores
 * and calls `evaluateAchievements` after every relevant event.
 */
import type { RatingCategory } from '../store/ratings';

export type AchievementCategory = 'tactics' | 'play' | 'ladder' | 'streak' | 'rating' | 'rush' | 'dedication';

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
  botsBeaten: number; // distinct ladder bots defeated
  topBotBeatenRating: number; // strongest ladder bot defeated
  rushBest: number;
  reviews: number; // total SRS reviews across decks
  activeDays: number;
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
  // — Tactics —
  ...tiers(
    { category: 'tactics', icon: '🎯', desc: 'Solve rated tactics puzzles.', value: (c) => c.puzzlesSolved },
    [
      { suffix: 'solve-10', name: 'First Blood', target: 10, xp: 30 },
      { suffix: 'solve-50', name: 'Sharp Eye', target: 50, xp: 60 },
      { suffix: 'solve-200', name: 'Tactician', target: 200, xp: 120 },
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
    ],
  ),
  ...tiers(
    { category: 'play', icon: '🎮', desc: 'Play games against the bots.', value: (c) => c.gamesPlayed },
    [
      { suffix: 'play-10', name: 'Getting the Reps', target: 10, xp: 30 },
      { suffix: 'play-100', name: 'Centurion', target: 100, xp: 150 },
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
    { category: 'streak', icon: '🔥', desc: 'Hit your daily goal on consecutive days.', value: (c) => Math.max(c.streak, c.bestStreak) },
    [
      { suffix: 'streak-3', name: 'Warming Up', target: 3, xp: 30 },
      { suffix: 'streak-7', name: 'Week Strong', target: 7, xp: 80 },
      { suffix: 'streak-30', name: 'Unbreakable', target: 30, xp: 300 },
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
  // — Levels —
  ...tiers(
    { category: 'dedication', icon: '⭐', desc: 'Earn XP and level up.', value: (c) => c.level },
    [
      { suffix: 'level-5', name: 'Rising Star', target: 5, xp: 50 },
      { suffix: 'level-10', name: 'Devotee', target: 10, xp: 120 },
      { suffix: 'level-25', name: 'Grandmaster of Grind', target: 25, xp: 400 },
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
  // — Puzzle rush —
  ...tiers(
    { category: 'rush', icon: '🏃', desc: 'Score in Puzzle Rush.', value: (c) => c.rushBest },
    [
      { suffix: 'rush-15', name: 'Quick Thinker', target: 15, xp: 40 },
      { suffix: 'rush-30', name: 'Rush Hour', target: 30, xp: 100 },
      { suffix: 'rush-50', name: 'Blitz Brain', target: 50, xp: 200 },
    ],
  ),
  // — Dedication —
  ...tiers(
    { category: 'dedication', icon: '📅', desc: 'Train on different days.', value: (c) => c.activeDays },
    [
      { suffix: 'days-7', name: 'Regular', target: 7, xp: 50 },
      { suffix: 'days-30', name: 'Habitual', target: 30, xp: 150 },
    ],
  ),
];

export const ACHIEVEMENTS_BY_ID: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  tactics: 'Tactics',
  play: 'Playing',
  ladder: 'The Ladder',
  streak: 'Streaks',
  rating: 'Ratings',
  rush: 'Puzzle Rush',
  dedication: 'Dedication',
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
