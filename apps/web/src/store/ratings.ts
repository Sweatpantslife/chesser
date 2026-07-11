import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_GLICKO, updateGlickoOne, type Glicko2 } from '../lib/glicko';
import { updateElo } from '../lib/elo';

/**
 * Unified rating book keeping a **dual meter** per category:
 *
 *  • `elo`    — plain Elo, the headline number players see and feel.
 *  • `glicko` — Glicko-2 (rating + deviation + volatility), the confidence-aware
 *               meter that drives difficulty decisions (which puzzle to serve,
 *               which opponent to suggest) and is surfaced in Stats / Profile.
 *
 * Three categories are tracked separately, the way a real chess site splits
 * ratings by activity:
 *  • `bots`    — casual (untimed) games versus the engine bots.
 *  • `blitz`   — games versus bots played on a clock.
 *  • `puzzles` — rated tactics.
 *
 * Syncs through lib/sync.ts and migrates the old single-Elo puzzle rating so no
 * history is lost.
 */

export type RatingCategory = 'bots' | 'blitz' | 'puzzles';
export const RATING_CATEGORIES: RatingCategory[] = ['bots', 'blitz', 'puzzles'];

/** Opponents/puzzles have a known strength, so we treat them as fairly certain. */
const OPP_RD = 60;

/**
 * A Glicko rating with RD above this is provisional (Lichess uses the same
 * cutoff). Provisional ratings swing wildly — one lucky win against a 2100
 * puzzle launches a fresh 1200±700 rating past 1600 — so they don't count as
 * a "peak" (which feeds the rating achievements and the peak display).
 */
export const PROVISIONAL_RD = 110;

/** Starting Elo per category (puzzles start lower, mirroring the old default). */
const START_ELO: Record<RatingCategory, number> = { bots: 1500, blitz: 1500, puzzles: 1200 };

const today = () => new Date().toISOString().slice(0, 10);

export interface DaySnapshot {
  elo: number;
  glicko: number;
}

export interface CategoryRating {
  elo: number;
  eloPeak: number;
  glicko: Glicko2;
  glickoPeak: number;
  played: number;
  won: number; // puzzles: solved
  lost: number; // puzzles: missed
  drawn: number;
  /** Current run of consecutive wins (a draw or loss resets it). */
  winStreak: number;
  /** Longest win run ever (drives the win-streak achievements). */
  bestWinStreak: number;
  history: Record<string, DaySnapshot>; // YYYY-MM-DD → end-of-day snapshot
}

export type RatingMeter = 'elo' | 'glicko';
export type GameOutcome = 'win' | 'loss' | 'draw';

function freshCategory(cat: RatingCategory): CategoryRating {
  const elo = START_ELO[cat];
  return {
    elo,
    eloPeak: elo,
    glicko: { ...DEFAULT_GLICKO, rating: elo },
    glickoPeak: elo,
    played: 0,
    won: 0,
    lost: 0,
    drawn: 0,
    winStreak: 0,
    bestWinStreak: 0,
    history: {},
  };
}

function freshBook(): Record<RatingCategory, CategoryRating> {
  return { bots: freshCategory('bots'), blitz: freshCategory('blitz'), puzzles: freshCategory('puzzles') };
}

/** The numeric value shown for a category under the chosen meter. */
export function ratingValue(c: CategoryRating, meter: RatingMeter): number {
  return Math.round(meter === 'elo' ? c.elo : c.glicko.rating);
}
export function ratingPeak(c: CategoryRating, meter: RatingMeter): number {
  return Math.round(meter === 'elo' ? c.eloPeak : c.glickoPeak);
}

const scoreOf = (o: GameOutcome): number => (o === 'win' ? 1 : o === 'draw' ? 0.5 : 0);

interface RecordResult {
  elo: number;
  eloDelta: number;
  glicko: number;
  glickoDelta: number;
}

