/**
 * Puzzle service — the one place that owns *selection* of bundled tactics
 * puzzles. The UI pages ask this module for "the next puzzle for a player
 * rated R" instead of slicing the PUZZLES array themselves.
 *
 * Data sources (see docs/puzzles-dataset.md):
 *  - Embedded core: `PUZZLES` from trainers/tactics (15 legacy + ~1,500
 *    Lichess core puzzles) — available synchronously, works offline.
 *  - Full dataset: public/puzzles/band-*.json (5,000 puzzles per 200-Elo
 *    band), fetched lazily per band and merged into the in-memory pool.
 *    If a band fetch fails (offline, missing file) the service simply keeps
 *    serving from what is already loaded — the trainer never breaks.
 *
 * Rating updates go through the EXISTING Elo/Glicko-2 book in store/ratings
 * (via lib/gamify.recordPuzzle); solved-puzzle persistence goes through the
 * EXISTING SRS progress store (cards keyed `tactics:<id>`). No new stores.
 */
import { Chess } from 'chess.js';
import {
  CORE_PUZZLES,
  PUZZLES,
  PUZZLE_BANDS,
  decodePuzzleRow,
  type Difficulty,
  type Puzzle,
  type PuzzleRow,
} from '../trainers/tactics';
import { puzzleRatingOf } from './puzzleRating';
import { classifyMotifs, type Motif } from './motifs';
import { recordPuzzle } from './gamify';
import { useProgress } from '../store/progress';

// ---------------------------------------------------------------------------
// Pool: embedded core (sync) + lazily fetched rating bands
// ---------------------------------------------------------------------------

// Band layout: PUZZLE_BANDS in trainers/tactics — the layout produced by
// scripts/import-lichess-puzzles.mjs and asserted by scripts/validate-puzzles.mts.

const byId = new Map<string, Puzzle>();
const pool: Puzzle[] = [];
for (const p of PUZZLES) {
  byId.set(p.id, p);
  pool.push(p);
}

type BandState =
  | { kind: 'idle' }
  | { kind: 'loading'; promise: Promise<void> }
  | { kind: 'loaded' }
  | { kind: 'failed'; at: number };

const bandStates: BandState[] = PUZZLE_BANDS.map(() => ({ kind: 'idle' }));

/** After a failed fetch (e.g. offline), wait this long before retrying. */
const FAILED_RETRY_MS = 60_000;

