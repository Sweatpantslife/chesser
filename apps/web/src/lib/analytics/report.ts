/**
 * Report assembly for the game-review overhaul: the adapter from the store's
 * raw review outputs to canonical {@link MoveRow}s, the orchestrator that
 * turns rows into a full {@link AnalysisReport}, and the report cache.
 *
 * `buildRows` / `buildAnalysisReport` / `reportCacheKey` / `serializeReport` /
 * `deserializeReport` are PURE (deterministic given inputs, up to `createdAt`).
 * The localStorage cache functions at the bottom are the ONLY impure corner of
 * lib/analytics — they swallow every storage error (quota, private mode, no
 * DOM) and behave as cache misses.
 */
import type { AnalysisLine, Score } from '@chesser/shared';
import { checkmateWinner } from '../coach';
import type { MoveReview, PositionEval } from '../coach';
import { acpl, gameAccuracy, moveAccuracy, winPercent } from './accuracy';
import { classificationCounts, classifyAll } from './classify';
import { explainMove } from './explain';
import { detectPhases, findCriticalMoments, phaseBreakdown } from './phases';
import { estimatePerformanceRating } from './rating';
import { CLASSIFICATION_GLYPH } from './types';
import type {
  AnalysisReport,
  EngineReviewSettings,
  EvalPoint,
  MoveDetail,
  MoveRow,
  PlayerSummary,
  ReportMeta,
  Side,
} from './types';

/** Serialized-report shape version; deserializeReport rejects mismatches. */
export const REPORT_VERSION = 1;

/**
 * The review budget — the single source of truth for the engine options
 * reviewGame runs with (store/game.ts imports this constant and spreads it
 * into `analyzeManyOnce`, then passes it back through {@link ReviewRowsInput}
 * so `report.meta.engine` and the cache key describe the settings the evals
 * actually came from; changing the budget auto-invalidates every cached
 * report). movetimeMs 0 means NO wall-clock cap: the server then issues
 * `go depth N` — a fixed-depth search on a fresh hash table is deterministic
 * (identical grades/accuracy run to run) and device-independent, unlike the
 * previous 300 ms wall-clock budget.
 */
export const REVIEW_ENGINE_SETTINGS: EngineReviewSettings = { multipv: 2, movetimeMs: 0, depth: 18 };

/** Everything the existing review pipeline produced, straight from the store. */
export interface ReviewRowsInput {
  startFen: string;
  /** Mainline nodes in order (subset of the store's MoveNode). */
  nodes: ReadonlyArray<{ id: string; san: string; uci: string; fen: string; ply: number }>;
  /** evals[0] = startFen, evals[i] = after nodes[i-1] (length = nodes+1). */
  evals: ReadonlyArray<PositionEval>;
  /** Raw multipv lines per position, same indexing; optional (PV enrichment). */
  rawLines?: ReadonlyArray<AnalysisLine[]>;
  /** The existing review's grades, keyed by node id. */
  moveReviews: Readonly<Record<string, MoveReview>>;
  /** Leading plies still in theory (reviewGame's bookPly). */
  bookPly: number;
  /**
   * The engine options the review's eval loop ACTUALLY ran with (stamped into
   * report.meta.engine → the cache key, so a budget change self-invalidates
   * cached reports). Defaults to {@link REVIEW_ENGINE_SETTINGS} when absent.
   */
  engine?: EngineReviewSettings;
}

/** Score (White POV, from the server) → EvalPoint. Exactly one field set. */
function toEvalPoint(score: Score | null | undefined): EvalPoint | null {
  if (!score) return null;
  return score.kind === 'mate' ? { mate: score.value } : { cp: score.value };
}

/**
 * Pure adapter store-data → canonical rows, one per played mainline move.
 * Evals stay White-POV throughout (see types.ts for the sign conventions);
 * a missing engine eval becomes null with a neutral 50% win chance.
 */
