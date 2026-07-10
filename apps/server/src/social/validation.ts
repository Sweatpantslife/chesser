/**
 * Server-side anti-cheat validation for leaderboard submissions
 * (POST /api/leaderboard/submit).
 *
 * Follows the same doctrine as accounts/progress-validator.ts (PR #27): the
 * server NEVER trusts a client-claimed score. Per board:
 *
 *  1. Absolute bounds      — ratings within [100, 3600] (the same plausibility
 *                            window the progress validator enforces), puzzle
 *                            rush within [0, 200]; malformed values rejected.
 *  2. Cross-check          — the strongest rule: rating boards are checked
 *                            against the account's *stored, already-validated*
 *                            progress blob. The synced blob went through the
 *                            full PR #27 pipeline (per-game delta bounds,
 *                            per-day caps, monotonic merge), so the leaderboard
 *                            inherits all of it. A claim that doesn't match the
 *                            synced rating is rejected, and what gets ranked is
 *                            the SERVER's copy of the value, never the claim.
 *  3. Monotonicity         — puzzle rush is a best-score board: an entry only
 *                            ever improves. A lower/equal resubmission is a
 *                            duplicate no-op (idempotent, not an error), so
 *                            replaying an old submission can't inflate or
 *                            churn the board.
 *  4. Rate limits          — accepted *changes* per board are spaced at least
 *                            SUBMIT_INTERVAL_MS apart. Rating values only move
 *                            with new games in the synced blob (enforced via
 *                            the played counter), and rush improvements can't
 *                            arrive faster than a run could actually be played.
 *
 * Known accepted limitation (mirrors PR #27's notes): until the puzzle-rush
 * best score is part of the synced progress blob, a rush claim can only be
 * bounded (range, monotonic, rate), not proven. `extractRushBest` already
 * looks for the value in the places the sync payload is expected to carry it
 * (`rush.best` / `puzzleRushBest` / …) — the moment a client starts syncing
 * it, the cross-check turns on with no server change.
 */

import { isoWeekKey } from './week.js';

// ---------------------------------------------------------------------------
// Boards & limits
// ---------------------------------------------------------------------------

/** The three async boards: puzzle rating, bot-game rating, puzzle-rush best. */
export type BoardId = 'puzzles' | 'bots' | 'rush';
export const BOARDS: BoardId[] = ['puzzles', 'bots', 'rush'];
export const isBoardId = (v: unknown): v is BoardId => typeof v === 'string' && (BOARDS as string[]).includes(v);

export const LB_LIMITS = {
  /** Same plausibility window as accounts/progress-validator LIMITS. */
  ratingFloor: 100,
  ratingCeil: 3600,
  /** Rounding slack between the client's displayed rating and the synced float. */
  ratingTolerance: 1,
  /** Max Elo K-factor is 40 client-side; one game moves a rating ≤ 40 points. */
  eloDeltaPerGame: 40,
  /** A 5-minute, 3-strike rush run plausibly tops out far below this. */
  rushCap: 200,
  /** Min spacing between accepted score *changes* per user+board. */
  submitIntervalMs: 20_000,
  /** Weekly buckets kept per entry (~2 months of history). */
  weeklyKeep: 8,
} as const;

// ---------------------------------------------------------------------------
// Stored entry shape (what the social store keeps per user+board)
// ---------------------------------------------------------------------------