interface RatingsState {
  categories: Record<RatingCategory, CategoryRating>;
  legacyMigrated: boolean;

  /** Apply one result to a category, updating both meters. */
  record(category: RatingCategory, opponentRating: number, outcome: GameOutcome): RecordResult;
  /** The Glicko rating used for difficulty/pairing decisions. */
  decisionRating(category: RatingCategory): number;

  migrateLegacy(): void;
  exportState(): { categories: Record<RatingCategory, CategoryRating>; legacyMigrated: boolean };
  /** Legacy {rating,peak,played,solved,history} shape, for back-compat sync. */
  legacyPuzzleExport(): { rating: number; peak: number; played: number; solved: number; history: Record<string, number> };
  importMerge(remote: unknown): void;
  importLegacyPuzzle(remote: unknown): void;
  reset(): void;
}

function applyRecord(c: CategoryRating, opponentRating: number, outcome: GameOutcome): { next: CategoryRating; res: RecordResult } {
  const score = scoreOf(outcome);
  const { rating: newElo, delta: eloDelta } = updateElo(c.elo, opponentRating, score, c.played);
  const newGlicko = updateGlickoOne(c.glicko, opponentRating, OPP_RD, score);
  const glickoDelta = Math.round(newGlicko.rating - c.glicko.rating);
  const d = today();
  // ?? 0 guards state persisted before win streaks existed.
  const winStreak = outcome === 'win' ? (c.winStreak ?? 0) + 1 : 0;
  const next: CategoryRating = {
    elo: newElo,
    eloPeak: Math.max(c.eloPeak, newElo),
    glicko: newGlicko,
    // Peaks only count once the rating is established (see PROVISIONAL_RD).
    glickoPeak: newGlicko.rd <= PROVISIONAL_RD ? Math.max(c.glickoPeak, newGlicko.rating) : c.glickoPeak,
    played: c.played + 1,
    won: c.won + (outcome === 'win' ? 1 : 0),
    lost: c.lost + (outcome === 'loss' ? 1 : 0),
    drawn: c.drawn + (outcome === 'draw' ? 1 : 0),
    winStreak,
    bestWinStreak: Math.max(c.bestWinStreak ?? 0, winStreak),
    history: { ...c.history, [d]: { elo: newElo, glicko: Math.round(newGlicko.rating) } },
  };
  return { next, res: { elo: newElo, eloDelta, glicko: Math.round(newGlicko.rating), glickoDelta } };
}

function mergeCategory(local: CategoryRating, remote: Partial<CategoryRating> | undefined): CategoryRating {
  if (!remote) return local;
  // The device with more games is authoritative for the live ratings; counters
  // and peaks take the max, day snapshots are unioned.
  const remoteWins = (remote.played ?? 0) > local.played;
  return {
    elo: remoteWins ? (remote.elo ?? local.elo) : local.elo,
    eloPeak: Math.max(local.eloPeak, remote.eloPeak ?? 0),
    glicko: remoteWins && remote.glicko ? remote.glicko : local.glicko,
    glickoPeak: Math.max(local.glickoPeak, remote.glickoPeak ?? 0),
    played: Math.max(local.played, remote.played ?? 0),
    won: Math.max(local.won, remote.won ?? 0),
    lost: Math.max(local.lost, remote.lost ?? 0),
    drawn: Math.max(local.drawn, remote.drawn ?? 0),
    winStreak: remoteWins ? (remote.winStreak ?? 0) : (local.winStreak ?? 0),
    bestWinStreak: Math.max(local.bestWinStreak ?? 0, remote.bestWinStreak ?? 0),
    history: { ...(remote.history ?? {}), ...local.history },
  };
}

