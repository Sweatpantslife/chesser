import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Difficulty } from '../trainers/tactics';

const START_RATING = 1200;
const today = () => new Date().toISOString().slice(0, 10);

/** A decaying K-factor: volatile while provisional, steady once established. */
function kFactor(played: number): number {
  if (played < 30) return 40;
  if (played < 100) return 24;
  return 16;
}

const DIFFICULTY_BASE: Record<Difficulty, number> = { easy: 1100, medium: 1500, hard: 1900 };

/** Stable per-id jitter so equal-difficulty puzzles spread out a little. */
function hashJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 301) - 150; // −150 … +150
}

/** A puzzle's rating: an explicit one if present, else derived from difficulty. */
export function puzzleRatingOf(p: { id: string; difficulty: Difficulty; rating?: number }): number {
  if (typeof p.rating === 'number') return p.rating;
  return DIFFICULTY_BASE[p.difficulty] + hashJitter(p.id);
}

interface PuzzleRatingState {
  rating: number;
  peak: number;
  played: number;
  solved: number;
  history: Record<string, number>; // YYYY-MM-DD → rating at end of day

  record(puzzleRating: number, success: boolean): { delta: number; rating: number };
  exportState(): { rating: number; peak: number; played: number; solved: number; history: Record<string, number> };
  importMerge(remote: unknown): void;
  reset(): void;
}

export const usePuzzleRating = create<PuzzleRatingState>()(
  persist(
    (set, get) => ({
      rating: START_RATING,
      peak: START_RATING,
      played: 0,
      solved: 0,
      history: {},

      record(puzzleRating, success) {
        const s = get();
        const expected = 1 / (1 + 10 ** ((puzzleRating - s.rating) / 400));
        const k = kFactor(s.played);
        const delta = Math.round(k * ((success ? 1 : 0) - expected));
        const rating = Math.max(400, s.rating + delta);
        const peak = Math.max(s.peak, rating);
        set({
          rating,
          peak,
          played: s.played + 1,
          solved: s.solved + (success ? 1 : 0),
          history: { ...s.history, [today()]: rating },
        });
        return { delta, rating };
      },

      exportState() {
        const { rating, peak, played, solved, history } = get();
        return { rating, peak, played, solved, history };
      },

      // Cross-device merge: the device with more attempts is authoritative for
      // the live rating; day-snapshots are unioned.
      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<PuzzleRatingState>;
        const local = get();
        const history = { ...(r.history ?? {}), ...local.history };
        const remoteWins = (r.played ?? 0) > local.played;
        set({
          rating: remoteWins ? r.rating ?? local.rating : local.rating,
          played: Math.max(local.played, r.played ?? 0),
          solved: Math.max(local.solved, r.solved ?? 0),
          peak: Math.max(local.peak, r.peak ?? START_RATING),
          history,
        });
      },

      reset() {
        set({ rating: START_RATING, peak: START_RATING, played: 0, solved: 0, history: {} });
      },
    }),
    { name: 'chesser-puzzle-rating' },
  ),
);