function loadBand(i: number): Promise<void> {
  const st = bandStates[i];
  if (!st || st.kind === 'loaded') return Promise.resolve();
  if (st.kind === 'loading') return st.promise;
  if (st.kind === 'failed' && Date.now() - st.at < FAILED_RETRY_MS) return Promise.resolve();
  const band = PUZZLE_BANDS[i]!;
  const base = import.meta.env?.BASE_URL ?? '/';
  const promise = fetch(`${base}puzzles/${band.file}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows?: PuzzleRow[] };
      for (const row of data.rows ?? []) {
        if (byId.has(row[0])) continue; // core puzzles are a subset of the bands
        const p = decodePuzzleRow(row);
        byId.set(p.id, p);
        pool.push(p);
      }
      bandStates[i] = { kind: 'loaded' };
    })
    .catch(() => {
      // Graceful offline fallback: keep serving the embedded core.
      bandStates[i] = { kind: 'failed', at: Date.now() };
    });
  bandStates[i] = { kind: 'loading', promise };
  return promise;
}

/** Kick off (or await) fetches for every band within `span` of `rating`.
 *  Never rejects — failed bands just stay unavailable until retried. */
export function ensureBandsFor(rating: number, span = 300): Promise<void> {
  const loads: Promise<void>[] = [];
  for (let i = 0; i < PUZZLE_BANDS.length; i++) {
    const b = PUZZLE_BANDS[i]!;
    if (b.max >= rating - span && b.min <= rating + span) loads.push(loadBand(i));
  }
  return Promise.all(loads).then(() => undefined);
}

/** Every puzzle currently in memory (embedded + fetched bands). */
export function getLoadedPuzzles(): readonly Puzzle[] {
  return pool;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export interface ThemeOption {
  tag: string;
  label: string;
}

/** The tags offered in the UI filter (Lichess theme tags). */
export const FILTER_THEMES: ThemeOption[] = [
  { tag: 'mateIn1', label: 'Mate in 1' },
  { tag: 'mateIn2', label: 'Mate in 2' },
  { tag: 'mateIn3', label: 'Mate in 3' },
  { tag: 'fork', label: 'Fork' },
  { tag: 'pin', label: 'Pin' },
  { tag: 'skewer', label: 'Skewer' },
  { tag: 'discoveredAttack', label: 'Discovered attack' },
  { tag: 'backRankMate', label: 'Back rank' },
  { tag: 'hangingPiece', label: 'Hanging piece' },
  { tag: 'endgame', label: 'Endgame' },
];

/** Legacy/user-mined puzzles carry no Lichess tags — approximate the filter
 *  with the heuristic motif classifier where an equivalent motif exists. */
const TAG_TO_MOTIF: Partial<Record<string, Motif>> = {
  mateIn1: 'mateIn1',
  mateIn2: 'mateIn2',
  mateIn3: 'mateIn3',
  fork: 'fork',
  backRankMate: 'backRank',
  endgame: 'endgame',
  promotion: 'promotion',
  sacrifice: 'sacrifice',
};

const motifCache = new Map<string, Motif[]>();
function motifsOf(p: Puzzle): Motif[] {
  let m = motifCache.get(p.id);
  if (!m) {
    m = classifyMotifs(p.fen, p.solution, p.theme);
    motifCache.set(p.id, m);
  }
  return m;
}

/** Does this puzzle match a filter tag? Real Lichess tags win; puzzles
 *  without tags fall back to the heuristic motif classifier. */
export function puzzleHasTheme(p: Puzzle, tag: string): boolean {
  if (p.themes && p.themes.length) return p.themes.includes(tag);
  const motif = TAG_TO_MOTIF[tag];
  return motif ? motifsOf(p).includes(motif) : false;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Ids of puzzles the user has already worked through (persisted SRS cards). */
function seenPuzzleIds(): Set<string> {
  const out = new Set<string>();
  const prefix = 'tactics:';
  for (const k of Object.keys(useProgress.getState().cards)) {
    if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
  }
  return out;
}

export interface NextPuzzleOpts {
  /** The player's puzzle rating (Glicko-2 decision rating). */
  rating: number;
  /** Filter tags — a puzzle matches if it has ANY of them. */
  themes?: string[];
  /** Ids to skip (e.g. already served this session). */
  excludeIds?: Set<string>;
  /** Optional hard difficulty filter on top of the rating window. */
  difficulty?: Difficulty;
}

/**
 * Pick the next puzzle near the player's rating: start with a ±150 window and
 * widen by 150 until candidates exist. Fresh puzzles (never seen, not
 * excluded) are preferred; if the player has exhausted those, previously
 * solved ones are recycled rather than returning nothing. Returns null only
 * when no loaded puzzle matches the theme/difficulty filter at all.
 * Synchronous by design — band fetches are kicked off in the background and
 * enrich the pool for subsequent calls.
 */
export function getNextPuzzle(opts: NextPuzzleOpts): Puzzle | null {
  void ensureBandsFor(opts.rating);
  const seen = seenPuzzleIds();
  const matches = (p: Puzzle): boolean =>
    (!opts.difficulty || p.difficulty === opts.difficulty) &&
    (!opts.themes || opts.themes.length === 0 || opts.themes.some((t) => puzzleHasTheme(p, t)));

  const tiers: ((p: Puzzle) => boolean)[] = [
    (p) => matches(p) && !opts.excludeIds?.has(p.id) && !seen.has(p.id),
    (p) => matches(p) && !opts.excludeIds?.has(p.id),
    (p) => matches(p),
  ];
  for (const tier of tiers) {
    const matched = pool.filter(tier);
    if (matched.length === 0) continue;
    for (let window = 150; window <= 2400; window += 150) {
      const cands = matched.filter((p) => Math.abs(puzzleRatingOf(p) - opts.rating) <= window);
      if (cands.length) return cands[Math.floor(Math.random() * cands.length)]!;
    }
    return matched[Math.floor(Math.random() * matched.length)]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface PuzzleResult {
  elo: number;
  eloDelta: number;
  glicko: number;
  glickoDelta: number;
}

/**
 * Record a rated attempt: updates the player's puzzle rating (existing
 * Elo + Glicko-2 book, category 'puzzles') against the puzzle's own rating,
 * and persists the solved id through the existing SRS progress store so
 * future getNextPuzzle calls dedupe it. Callers that grade the SRS card
 * themselves (TacticsPage does, with more nuance) are respected — the card
 * is only created here when missing.
 */
export function recordResult(puzzle: { id: string; difficulty: Difficulty; rating?: number }, solved: boolean): PuzzleResult {
  const res = recordPuzzle(puzzleRatingOf(puzzle), solved);
  if (solved) {
    const progress = useProgress.getState();
    if (!progress.cards[`tactics:${puzzle.id}`]) progress.grade('tactics', puzzle.id, 'good');
  }
  return res;
}

// ---------------------------------------------------------------------------
// Daily puzzle
// ---------------------------------------------------------------------------

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

let dailyOrder: Puzzle[] | null = null;

/**
 * Deterministic daily puzzle: hash the YYYY-MM-DD string into a stable
 * (id-sorted) ordering of the embedded core set. Same for every user on the
 * same bundle, and fully offline — no fetch involved.
 */
export function getDailyPuzzle(dateStr: string): Puzzle {
  if (!dailyOrder) {
    const base = CORE_PUZZLES.length > 0 ? CORE_PUZZLES : PUZZLES;
    dailyOrder = [...base].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return dailyOrder[fnv1a(dateStr) % dailyOrder.length]!;
}

// ---------------------------------------------------------------------------
// Move acceptance
// ---------------------------------------------------------------------------

export interface KeyMoveCheck {
  ok: boolean;
  /** The played move wasn't the stored one but also mates immediately. */
  altMate: boolean;
  /** Promotion piece to apply for an accepted alternate mate (promotions only). */
  promotion?: string;
}

/**
 * Shared answer check for the player's move against the expected solution
 * move. Exact from/to match is required — Lichess solutions are unique —
 * EXCEPT when the expected move delivers immediate checkmate: then any other
 * move that also mates on the spot is accepted (Lichess convention). For
 * promotions every piece is tried (chess.js lists each promotion choice as
 * its own move), so an under-promotion-only mate is accepted and the mating
 * piece is reported back for the caller to apply.
 */
export function checkKeyMove(fen: string, expectedUci: string, from: string, to: string): KeyMoveCheck {
  if (expectedUci.slice(0, 2) === from && expectedUci.slice(2, 4) === to) return { ok: true, altMate: false };
  try {
    const expected = new Chess(fen);
    expected.move({ from: expectedUci.slice(0, 2), to: expectedUci.slice(2, 4), promotion: expectedUci[4] });
    if (!expected.isCheckmate()) return { ok: false, altMate: false };
    for (const m of new Chess(fen).moves({ verbose: true })) {
      if (m.from !== from || m.to !== to) continue;
      const played = new Chess(fen);
      played.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (played.isCheckmate()) return { ok: true, altMate: true, promotion: m.promotion };
    }
  } catch {
    // illegal move → not accepted
  }
  return { ok: false, altMate: false };
}