export function buildRows(input: ReviewRowsInput): MoveRow[] {
  const { startFen, nodes, evals, rawLines, moveReviews, bookPly } = input;
  const rows: MoveRow[] = [];

  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k]!;
    const fenBefore = k === 0 ? startFen : nodes[k - 1]!.fen;
    // The mover comes from the FEN's side-to-move field, not ply parity —
    // games starting from an arbitrary position (e.g. "Practice this
    // position") can have Black move first. Identical for standard games.
    const fenTurn = fenBefore.split(' ')[1];
    const side: Side = fenTurn === 'b' || fenTurn === 'w' ? (fenTurn === 'b' ? 'black' : 'white') : node.ply % 2 === 1 ? 'white' : 'black';
    const pre = evals[k] ?? null;
    const post = evals[k + 1] ?? null;

    const evalBefore = toEvalPoint(pre?.score);
    const evalAfter = toEvalPoint(post?.score);
    const winBefore = winPercent(evalBefore);
    const winAfter = winPercent(evalAfter);

    const review = moveReviews[node.id] ?? null;
    const bestMoveSan = pre?.bestSan ?? null;
    const pvSan = rawLines?.[k]?.[0]?.pvSan;
    // Delivered mate, from data: the SAN '#' suffix is the fast path (SANs come
    // from chess.js), cross-checked with checkmateWinner (lib/coach) so a
    // malformed/imported SAN cannot hide a mate from the grading overrides.
    const isMate = node.san.endsWith('#') || checkmateWinner(node.fen) === side;

    rows.push({
      ply: node.ply,
      side,
      san: node.san,
      uci: node.uci,
      fenBefore,
      fenAfter: node.fen,
      evalBefore,
      evalAfter,
      winBefore,
      winAfter,
      // A delivered mate is a perfect move whatever the (often missing) final
      // eval says.
      moveAccuracy: isMate ? 100 : moveAccuracy(winBefore, winAfter, side),
      coachGrade: review?.classification ?? null,
      coachExplanation: review?.explanation ?? null,
      evalText: review?.evalText ?? null,
      bestMoveSan,
      bestMoveUci: pre?.bestUci ?? null,
      bestReplySan: post?.bestSan ?? null,
      bestReplyUci: post?.bestUci ?? null,
      pv: pvSan && pvSan.length > 0 ? [...pvSan] : bestMoveSan ? [bestMoveSan] : [],
      secondEvalBefore: toEvalPoint(pre?.secondScore),
      isMate,
      isCheck: /[+#]$/.test(node.san),
      isBook: node.ply <= bookPly,
      nodeId: node.id,
    });
  }

  return rows;
}

/**
 * Pure assembly of the full report: final grades (classify) + prose (explain)
 * per move, per-side summaries (accuracy/ACPL/counts), phase breakdown,
 * critical moments and the heuristic performance-rating estimate.
 */
export function buildAnalysisReport(
  rows: MoveRow[],
  meta: ReportMeta,
  opening: { eco: string | null; name: string | null; leftTheoryAtPly: number },
): AnalysisReport {
  const classifications = classifyAll(rows);
  const moves: MoveDetail[] = rows.map((row, i) => {
    const classification = classifications[i]!;
    return {
      ...row,
      classification,
      glyph: CLASSIFICATION_GLYPH[classification],
      explanation: explainMove(row, classification),
    };
  });

  const counts = classificationCounts(moves);
  const summary = (side: Side): PlayerSummary => ({
    accuracy: gameAccuracy(rows, side),
    acpl: acpl(rows, side),
    moves: rows.filter((r) => r.side === side).length,
    counts: counts[side],
  });
  const white = summary('white');
  const black = summary('black');

  return {
    version: REPORT_VERSION,
    createdAt: Date.now(),
    gameKey: reportCacheKey(
      meta.startFen,
      rows.map((r) => r.uci),
      meta.engine,
    ),
    meta,
    white,
    black,
    opening: { eco: opening.eco, name: opening.name, leftTheoryAtPly: opening.leftTheoryAtPly },
    phases: phaseBreakdown(rows, detectPhases(rows, opening.leftTheoryAtPly)),
    criticalMoments: findCriticalMoments(moves),
    estimatedPerformanceRating: {
      white: estimatePerformanceRating(white),
      black: estimatePerformanceRating(black),
    },
    moves,
  };
}

/** FNV-1a 32-bit hash, as 8 lowercase hex chars. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Content-derived cache key. Node ids are runtime-only, so the key hashes the
 * game content (start position + move list) plus the engine settings the
 * review ran with.
 */
export function reportCacheKey(startFen: string, ucis: string[], engine: EngineReviewSettings): string {
  return `carv1:${fnv1a(`${startFen}\n${ucis.join(' ')}\n${engine.multipv}:${engine.movetimeMs}:${engine.depth}`)}`;
}

/** JSON-encode a report (every report field is JSON-safe by construction). */
export function serializeReport(report: AnalysisReport): string {
  return JSON.stringify(report);
}

/**
 * A serialized move row plausibly is a MoveDetail — guards the fields the
 * hydration path dereferences, so a hand-edited / partially written cache
 * entry behaves as a miss instead of hydrating NaNs into the review UI.
 */
function isPlausibleMove(m: unknown): boolean {
  if (typeof m !== 'object' || m === null) return false;
  const move = m as Record<string, unknown>;
  return (
    typeof move.ply === 'number' &&
    typeof move.san === 'string' &&
    typeof move.uci === 'string' &&
    (move.side === 'white' || move.side === 'black') &&
    typeof move.winBefore === 'number' &&
    typeof move.winAfter === 'number' &&
    typeof move.classification === 'string' &&
    typeof move.explanation === 'string'
  );
}