/** Read the persisted (zustand) localStorage blob for the old puzzle store. */
function readLegacyPuzzle(): { rating: number; peak: number; played: number; solved: number; history: Record<string, number> } | null {
  try {
    const raw = localStorage.getItem('chesser-puzzle-rating');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = parsed?.state ?? parsed;
    if (!s || typeof s.rating !== 'number') return null;
    return {
      rating: s.rating,
      peak: typeof s.peak === 'number' ? s.peak : s.rating,
      played: typeof s.played === 'number' ? s.played : 0,
      solved: typeof s.solved === 'number' ? s.solved : 0,
      history: s.history && typeof s.history === 'object' ? s.history : {},
    };
  } catch {
    return null;
  }
}

/** Build a puzzles category seeded from a legacy {rating,...} snapshot. */
function categoryFromLegacy(l: { rating: number; peak: number; played: number; solved: number; history: Record<string, number> }): CategoryRating {
  const history: Record<string, DaySnapshot> = {};
  for (const [day, r] of Object.entries(l.history)) {
    if (typeof r === 'number') history[day] = { elo: r, glicko: r };
  }
  return {
    elo: l.rating,
    eloPeak: Math.max(l.peak, l.rating),
    // Seed Glicko at the same number but with a moderate deviation — the old Elo
    // already carries real signal, so we don't start it wide-open at 350.
    glicko: { rating: l.rating, rd: l.played >= 50 ? 90 : l.played >= 10 ? 150 : 250, vol: 0.06 },
    glickoPeak: Math.max(l.peak, l.rating),
    played: l.played,
    won: l.solved,
    lost: Math.max(0, l.played - l.solved),
    drawn: 0,
    winStreak: 0,
    bestWinStreak: 0,
    history,
  };
}

export const useRatings = create<RatingsState>()(
  persist(
    (set, get) => ({
      categories: freshBook(),
      legacyMigrated: false,

      record(category, opponentRating, outcome) {
        const c = get().categories[category];
        const { next, res } = applyRecord(c, opponentRating, outcome);
        set({ categories: { ...get().categories, [category]: next } });
        return res;
      },

      decisionRating(category) {
        return Math.round(get().categories[category].glicko.rating);
      },

      // One-time import of the pre-split single Elo puzzle rating.
      migrateLegacy() {
        if (get().legacyMigrated) return;
        const legacy = readLegacyPuzzle();
        if (legacy && legacy.played > 0) {
          const seeded = categoryFromLegacy(legacy);
          // Only overwrite if the fresh puzzles category hasn't been used yet.
          const cur = get().categories.puzzles;
          if (cur.played === 0) set({ categories: { ...get().categories, puzzles: seeded } });
        }
        set({ legacyMigrated: true });
      },

      exportState() {
        return { categories: get().categories, legacyMigrated: get().legacyMigrated };
      },

      legacyPuzzleExport() {
        const p = get().categories.puzzles;
        const history: Record<string, number> = {};
        for (const [day, snap] of Object.entries(p.history)) history[day] = snap.elo;
        return { rating: Math.round(p.elo), peak: Math.round(p.eloPeak), played: p.played, solved: p.won, history };
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as { categories?: Partial<Record<RatingCategory, Partial<CategoryRating>>> };
        if (!r.categories) return;
        const merged = { ...get().categories };
        for (const cat of RATING_CATEGORIES) merged[cat] = mergeCategory(merged[cat], r.categories[cat]);
        set({ categories: merged });
      },

      importLegacyPuzzle(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as { rating?: number; peak?: number; played?: number; solved?: number; history?: Record<string, number> };
        if (typeof r.rating !== 'number') return;
        const merged = mergeCategory(
          get().categories.puzzles,
          categoryFromLegacy({
            rating: r.rating,
            peak: r.peak ?? r.rating,
            played: r.played ?? 0,
            solved: r.solved ?? 0,
            history: r.history ?? {},
          }),
        );
        set({ categories: { ...get().categories, puzzles: merged } });
      },

      reset() {
        set({ categories: freshBook(), legacyMigrated: true });
      },
    }),
    { name: 'chesser-ratings' },
  ),
);
