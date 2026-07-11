/**
 * Maps a puzzle to the rating it's "worth". An explicit per-puzzle rating wins;
 * otherwise it's derived from the difficulty band plus a stable per-id jitter so
 * equal-difficulty puzzles spread out a little. (Pure — used for both the
 * player's puzzle rating and the "serve puzzles near my rating" picker.)
 */
import type { Difficulty } from '../trainers/tactics';

const DIFFICULTY_BASE: Record<Difficulty, number> = { easy: 1100, medium: 1500, hard: 1900 };

function hashJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 301) - 150; // −150 … +150
}

export function puzzleRatingOf(p: { id: string; difficulty: Difficulty; rating?: number }): number {
  if (typeof p.rating === 'number') return p.rating;
  return DIFFICULTY_BASE[p.difficulty] + hashJitter(p.id);
}
