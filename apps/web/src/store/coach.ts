import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deserializeReport } from '../lib/analytics/report';
import type { AnalysisReport } from '../lib/analytics/types';
import { digestReport, type GameDigest, type WeaknessKind } from '../lib/weakness';

/**
 * Coach store: the persisted inputs of the "your weaknesses" profile.
 *
 * Holds compact per-game digests (NOT full reports — those live in the
 * lib/analytics report cache) plus the weakness-training attempt log. The
 * ranked profile itself is derived on demand via lib/weakness's pure
 * buildWeaknessProfile, never stored, so aggregation changes apply
 * retroactively to already-digested games.
 *
 * Ingestion happens on two paths:
 *  • store/analysisReport.ts calls ingestReport() whenever a review report is
 *    published — digests survive here even after the LRU report cache evicts
 *    the underlying report;
 *  • bootstrapFromReportCache() scans the existing localStorage report cache
 *    once per session, so users who reviewed games before this feature landed
 *    see their profile immediately.
 */

/** One rated attempt in the "train your weaknesses" flow. */
export interface TrainingAttempt {
  kind: WeaknessKind;
  puzzleId: string;
  solved: boolean;
  at: number;
}

/** Digests kept, newest first (a little above what the profile reads). */
const MAX_DIGESTS = 60;
/** Training attempts kept (enough for long-run improvement stats). */
const MAX_TRAINING = 400;

export interface TrainingStats {
  attempts: number;
  solved: number;
  /** Solve rate over the most recent attempts (≤ 10), 0–1; null when none. */
  recentRate: number | null;
  /** Solve rate over the first attempts (≤ 10), 0–1; null when none. */
  firstRate: number | null;
}

interface CoachState {
  /** Per-game digests keyed by the report's content-derived gameKey. */
  games: Record<string, GameDigest>;
  trainingLog: TrainingAttempt[];
  /** Digest and store a published report; no-op without a player colour. */
  ingestReport(report: AnalysisReport): void;
  recordTraining(kind: WeaknessKind, puzzleId: string, solved: boolean): void;
  trainingStats(kind: WeaknessKind): TrainingStats;
  /** Newest-first digest list (the profile builder's input). */
  digests(): GameDigest[];
  clear(): void;
}

/** Keep the newest MAX_DIGESTS digests. */
function capGames(games: Record<string, GameDigest>): Record<string, GameDigest> {
  const keys = Object.keys(games);
  if (keys.length <= MAX_DIGESTS) return games;
  const keep = keys.sort((a, b) => games[b]!.createdAt - games[a]!.createdAt).slice(0, MAX_DIGESTS);
  return Object.fromEntries(keep.map((k) => [k, games[k]!]));
}

export const useCoach = create<CoachState>()(
  persist(
    (set, get) => ({
      games: {},
      trainingLog: [],

      ingestReport(report) {
        const digest = digestReport(report);
        if (!digest) return;
        const prev = get().games[digest.gameKey];
        // Same game re-reviewed: keep the original timestamp so "recent games"
        // ordering reflects when it was played, not when it was reopened.
        if (prev) digest.createdAt = Math.min(prev.createdAt, digest.createdAt);
        set({ games: capGames({ ...get().games, [digest.gameKey]: digest }) });
      },

      recordTraining(kind, puzzleId, solved) {
        const entry: TrainingAttempt = { kind, puzzleId, solved, at: Date.now() };
        set({ trainingLog: [...get().trainingLog, entry].slice(-MAX_TRAINING) });
      },

      trainingStats(kind) {
        const all = get().trainingLog.filter((t) => t.kind === kind);
        const rate = (slice: TrainingAttempt[]) =>
          slice.length > 0 ? slice.filter((t) => t.solved).length / slice.length : null;
        return {
          attempts: all.length,
          solved: all.filter((t) => t.solved).length,
          recentRate: rate(all.slice(-10)),
          firstRate: rate(all.slice(0, 10)),
        };
      },

      digests() {
        return Object.values(get().games).sort((a, b) => b.createdAt - a.createdAt);
      },

      clear() {
        set({ games: {}, trainingLog: [] });
      },
    }),
    { name: 'chesser-coach' },
  ),
);

// ---------------------------------------------------------------------------
// Bootstrap from the existing report cache
// ---------------------------------------------------------------------------

const REPORT_ENTRY_PREFIX = 'chesser-report:';
let bootstrapped = false;

/**
 * One-time (per session) scan of lib/analytics's localStorage report cache:
 * every cached vs-bot review that isn't digested yet gets ingested. Read-only
 * over the cache; storage errors degrade to "nothing found".
 */
export function bootstrapFromReportCache(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  let store: Storage | null = null;
  try {
    store = globalThis.localStorage ?? null;
  } catch {
    return;
  }
  if (!store) return;
  const coach = useCoach.getState();
  try {
    // Snapshot the keys before ingesting anything: ingestReport() persists the
    // coach store to localStorage, and mutating storage while indexing it with
    // key(i) lets the browser reorder entries mid-scan, skipping reports.
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      if (!key.startsWith(REPORT_ENTRY_PREFIX)) continue;
      if (coach.games[key.slice(REPORT_ENTRY_PREFIX.length)]) continue;
      const raw = store.getItem(key);
      if (!raw) continue;
      const report = deserializeReport(raw);
      if (report) useCoach.getState().ingestReport(report);
    }
  } catch {
    // Best-effort backfill — the live ingestion path still works.
  }
}
