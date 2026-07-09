import { create } from 'zustand';
import type { MoveReview } from '../lib/coach';
import { detectOpening } from '../lib/openings';
import {
  buildAnalysisReport,
  buildRows,
  loadCachedReport,
  reportCacheKey,
  saveCachedReport,
  REVIEW_ENGINE_SETTINGS,
  type ReviewRowsInput,
} from '../lib/analytics/report';
import type { AnalysisReport, ArrowSpec, PlayerSummary, Side } from '../lib/analytics/types';
import { mainlineOf, useGame, type Annotation, type SideReview } from './game';

/**
 * Holds the assembled {@link AnalysisReport} for the current game, plus the
 * review UI's best-move arrow overlay. Deliberately NOT persisted — the
 * cross-session persistence layer is the localStorage report cache in
 * lib/analytics/report.ts, keyed by game content.
 *
 * The report is valid only while `gameNo` matches `useGame`'s; consumers treat
 * a mismatch as "no report" (the store self-invalidates, no game.ts edits).
 */
export interface AnalysisReportState {
  report: AnalysisReport | null;
  /** useGame gameNo the report belongs to; UI treats mismatches as no-report. */
  gameNo: number;
  /** Review-UI arrow overlay (MoveDetailPanel drives it; the board renders it). */
  arrow: ArrowSpec | null;
  setArrow(a: ArrowSpec | null): void;
  /**
   * Called from the reviewGame() append-only hook: adapt the raw review data
   * to rows, assemble the report, publish it and write it to the cache.
   * Aborts silently if a new game started while the opening lookup ran.
   */
  buildFromReview(
    input: ReviewRowsInput & { gameNo: number; result: string | null; playerColor: Side | null },
  ): Promise<void>;
  /**
   * Cache short-circuit for reopened games: on a hit, publish the cached
   * report AND hydrate the game store's legacy review fields so every
   * existing panel lights up with zero engine time. Returns true on a hit.
   */
  tryHydrateFromCache(): boolean;
  clear(): void;
}

/** Project a report move back to the store's legacy MoveReview shape. */
function toMoveReview(m: AnalysisReport['moves'][number], id: string): MoveReview {
  return {
    id,
    ply: m.ply,
    side: m.side,
    san: m.san,
    uci: m.uci,
    classification: m.classification,
    evalText: m.evalText ?? '',
    winWhiteAfter: m.winAfter,
    bestSan: m.bestMoveSan,
    bestUci: m.bestMoveUci,
    explanation: m.explanation,
  };
}

/** Round a PlayerSummary down to the store's coarser SideReview. */
function toSideReview(p: PlayerSummary): SideReview {
  return { accuracy: Math.round(p.accuracy), acpl: p.acpl, moves: p.moves };
}

/**
 * Push a report's grades/stats back over the game store's legacy review
 * fields (moveReviews, annotations, evalGraph, reviewStats) — the same
 * derivations as reviewGame's aggregation, via useGame.setState only.
 *
 * Runs on BOTH paths (fresh review and cache hit) so MoveList, AnalysisCoach,
 * GameOverModal and ReviewPanel's table can never disagree with the report
 * cards: the report grades a delivered mate best-tier (never a "missed win")
 * and its accuracy is the lichess weighted/harmonic blend.
 * Seam: consolidate with checkmateWinner() from lib/coach.ts once
 * fix/coach-trainers lands (the legacy fresh-path grades then match natively).
 *
 * Every move must already carry the CURRENT tree's nodeId.
 */
function hydrateLegacyReviewFields(report: AnalysisReport, gameNo: number): void {
  const moves = report.moves;
  if (moves.length === 0) return;

  const moveReviews: Record<string, MoveReview> = {};
  const annotations: Record<string, Annotation> = {};
  for (const m of moves) {
    if (!m.nodeId) continue;
    moveReviews[m.nodeId] = toMoveReview(m, m.nodeId);
    if (m.classification === 'blunder') annotations[m.nodeId] = 'blunder';
    else if (m.classification === 'mistake' || m.classification === 'miss') annotations[m.nodeId] = 'mistake';
    else if (m.classification === 'inaccuracy') annotations[m.nodeId] = 'inaccuracy';
  }

  const evalGraph = [moves[0]!.winBefore, ...moves.map((m) => m.winAfter)];
  // A delivered mate ends the curve at the mover's edge, whatever the (often
  // {mate: 0} → 50%) terminal eval says — matches EvalGraphPro's pinning.
  const last = moves[moves.length - 1]!;
  if (last.isMate) evalGraph[evalGraph.length - 1] = last.side === 'white' ? 100 : 0;

  useGame.setState({
    moveReviews,
    annotations,
    evalGraph,
    reviewStats: { white: toSideReview(report.white), black: toSideReview(report.black) },
    reviewGameNo: gameNo,
    reviewProgress: 100,
  });
}

