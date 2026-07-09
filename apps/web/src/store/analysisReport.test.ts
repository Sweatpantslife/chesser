// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { PositionEval } from '../lib/coach';
import { clearReportCache } from '../lib/analytics/report';
import { mainlineOf, useGame } from './game';
import { useAnalysisReport } from './analysisReport';

// Scholar's mate — ends in a delivered checkmate (7 plies, White wins).
const PGN = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#';

/** Plausible White-POV cp evals for the 8 positions (mate at the end). */
const SCORES: PositionEval[] = [30, 25, 20, 40, 35, 60, -200].map((cp) => ({
  score: { kind: 'cp', value: cp } as const,
  bestUci: 'e2e4',
  bestSan: 'e4',
  secondScore: { kind: 'cp', value: cp - 40 } as const,
}));
SCORES.push({ score: { kind: 'mate', value: 0 }, bestUci: null, bestSan: null, secondScore: null });

function reviewInput() {
  const s = useGame.getState();
  const mainline = mainlineOf(s.tree, s.rootId);
  return {
    startFen: s.startFen,
    nodes: mainline.map((n) => ({ id: n.id, san: n.san, uci: n.uci, fen: n.fen, ply: n.ply })),
    evals: SCORES,
    moveReviews: {},
    bookPly: 4,
    gameNo: s.gameNo,
    result: null,
    playerColor: null,
  };
}

describe('useAnalysisReport', () => {
  beforeEach(() => {
    clearReportCache();
    localStorage.clear();
    useAnalysisReport.getState().clear();
    expect(useGame.getState().loadPgn(PGN)).toBe(true);
  });

  it('misses the cache for a never-reviewed game', () => {
    expect(useAnalysisReport.getState().tryHydrateFromCache()).toBe(false);
    expect(useAnalysisReport.getState().report).toBeNull();
  });

  it('buildFromReview publishes a report for the current game and caches it', async () => {
    await useAnalysisReport.getState().buildFromReview(reviewInput());
    const st = useAnalysisReport.getState();
    expect(st.report).not.toBeNull();
    expect(st.gameNo).toBe(useGame.getState().gameNo);
    expect(st.report!.moves).toHaveLength(7);
    // Delivered mate is best-tier with 100 accuracy, never a bad grade.
    const mate = st.report!.moves[6]!;
    expect(mate.isMate).toBe(true);
    expect(['best', 'brilliant', 'great']).toContain(mate.classification);
    expect(mate.moveAccuracy).toBe(100);
    // The report landed in the localStorage cache.
    expect(localStorage.getItem(`chesser-report:${st.report!.gameKey}`)).toBeTruthy();
  });

  it('hydrates the legacy review fields on the FRESH path too (grades cannot disagree)', async () => {
    await useAnalysisReport.getState().buildFromReview(reviewInput());
    const report = useAnalysisReport.getState().report!;
    const g = useGame.getState();
    const mainline = mainlineOf(g.tree, g.rootId);

    // The legacy fields now carry the report's canonical numbers/grades.
    expect(g.reviewGameNo).toBe(g.gameNo);
    expect(g.reviewStats!.white.accuracy).toBe(Math.round(report.white.accuracy));
    expect(g.reviewStats!.black.acpl).toBe(report.black.acpl);
    for (let i = 0; i < mainline.length; i++) {
      expect(g.moveReviews[mainline[i]!.id]!.classification).toBe(report.moves[i]!.classification);
    }
    // The mating move is never annotated as a mistake to drill.
    expect(g.annotations[mainline[6]!.id]).toBeUndefined();
    // The {mate: 0} terminal eval pins the graph to the mover's edge, not 50%.
    expect(g.evalGraph).toHaveLength(mainline.length + 1);
    expect(g.evalGraph[mainline.length]).toBe(100);
  });

  it('aborts silently when a new game starts mid-build', async () => {
    const input = { ...reviewInput(), gameNo: useGame.getState().gameNo - 1 };
    await useAnalysisReport.getState().buildFromReview(input);
    expect(useAnalysisReport.getState().report).toBeNull();
  });

  it('hydrates a reopened game from the cache, filling the legacy review fields', async () => {
    await useAnalysisReport.getState().buildFromReview(reviewInput());
    const report = useAnalysisReport.getState().report!;

    // Reopen the same game: new gameNo + node ids, review fields wiped.
    useAnalysisReport.getState().clear();
    expect(useGame.getState().loadPgn(PGN)).toBe(true);
    expect(useGame.getState().reviewGameNo).toBe(0);
    expect(useGame.getState().moveReviews).toEqual({});

    expect(useAnalysisReport.getState().tryHydrateFromCache()).toBe(true);

    const g = useGame.getState();
    const rs = useAnalysisReport.getState();
    expect(rs.gameNo).toBe(g.gameNo);
    expect(rs.report!.gameKey).toBe(report.gameKey);
    // Rows are re-keyed onto the CURRENT mainline's node ids.
    const mainline = mainlineOf(g.tree, g.rootId);
    for (let i = 0; i < mainline.length; i++) {
      expect(rs.report!.moves[i]!.nodeId).toBe(mainline[i]!.id);
      expect(g.moveReviews[mainline[i]!.id]).toBeTruthy();
    }
    // Legacy fields light the existing panels up without any engine time.
    expect(g.reviewGameNo).toBe(g.gameNo);
    expect(g.evalGraph).toHaveLength(mainline.length + 1);
    expect(g.reviewStats!.white.moves).toBe(4);
    expect(g.reviewStats!.black.moves).toBe(3);
    const mateReview = g.moveReviews[mainline[6]!.id]!;
    expect(mateReview.san).toBe('Qxf7#');
    expect(['best', 'brilliant', 'great']).toContain(mateReview.classification);
  });

  it('misses the cache when the moves differ', async () => {
    await useAnalysisReport.getState().buildFromReview(reviewInput());
    expect(useGame.getState().loadPgn('1. d4 d5 2. c4')).toBe(true);
    expect(useAnalysisReport.getState().tryHydrateFromCache()).toBe(false);
  });

  it('aborts when the mainline changed during the build (same game, new move)', async () => {
    // Simulate a review snapshot taken before another mainline move landed:
    // the input's nodes are one short of the store's current mainline.
    const input = reviewInput();
    const stale = { ...input, nodes: input.nodes.slice(0, -1), evals: SCORES.slice(0, -1) };
    await useAnalysisReport.getState().buildFromReview(stale);
    expect(useAnalysisReport.getState().report).toBeNull();
    expect(useGame.getState().reviewGameNo).toBe(0); // legacy fields untouched
  });

  it('re-hydrates the legacy fields from the in-memory report without touching storage', async () => {
    await useAnalysisReport.getState().buildFromReview(reviewInput());
    // A structural (variation) move wipes the legacy review fields…
    useGame.setState({ moveReviews: {}, annotations: {}, evalGraph: [], reviewStats: null, reviewGameNo: 0 });
    // …and even with the storage cache gone, the published report restores them.
    localStorage.clear();
    expect(useAnalysisReport.getState().tryHydrateFromCache()).toBe(true);
    const g = useGame.getState();
    expect(g.reviewGameNo).toBe(g.gameNo);
    expect(Object.keys(g.moveReviews)).toHaveLength(7);
    expect(g.reviewStats).not.toBeNull();
  });
});
