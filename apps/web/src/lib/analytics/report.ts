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
 * The engine settings reviewGame currently runs with (store/game.ts
 * `analyzeManyOnce(fen, {...})`) — the settings half of the cache key.
 * Keep in sync with the store; a change invalidates every cached report.
 */
export const REVIEW_ENGINE_SETTINGS: EngineReviewSettings = { multipv: 2, movetimeMs: 300, depth: 22 };

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
    const side: Side = node.ply % 2 === 1 ? 'white' : 'black';
    const pre = evals[k] ?? null;
    const post = evals[k + 1] ?? null;

    const evalBefore = toEvalPoint(pre?.score);
    const evalAfter = toEvalPoint(post?.score);
    const winBefore = winPercent(evalBefore);
    const winAfter = winPercent(evalAfter);

    const review = moveReviews[node.id] ?? null;
    const bestMoveSan = pre?.bestSan ?? null;
    const pvSan = rawLines?.[k]?.[0]?.pvSan;
    const isMate = node.san.endsWith('#');

    rows.push({
      ply: node.ply,
      side,
      san: node.san,
      uci: node.uci,
      fenBefore: k === 0 ? startFen : nodes[k - 1]!.fen,
      fenAfter: node.fen,
      evalBefore,
      evalAfter,
      winBefore,
      winAfter,
      // A delivered mate is a perfect move whatever the (often missing) final
      // eval says.
      // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
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
 * Parse a serialized report. Returns null on parse errors or a version
 * mismatch. Node ids are runtime-only, so cached rows come back with
 * `nodeId: null` — callers must re-map moves by ply.
 */
export function deserializeReport(json: string): AnalysisReport | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const report = parsed as AnalysisReport;
    if (report.version !== REPORT_VERSION || typeof report.gameKey !== 'string' || !Array.isArray(report.moves)) {
      return null;
    }
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
