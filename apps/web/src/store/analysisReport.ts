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
    if (useGame.getState().gameNo !== input.gameNo) return; // stale review
    const rows = buildRows(input);
    const report = buildAnalysisReport(
      rows,
      {
        gameNo: input.gameNo,
        startFen: input.startFen,
        result: input.result,
        playerColor: input.playerColor,
        engine: REVIEW_ENGINE_SETTINGS,
      },
      { eco, name, leftTheoryAtPly: input.bookPly },
    );
    set({ report, gameNo: input.gameNo });
    saveCachedReport(report);
  },

  tryHydrateFromCache() {
    const g = useGame.getState();
    const mainline = mainlineOf(g.tree, g.rootId);
    if (mainline.length === 0) return false;
    const key = reportCacheKey(
      g.startFen,
      mainline.map((n) => n.uci),
      REVIEW_ENGINE_SETTINGS,
    );
    const cached = loadCachedReport(key);
    if (!cached || cached.moves.length !== mainline.length) return false;

    // Cached rows come back with nodeId null — re-map by ply onto the current
    // mainline, then hydrate the game store's legacy review fields (same
    // derivations as reviewGame's aggregation, via useGame.setState only).
    const moves = cached.moves.map((m, i) => ({ ...m, nodeId: mainline[i]!.id }));
    const report: AnalysisReport = { ...cached, moves, meta: { ...cached.meta, gameNo: g.gameNo } };

    const moveReviews: Record<string, MoveReview> = {};
    const annotations: Record<string, Annotation> = {};
    for (const m of moves) {
      const id = m.nodeId!;
      moveReviews[id] = toMoveReview(m, id);
      if (m.classification === 'blunder') annotations[id] = 'blunder';
      else if (m.classification === 'mistake' || m.classification === 'miss') annotations[id] = 'mistake';
      else if (m.classification === 'inaccuracy') annotations[id] = 'inaccuracy';
    }

    useGame.setState({
      moveReviews,
      annotations,
      evalGraph: [moves[0]!.winBefore, ...moves.map((m) => m.winAfter)],
      reviewStats: { white: toSideReview(report.white), black: toSideReview(report.black) },
      reviewGameNo: g.gameNo,
      reviewProgress: 100,
    });
    set({ report, gameNo: g.gameNo });
    return true;
  },

  clear() {
    set({ report: null, gameNo: 0, arrow: null });
  },
}));