export const useAnalysisReport = create<AnalysisReportState>((set) => ({
  report: null,
  gameNo: 0,
  arrow: null,

  setArrow(a) {
    set({ arrow: a });
  },

  async buildFromReview(input) {
    let eco: string | null = null;
    let name: string | null = null;
    try {
      // Memoised dataset — cheap after the review's own detectOpening call.
      const op = await detectOpening(input.nodes.map((n) => n.san));
      eco = op?.eco ?? null;
      name = op?.name ?? null;
    } catch {
      // The report still builds without a named opening.
    }
    const g = useGame.getState();
    if (g.gameNo !== input.gameNo) return; // stale review
    // Same game but the MAINLINE grew/changed while the opening lookup ran —
    // publishing now would overwrite the store's review invalidation with a
    // stale projection. (Variation moves don't touch the mainline and are fine.)
    const mainline = mainlineOf(g.tree, g.rootId);
    if (
      mainline.length !== input.nodes.length ||
      mainline[mainline.length - 1]?.id !== input.nodes[input.nodes.length - 1]?.id
    ) {
      return;
    }
    try {
      const rows = buildRows(input);
      const report = buildAnalysisReport(
        rows,
        {
          gameNo: input.gameNo,
          startFen: input.startFen,
          result: input.result,
          playerColor: input.playerColor,
          // The opts the review's eval loop ACTUALLY ran with (flowed through
          // the reviewGame hook) — meta.engine and the cache key describe the
          // real settings, so a budget change self-invalidates cached reports.
          engine: input.engine ?? REVIEW_ENGINE_SETTINGS,
        },
        { eco, name, leftTheoryAtPly: input.bookPly },
      );
      set({ report, gameNo: input.gameNo });
      // Fresh path: overwrite the store's just-computed legacy fields with the
      // report's canonical grades, exactly like the cache path does.
      hydrateLegacyReviewFields(report, input.gameNo);
      saveCachedReport(report);
    } catch (e) {
      // Degrade to "no report" — a bad row after a ~30 s engine review must
      // not surface as an unhandled rejection while the legacy review stands.
      console.error('[report] failed to assemble the analysis report', e);
    }
  },

  tryHydrateFromCache() {
    const g = useGame.getState();
    const mainline = mainlineOf(g.tree, g.rootId);
    if (mainline.length === 0) return false;

    // In-memory fast path: the published report already belongs to this exact
    // mainline (node ids match) — re-hydrate the legacy fields directly, no
    // storage round-trip. Covers "restore the review after exploring a PV
    // variation" even when localStorage is unavailable.
    const current = useAnalysisReport.getState();
    if (
      current.report &&
      current.gameNo === g.gameNo &&
      current.report.moves.length === mainline.length &&
      current.report.moves.every((m, i) => m.nodeId === mainline[i]!.id)
    ) {
      hydrateLegacyReviewFields(current.report, g.gameNo);
      return true;
    }

    const key = reportCacheKey(
      g.startFen,
      mainline.map((n) => n.uci),
      REVIEW_ENGINE_SETTINGS,
    );
    const cached = loadCachedReport(key);
    if (!cached || cached.moves.length !== mainline.length) return false;

    // Cached rows come back with nodeId null — re-map by ply onto the current
    // mainline, then hydrate the game store's legacy review fields.
    const moves = cached.moves.map((m, i) => ({ ...m, nodeId: mainline[i]!.id }));
    const report: AnalysisReport = { ...cached, moves, meta: { ...cached.meta, gameNo: g.gameNo } };

    hydrateLegacyReviewFields(report, g.gameNo);
    set({ report, gameNo: g.gameNo });
    return true;
  },

  clear() {
    set({ report: null, gameNo: 0, arrow: null });
  },
}));