/**
 * A serialized player summary carries the numeric fields the hydration path
 * and ReviewSummary dereference (accuracy/acpl/moves plus the counts grid).
 */
function isPlausibleSummary(p: unknown): boolean {
  if (typeof p !== 'object' || p === null) return false;
  const s = p as Record<string, unknown>;
  return (
    typeof s.accuracy === 'number' &&
    typeof s.acpl === 'number' &&
    typeof s.moves === 'number' &&
    typeof s.counts === 'object' &&
    s.counts !== null
  );
}

/**
 * Parse a serialized report. Returns null on parse errors, a version
 * mismatch, malformed move rows or a truncated top-level shape (a tampered
 * cache entry must read as a miss, not hydrate NaNs / throw in the UI).
 * Node ids are runtime-only, so cached rows come back with `nodeId: null` —
 * callers must re-map moves by ply.
 */
export function deserializeReport(json: string): AnalysisReport | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const report = parsed as AnalysisReport;
    if (report.version !== REPORT_VERSION || typeof report.gameKey !== 'string' || !Array.isArray(report.moves)) {
      return null;
    }
    const rating: unknown = report.estimatedPerformanceRating;
    if (
      typeof report.meta !== 'object' ||
      report.meta === null ||
      typeof report.opening !== 'object' ||
      report.opening === null ||
      // theoryText renders "left theory at move N" from this — a corrupt entry
      // must not hydrate NaN into the opening card.
      typeof report.opening.leftTheoryAtPly !== 'number' ||
      !Array.isArray(report.phases) ||
      !Array.isArray(report.criticalMoments) ||
      !isPlausibleSummary(report.white) ||
      !isPlausibleSummary(report.black) ||
      typeof rating !== 'object' ||
      rating === null ||
      typeof (rating as Record<string, unknown>).white !== 'number' ||
      typeof (rating as Record<string, unknown>).black !== 'number'
    ) {
      return null;
    }
    if (!report.moves.every(isPlausibleMove)) return null;
    return { ...report, moves: report.moves.map((m) => ({ ...m, nodeId: null })) };
  } catch {
    return null;
  }
}

// --- localStorage report cache (LRU, quota-safe) ----------------------------

const ENTRY_PREFIX = 'chesser-report:';
const INDEX_KEY = 'chesser-report-index';
const MAX_CACHED_REPORTS = 20;

/** localStorage, or null when unavailable (node, blocked storage access). */
function storageArea(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The LRU index: gameKeys, most recently used first. */
function readIndex(store: Storage): string[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Move gameKey to the front of the index; evict entries beyond the cap. */
function touchIndex(store: Storage, gameKey: string): void {
  try {
    const keys = [gameKey, ...readIndex(store).filter((k) => k !== gameKey)];
    for (const evicted of keys.slice(MAX_CACHED_REPORTS)) store.removeItem(ENTRY_PREFIX + evicted);
    store.setItem(INDEX_KEY, JSON.stringify(keys.slice(0, MAX_CACHED_REPORTS)));
  } catch {
    // Best-effort bookkeeping — a failed refresh must not break the caller.
  }
}

/** Cached report for a gameKey, or null. A hit refreshes its LRU position. */
export function loadCachedReport(gameKey: string): AnalysisReport | null {
  const store = storageArea();
  if (!store) return null;
  try {
    const raw = store.getItem(ENTRY_PREFIX + gameKey);
    if (!raw) return null;
    const report = deserializeReport(raw);
    if (!report) {
      // Corrupt or outdated entry — drop it so it stops occupying quota.
      store.removeItem(ENTRY_PREFIX + gameKey);
      store.setItem(INDEX_KEY, JSON.stringify(readIndex(store).filter((k) => k !== gameKey)));
      return null;
    }
    touchIndex(store, gameKey);
    return report;
  } catch {
    return null;
  }
}

/** Store a report under its gameKey, evicting least-recently-used entries. */
export function saveCachedReport(report: AnalysisReport): void {
  const store = storageArea();
  if (!store) return;
  try {
    store.setItem(ENTRY_PREFIX + report.gameKey, serializeReport(report));
    touchIndex(store, report.gameKey);
  } catch {
    // Quota exceeded / private mode — behave as a cache miss.
  }
}

/** Remove every cached report and the LRU index. */
export function clearReportCache(): void {
  const store = storageArea();
  if (!store) return;
  try {
    for (const key of readIndex(store)) store.removeItem(ENTRY_PREFIX + key);
    store.removeItem(INDEX_KEY);
  } catch {
    // Same quota-safe contract as the other cache functions.
  }
}
