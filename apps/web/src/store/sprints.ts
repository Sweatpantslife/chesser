import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { now } from '../lib/clock';
import type { RushVariant } from '../lib/sprint';

/**
 * Personal bests for the timed puzzle-sprint modes (Puzzle Rush and Puzzle
 * Storm). Deliberately its own tiny persisted store with a flat, documented
 * shape, because the leaderboard consumes it:
 *
 *   puzzleRushBest.timed3   — best 3-minute Rush run   (score = puzzles solved)
 *   puzzleRushBest.survival — best survival Rush run   (score = puzzles solved)
 *   puzzleStormBest         — best Storm run           (score = combo-multiplied points)
 *
 * Each slot is a `SprintBest { score, bestStreak, at }` where `at` is the
 * epoch-ms timestamp of the record run (0 = never played). Persisted under the
 * localStorage key `chesser-sprints` and synced as the top-level `sprints`
 * section of the account progress blob (lib/sync.ts).
 *
 * Merge rule (local ⊕ remote, used by both sync directions): per slot, the
 * higher score wins; on a tie the earlier record stands.
 */

export interface SprintBest {
  score: number;
  /** Longest streak of consecutive solves within the record run. */
  bestStreak: number;
  /** Epoch ms the record was set (lib/clock `now()`); 0 = never played. */
  at: number;
}

export interface SprintBests {
  puzzleRushBest: Record<RushVariant, SprintBest>;
  puzzleStormBest: SprintBest;
}

const EMPTY_BEST: SprintBest = { score: 0, bestStreak: 0, at: 0 };

const emptyBests = (): SprintBests => ({
  puzzleRushBest: { timed3: { ...EMPTY_BEST }, survival: { ...EMPTY_BEST } },
  puzzleStormBest: { ...EMPTY_BEST },
});

/** Does `b` beat `a`? Higher score wins; ties keep the earlier record. */
function beats(a: SprintBest, b: SprintBest): boolean {
  if (b.score !== a.score) return b.score > a.score;
  // Equal scores: the earlier real record stands. Zero/unset records
  // (score 0 or at 0) never steal a tie.
  return b.score > 0 && b.at > 0 && a.at > 0 && b.at < a.at;
}

function sanitizeBest(raw: unknown): SprintBest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { score: num(r.score), bestStreak: num(r.bestStreak), at: num(r.at) };
}

interface SprintsState extends SprintBests {
  /** Record a finished Rush run; returns true when it set a new best. */
  recordRushRun(variant: RushVariant, score: number, bestStreak: number): boolean;
  /** Record a finished Storm run; returns true when it set a new best. */
  recordStormRun(score: number, bestStreak: number): boolean;

  exportState(): SprintBests;
  importMerge(remote: unknown): void;
  reset(): void;
}

export const useSprints = create<SprintsState>()(
  persist(
    (set, get) => ({
      ...emptyBests(),

      recordRushRun(variant, score, bestStreak) {
        const cur = get().puzzleRushBest;
        const next: SprintBest = { score, bestStreak, at: now() };
        if (!beats(cur[variant], next)) return false;
        set({ puzzleRushBest: { ...cur, [variant]: next } });
        return true;
      },

      recordStormRun(score, bestStreak) {
        const next: SprintBest = { score, bestStreak, at: now() };
        if (!beats(get().puzzleStormBest, next)) return false;
        set({ puzzleStormBest: next });
        return true;
      },

      exportState() {
        const { puzzleRushBest, puzzleStormBest } = get();
        return { puzzleRushBest, puzzleStormBest };
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Record<string, unknown>;
        const local = get();
        const rush = (r.puzzleRushBest ?? {}) as Record<string, unknown>;
        const merged: SprintBests = {
          puzzleRushBest: { ...local.puzzleRushBest },
          puzzleStormBest: local.puzzleStormBest,
        };
        for (const variant of ['timed3', 'survival'] as const) {
          const incoming = sanitizeBest(rush[variant]);
          if (incoming && beats(merged.puzzleRushBest[variant], incoming)) merged.puzzleRushBest[variant] = incoming;
        }
        const storm = sanitizeBest(r.puzzleStormBest);
        if (storm && beats(merged.puzzleStormBest, storm)) merged.puzzleStormBest = storm;
        set(merged);
      },

      reset() {
        set(emptyBests());
      },
    }),
    { name: 'chesser-sprints' },
  ),
);
