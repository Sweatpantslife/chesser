/**
 * Canonical shared types for the game-review analytics layer.
 *
 * Every module under lib/analytics/ is a PURE function over these shapes.
 * report.ts adapts the existing store/coach review outputs into {@link MoveRow}s;
 * everything downstream (accuracy, classify, phases, explain, rating, pgnExport)
 * consumes rows and never reaches into the store.
 *
 * Sign conventions (match what the server/store actually produce):
 *  • All evaluations are WHITE-POV once they leave the server (`toWhiteScore`
 *    in apps/server/src/engine/analysis.ts). `{ cp }` is centipawns, positive =
 *    White better. `{ mate: n }` is mate in n moves, positive = White mates,
 *    negative = Black mates. Exactly one of cp/mate is set on an EvalPoint.
 *  • Win percentages are 0–100 from WHITE's perspective (same as the store's
 *    `evalGraph`). Mover-POV values are derived: side === 'white' ? w : 100 - w.
 *  • The win% curve is `whiteWinPercent` (lib/format.ts): cp clamped to ±1500,
 *    logistic 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1); mate → 0/100.
 *  • Centipawn maths (ACPL etc.) clamps mate to ±1500 like `cpOf` (lib/coach.ts).
 *  • `ply` is 1-based over the mainline; odd ply = White moved. An eval array of
 *    a reviewed game has plies+1 entries: index i = position BEFORE ply i+1.
 */
import type { Classification, Side } from '../coach';

export type { Classification, Side };

/** Engine evaluation of a position, White POV. Exactly one field is set. */
export interface EvalPoint {
  /** Centipawns, positive = White better. */
  cp?: number;
  /** Mate in N moves; positive = White mates, negative = Black mates. */
  mate?: number;
}

/**
 * Report-layer glyphs (PGN comments, summary chips, graph markers).
 * The move list keeps using CLASSIFICATION_META.glyph from lib/coach.ts.
 */
export const CLASSIFICATION_GLYPH: Record<Classification, string> = {
  brilliant: '!!',
  great: '!',
  best: '✓',
  good: '⋯',
  book: '◫',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  miss: '✗',
};

/**
 * The canonical per-move input row every analytics module consumes.
 * Built once per review by report.ts (`buildRows`) from the store's raw data.
 */
export interface MoveRow {
  /** 1-based mainline ply; odd = White's move. */
  ply: number;
  side: Side;
  san: string;
  uci: string;
  /** Position before the move (FEN). */
  fenBefore: string;
  /** Position after the move (FEN). */
  fenAfter: string;
  /** Eval of fenBefore / fenAfter, White POV. Null when the engine gave none. */
  evalBefore: EvalPoint | null;
  evalAfter: EvalPoint | null;
  /** White's win chance (0–100) before / after the move. */
  winBefore: number;
  winAfter: number;
  /** Per-move accuracy 0–100 (Lichess curve over the mover's win% drop). */
  moveAccuracy: number;
  /** Grade + prose from the EXISTING review (lib/coach.ts), when available. */
  coachGrade: Classification | null;
  coachExplanation: string | null;
  /** Pre-formatted White-POV eval after the move ("+1.24", "#3"), if graded. */
  evalText: string | null;
  /** Engine's best move in fenBefore. */
  bestMoveSan: string | null;
  bestMoveUci: string | null;
  /** Engine's best reply in fenAfter (the opponent's best answer). */
  bestReplySan: string | null;
  bestReplyUci: string | null;
  /** Engine PV from fenBefore, in SAN. May be just [bestMoveSan] or empty. */
  pv: string[];
  /** Eval of the runner-up move in fenBefore (only-move detection). */
  secondEvalBefore: EvalPoint | null;
  /** This move delivered checkmate (detected from the SAN suffix '#'). */
  isMate: boolean;
  /** This move gave check (SAN ends '+' or '#'). */
  isCheck: boolean;
  /** Still inside known opening theory (ply <= bookPly from the review). */
  isBook: boolean;
  /** Variation-tree node id. Runtime-only — NOT stable across sessions. */
  nodeId: string | null;
}

/** A row enriched with the report's final verdict (classify + explain). */
export interface MoveDetail extends MoveRow {
  classification: Classification;
  glyph: string;
  explanation: string;
}

export type PhaseName = 'opening' | 'middlegame' | 'endgame';

/** Accuracy aggregates for one side over some span of moves. */
export interface SideAccuracy {
  /** 0–100, one decimal. */
  accuracy: number;
  /** Average centipawn loss (mate clamped to ±1500). */
  acpl: number;
  moves: number;
}

export interface PhaseStats {
  phase: PhaseName;
  /** First / last mainline ply of the phase (inclusive); 0 moves = empty phase. */
  startPly: number;
  endPly: number;
  white: SideAccuracy;
  black: SideAccuracy;
}

export type CriticalMomentKind = 'blunder' | 'missed-win' | 'turnaround' | 'brilliant' | 'mate';

export interface CriticalMoment {
  ply: number;
  san: string;
  side: Side;
  kind: CriticalMomentKind;
  /** Absolute White-POV win% change across the move. */
  winSwing: number;
  /** One-line human description ("14. Qxb7?? threw away a winning position"). */
  description: string;
}

export interface PlayerSummary extends SideAccuracy {
  counts: Record<Classification, number>;
}

export interface OpeningSummary {
  eco: string | null;
  name: string | null;
  /** Last mainline ply still inside known theory (0 = never in book). */
  leftTheoryAtPly: number;
}

/** The engine settings a review ran with — part of the report cache key. */
export interface EngineReviewSettings {
  multipv: number;
  movetimeMs: number;
  depth: number;
}

export interface ReportMeta {
  /** Store gameNo the review belonged to (staleness check inside a session). */
  gameNo: number;
  startFen: string;
  /** '1-0' | '0-1' | '1/2-1/2' | '*' when known. */
  result: string | null;
  /** The human's colour in a vs-bot game, null on the analysis board. */
  playerColor: Side | null;
  engine: EngineReviewSettings;
}

/** The assembled game report — everything the review UI renders. */
export interface AnalysisReport {
  /** Bump when the serialized shape changes; deserialize rejects mismatches. */
  version: 1;
  createdAt: number;
  /** Cache key (content-derived, see report.ts `reportCacheKey`). */
  gameKey: string;
  meta: ReportMeta;
  white: PlayerSummary;
  black: PlayerSummary;
  opening: OpeningSummary;
  phases: PhaseStats[];
  criticalMoments: CriticalMoment[];
  /** Heuristic performance-rating estimate per player (see rating.ts). */
  estimatedPerformanceRating: { white: number; black: number };
  moves: MoveDetail[];
}

/** Arrow request from the review UI to the board ({from,to} squares, or clear). */
export interface ArrowSpec {
  from: string;
  to: string;
}