export interface BoardEntry {
  /** The ranked value (rating, or rush best). Server-derived where possible. */
  value: number;
  /** Games/puzzles played when the value was accepted (rating boards). */
  played?: number;
  /** Epoch ms of the last accepted change. */
  updatedAt: number;
  /** Best value reached per ISO week key (weekly boards). */
  weekly: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Reading the validated progress blob (accounts store, read-only)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface BlobCategory {
  elo: number;
  eloPeak: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
}

/** Pull one rating category out of the stored (already validated) blob. */
export function extractCategory(blob: unknown, cat: 'puzzles' | 'bots' | 'blitz'): BlobCategory | null {
  if (!isObj(blob)) return null;
  const ratings = blob.ratings;
  if (!isObj(ratings) || !isObj(ratings.categories)) return null;
  const c = (ratings.categories as Record<string, unknown>)[cat];
  if (!isObj(c) || !isNum(c.elo)) return null;
  return {
    elo: c.elo,
    eloPeak: isNum(c.eloPeak) ? c.eloPeak : c.elo,
    played: isNum(c.played) ? c.played : 0,
    won: isNum(c.won) ? c.won : 0,
    drawn: isNum(c.drawn) ? c.drawn : 0,
    lost: isNum(c.lost) ? c.lost : 0,
  };
}

/**
 * Extraction of the synced puzzle-rush best score. The canonical location is
 * the `sprints` section (apps/web/src/store/sprints.ts, PR #30):
 * `sprints.puzzleRushBest.{timed3,survival}.score` — the board ranks the best
 * across both rush modes. The legacy probes below cover older/simpler shapes
 * so the cross-check works during the transition. Returns null when the blob
 * doesn't carry the stat at all (then only bounds/monotonic/rate rules apply).
 */
export function extractRushBest(blob: unknown): number | null {
  if (!isObj(blob)) return null;
  const candidates: unknown[] = [];
  // Canonical: sprints.puzzleRushBest.{timed3,survival}.score
  if (isObj(blob.sprints) && isObj(blob.sprints.puzzleRushBest)) {
    for (const mode of ['timed3', 'survival']) {
      const entry = (blob.sprints.puzzleRushBest as Record<string, unknown>)[mode];
      if (isObj(entry)) candidates.push(entry.score);
    }
  }
  // Legacy / transitional shapes.
  candidates.push(
    (isObj(blob.rush) ? blob.rush : {}).best,
    (isObj(blob.rush) ? blob.rush : {}).highScore,
    (isObj(blob.puzzleRush) ? blob.puzzleRush : {}).best,
    (isObj(blob.puzzleRush) ? blob.puzzleRush : {}).highScore,
    blob.puzzleRushBest,
  );
  let best: number | null = null;
  for (const c of candidates) {
    if (isNum(c) && c >= 0 && (best === null || c > best)) best = Math.floor(c);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

export type SubmitOutcome =
  | { ok: true; changed: true; entry: BoardEntry }
  | { ok: true; changed: false; entry: BoardEntry; note: string }
  | { ok: false; status: 400 | 429; error: string };

/** Apply `value` to the weekly buckets (best-of per week, pruned). */
function bumpWeekly(weekly: Record<string, number>, weekKey: string, value: number, keep: number): Record<string, number> {
  const next = { ...weekly, [weekKey]: Math.max(weekly[weekKey] ?? -Infinity, value) };
  const keys = Object.keys(next).sort(); // week keys sort lexicographically
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete next[k];
  return next;
}

/**
 * Validate one submission. Pure: everything time- or state-dependent comes in
 * as a parameter (`nowMs` from the injected clock, `existing` from the store,
 * `blob` from the accounts store).
 */
export function validateSubmission(
  board: BoardId,
  rawValue: unknown,
  existing: BoardEntry | null,
  blob: unknown,
  nowMs: number,
): SubmitOutcome {
  if (!isNum(rawValue)) return { ok: false, status: 400, error: 'Score must be a finite number.' };
  const claim = Math.round(rawValue);
  const weekKey = isoWeekKey(nowMs);

  if (board === 'rush') {
    // 1. Absolute bounds.
    if (claim < 0 || claim > LB_LIMITS.rushCap) {
      return { ok: false, status: 400, error: `A Puzzle Rush score of ${claim} is outside the plausible range 0–${LB_LIMITS.rushCap}.` };
    }
    // 2. Cross-check against the synced blob when the stat is there.
    const synced = extractRushBest(blob);
    if (synced !== null && claim > synced) {
      return { ok: false, status: 400, error: `Claimed rush best ${claim} exceeds your synced best of ${synced}. Sync your progress first.` };
    }
    // 3. Monotonic best-score board: lower/equal is a duplicate no-op.
    if (existing && claim <= existing.value) {
      return { ok: true, changed: false, entry: existing, note: `Kept your best of ${existing.value}.` };
    }
    if (claim === 0) {
      return { ok: false, status: 400, error: 'Play a Puzzle Rush run first.' };
    }
    // 4. Rate limit improvements — a real run takes minutes.
    if (existing && nowMs - existing.updatedAt < LB_LIMITS.submitIntervalMs) {
      return { ok: false, status: 429, error: 'Too many score updates — try again in a moment.' };
    }
    return {
      ok: true,
      changed: true,
      entry: { value: claim, updatedAt: nowMs, weekly: bumpWeekly(existing?.weekly ?? {}, weekKey, claim, LB_LIMITS.weeklyKeep) },
    };
  }

  // Rating boards ('puzzles' | 'bots').
  // 1. Absolute bounds (cheap pre-check; the blob value is bounds-checked by
  //    the progress validator, but reject nonsense before touching the store).
  if (claim < LB_LIMITS.ratingFloor || claim > LB_LIMITS.ratingCeil) {
    return {
      ok: false,
      status: 400,
      error: `A rating of ${claim} is outside the plausible range ${LB_LIMITS.ratingFloor}–${LB_LIMITS.ratingCeil}.`,
    };
  }
  // 2. Cross-check: the claim must match the server's validated copy, and the
  //    validated copy is what gets ranked.
  const cat = extractCategory(blob, board);
  if (!cat) {
    return { ok: false, status: 400, error: 'No synced rating found for this board — sign in and sync your progress first.' };
  }
  if (cat.played < 1) {
    return { ok: false, status: 400, error: 'Play at least one rated game before joining this board.' };
  }
  const serverValue = Math.round(cat.elo);
  if (Math.abs(claim - serverValue) > LB_LIMITS.ratingTolerance) {
    return { ok: false, status: 400, error: `Claimed rating ${claim} doesn't match your synced rating of ${serverValue}.` };
  }

  if (existing) {
    // 3. Duplicate no-op: nothing moved since the last accepted entry.
    if (existing.value === serverValue && (existing.played ?? 0) === cat.played) {
      return { ok: true, changed: false, entry: existing, note: 'Already up to date.' };
    }
    // 4a. Defense in depth on top of the blob validation: a rating can only
    //     move with new games, and only within the per-game bound.
    const newGames = cat.played - (existing.played ?? 0);
    if (serverValue !== existing.value) {
      if (newGames <= 0) {
        return { ok: false, status: 400, error: 'Rating changed without any new games — resync your progress.' };
      }
      if (Math.abs(serverValue - existing.value) > LB_LIMITS.eloDeltaPerGame * newGames) {
        return {
          ok: false,
          status: 400,
          error: `A rating jump of ${Math.abs(serverValue - existing.value)} over ${newGames} game(s) is implausible.`,
        };
      }
    }
    // 4b. Rate limit accepted changes.
    if (nowMs - existing.updatedAt < LB_LIMITS.submitIntervalMs) {
      return { ok: false, status: 429, error: 'Too many score updates — try again in a moment.' };
    }
  }

  return {
    ok: true,
    changed: true,
    entry: {
      value: serverValue,
      played: cat.played,
      updatedAt: nowMs,
      weekly: bumpWeekly(existing?.weekly ?? {}, weekKey, serverValue, LB_LIMITS.weeklyKeep),
    },
  };
}

// ---------------------------------------------------------------------------
// Share prefs + profile display data sanitizing
// ---------------------------------------------------------------------------

/** Everything is opt-IN: nothing is exposed until the user flips it on. */
export interface SocialPrefs {
  /** Appear on the public leaderboards. */
  leaderboards: boolean;
  /** Serve a public profile page at /api/social/profile/:username. */
  profile: boolean;
  showRatings: boolean;
  showRush: boolean;
  showStreak: boolean;
  showAchievements: boolean;
  showOpenings: boolean;
  showRecord: boolean;
}

export const DEFAULT_PREFS: SocialPrefs = {
  leaderboards: false,
  profile: false,
  showRatings: false,
  showRush: false,
  showStreak: false,
  showAchievements: false,
  showOpenings: false,
  showRecord: false,
};

const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof SocialPrefs)[];

/** Merge a partial prefs patch onto `base`, coercing every value to boolean. */
export function sanitizePrefs(base: SocialPrefs, patch: unknown): SocialPrefs {
  const next = { ...base };
  if (!isObj(patch)) return next;
  for (const k of PREF_KEYS) if (k in patch) next[k] = patch[k] === true;
  return next;
}

/**
 * Favorite openings are cosmetic display data (names + counts), not score
 * claims — but they're still bounded and sanitized, never stored raw.
 */
export interface FavoriteOpening {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
}

const MAX_OPENINGS = 5;
const COUNT_CAP = 1_000_000;

export function sanitizeOpenings(raw: unknown): FavoriteOpening[] {
  if (!Array.isArray(raw)) return [];
  const out: FavoriteOpening[] = [];
  // Cap on VALID items, not raw indices — junk entries early in the array
  // must not push valid ones past the cut.
  for (const item of raw) {
    if (out.length >= MAX_OPENINGS) break;
    if (!isObj(item) || typeof item.name !== 'string') continue;
    const name = item.name.trim().slice(0, 80);
    if (!name) continue;
    const eco = typeof item.eco === 'string' && /^[A-E]\d{2}$/.test(item.eco) ? item.eco : null;
    const games = isNum(item.games) ? Math.min(Math.max(0, Math.floor(item.games)), COUNT_CAP) : 0;
    const wins = isNum(item.wins) ? Math.min(Math.max(0, Math.floor(item.wins)), games) : 0;
    out.push({ name, eco, games, wins });
  }
  return out;
}
