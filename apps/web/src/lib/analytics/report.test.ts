import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import type { Score } from '@chesser/shared';
import type { PositionEval } from '../coach';
import { moveAccuracy } from './accuracy';
import { classificationCounts } from './classify';
import {
  REPORT_VERSION,
  REVIEW_ENGINE_SETTINGS,
  buildAnalysisReport,
  buildRows,
  clearReportCache,
  deserializeReport,
  loadCachedReport,
  reportCacheKey,
  saveCachedReport,
  serializeReport,
} from './report';
import type { ReviewRowsInput } from './report';
import { CLASSIFICATION_GLYPH } from './types';
import type { AnalysisReport, ReportMeta } from './types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const cp = (value: number): Score => ({ kind: 'cp', value });
const mate = (value: number): Score => ({ kind: 'mate', value });

/** Play SANs from the start position into ReviewRowsInput-shaped nodes. */
function playNodes(sans: string[]): { id: string; san: string; uci: string; fen: string; ply: number }[] {
  const c = new Chess(START_FEN);
  return sans.map((san, i) => {
    const mv = c.move(san);
    return { id: `n${i + 1}`, san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ''}`, fen: mv.after, ply: i + 1 };
  });
}

function ev(over: Partial<PositionEval> = {}): PositionEval {
  return { score: cp(0), bestUci: null, bestSan: null, secondScore: null, ...over };
}

function input(over: Partial<ReviewRowsInput> & Pick<ReviewRowsInput, 'nodes' | 'evals'>): ReviewRowsInput {
  return { startFen: START_FEN, moveReviews: {}, bookPly: 0, ...over };
}

function meta(over: Partial<ReportMeta> = {}): ReportMeta {
  return {
    gameNo: 1,
    startFen: START_FEN,
    result: null,
    playerColor: null,
    engine: REVIEW_ENGINE_SETTINGS,
    ...over,
  };
}

/** 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 4.Qxf7# with plausible engine evals. */
function scholarsInput(): ReviewRowsInput {
  const nodes = playNodes(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
  const evals: PositionEval[] = [
    ev({ score: cp(30), bestUci: 'e2e4', bestSan: 'e4', secondScore: cp(25) }),
    ev({ score: cp(30), bestUci: 'e7e5', bestSan: 'e5', secondScore: cp(20) }),
    ev({ score: cp(25), bestUci: 'g1f3', bestSan: 'Nf3', secondScore: cp(20) }),
    ev({ score: cp(10), bestUci: 'b8c6', bestSan: 'Nc6', secondScore: cp(0) }),
    ev({ score: cp(30), bestUci: 'f1c4', bestSan: 'Bc4', secondScore: cp(15) }),
    ev({ score: cp(30), bestUci: 'g7g6', bestSan: 'g6', secondScore: cp(-40) }),
    ev({ score: mate(1), bestUci: 'h5f7', bestSan: 'Qxf7#', secondScore: cp(200) }),
    ev(), // mated position: the engine returns nothing useful
  ];
  evals[7] = { score: null, bestUci: null, bestSan: null, secondScore: null };
  return input({ nodes, evals, bookPly: 2 });
}

// --- buildRows (adapter) -----------------------------------------------------

describe('buildRows', () => {
  it('keeps evals and win% White-POV and chains FENs through the mainline', () => {
    const nodes = playNodes(['e4', 'e5']);
    const evals = [ev({ score: cp(0) }), ev({ score: cp(-200) }), ev({ score: cp(0) })];
    const rows = buildRows(input({ nodes, evals }));

    expect(rows).toHaveLength(2);
    expect(rows[0]!.fenBefore).toBe(START_FEN);
    expect(rows[0]!.fenAfter).toBe(nodes[0]!.fen);
    expect(rows[1]!.fenBefore).toBe(nodes[0]!.fen);
    expect(rows[1]!.fenAfter).toBe(nodes[1]!.fen);

    // White-POV throughout: Black's row does NOT flip the percentages.
    expect(rows[0]!.winBefore).toBe(50);
    expect(rows[0]!.winAfter).toBeLessThan(40);
    expect(rows[1]!.winBefore).toBe(rows[0]!.winAfter);
    expect(rows[1]!.winAfter).toBe(50);
  });

  it('computes mover-POV accuracy for a White move via accuracy.moveAccuracy', () => {
    const nodes = playNodes(['e4']);
    const evals = [ev({ score: cp(0) }), ev({ score: cp(-200) })];
    const row = buildRows(input({ nodes, evals }))[0]!;

    // White dropped ~17 win% — the row must match the shared curve exactly.
    expect(row.side).toBe('white');
    expect(row.moveAccuracy).toBe(moveAccuracy(row.winBefore, row.winAfter, 'white'));
    expect(row.moveAccuracy).toBeLessThan(60);
  });

  it('computes mover-POV accuracy for a Black move (White-POV rise = Black drop)', () => {
    const nodes = playNodes(['e4', 'e5']);
    const rise = [ev({ score: cp(0) }), ev({ score: cp(0) }), ev({ score: cp(200) })];
    const fall = [ev({ score: cp(0) }), ev({ score: cp(0) }), ev({ score: cp(-200) })];

    const badBlack = buildRows(input({ nodes, evals: rise }))[1]!;
    expect(badBlack.side).toBe('black');
    expect(badBlack.moveAccuracy).toBe(moveAccuracy(badBlack.winBefore, badBlack.winAfter, 'black'));
    expect(badBlack.moveAccuracy).toBeLessThan(60);

    const goodBlack = buildRows(input({ nodes, evals: fall }))[1]!;
    expect(goodBlack.moveAccuracy).toBeGreaterThan(99);
  });

  it('converts Scores to EvalPoints, mate scores included', () => {
    const nodes = playNodes(['e4']);
    const evals = [ev({ score: cp(35), secondScore: cp(-15) }), ev({ score: mate(-2) })];
    const row = buildRows(input({ nodes, evals }))[0]!;

    expect(row.evalBefore).toEqual({ cp: 35 });
    expect(row.evalAfter).toEqual({ mate: -2 });
    expect(row.secondEvalBefore).toEqual({ cp: -15 });
    expect(row.winAfter).toBeCloseTo(2.455, 2); // Black mates → the −1000cp ceiling, not 0%
  });

  it('treats missing evals as null with a neutral 50% win chance', () => {
    const nodes = playNodes(['e4']);
    const row = buildRows(input({ nodes, evals: [] }))[0]!;
    expect(row.evalBefore).toBeNull();
    expect(row.evalAfter).toBeNull();
    expect(row.winBefore).toBe(50);
    expect(row.winAfter).toBe(50);
  });

  it('forces 100 accuracy on a delivered mate, both colours, whatever the evals say', () => {
    // Fool's mate — Black delivers it; the mated position evaluates to nothing,
    // which would otherwise read as a 50-point drop for the mover.
    const nodes = playNodes(['f3', 'e5', 'g4', 'Qh4#']);
    const evals = [
      ev({ score: cp(20) }),
      ev({ score: cp(-60) }),
      ev({ score: cp(-70) }),
      ev({ score: mate(-1), bestUci: 'd8h4', bestSan: 'Qh4#' }),
      ev({ score: null }),
    ];
    const rows = buildRows(input({ nodes, evals }));
    const mateRow = rows[3]!;
    expect(mateRow.side).toBe('black');
    expect(mateRow.isMate).toBe(true);
    expect(mateRow.isCheck).toBe(true);
    expect(mateRow.moveAccuracy).toBe(100);
    expect(rows[0]!.isMate).toBe(false);
  });

  it('passes coach review fields through and nulls them when ungraded', () => {
    const nodes = playNodes(['e4', 'e5']);
    const evals = [ev(), ev(), ev()];
    const rows = buildRows(
      input({
        nodes,
        evals,
        moveReviews: {
          n1: {
            id: 'n1',
            ply: 1,
            side: 'white',
            san: 'e4',
            uci: 'e2e4',
            classification: 'book',
            evalText: '+0.30',
            winWhiteAfter: 53,
            bestSan: 'e4',
            bestUci: 'e2e4',
            explanation: 'Still in opening theory — a well-established book move.',
          },
        },
      }),
    );

    expect(rows[0]!.coachGrade).toBe('book');
    expect(rows[0]!.coachExplanation).toContain('opening theory');
    expect(rows[0]!.evalText).toBe('+0.30');
    expect(rows[1]!.coachGrade).toBeNull();
    expect(rows[1]!.coachExplanation).toBeNull();
    expect(rows[1]!.evalText).toBeNull();
  });

  it('fills best move / best reply from the surrounding evals', () => {
    const nodes = playNodes(['e4']);
    const evals = [
      ev({ bestUci: 'e2e4', bestSan: 'e4' }),
      ev({ bestUci: 'c7c5', bestSan: 'c5' }),
    ];
    const row = buildRows(input({ nodes, evals }))[0]!;
    expect(row.bestMoveUci).toBe('e2e4');
    expect(row.bestMoveSan).toBe('e4');
    expect(row.bestReplyUci).toBe('c7c5');
    expect(row.bestReplySan).toBe('c5');
  });

  it('prefers the raw engine PV, falls back to [bestMoveSan], then []', () => {
    const nodes = playNodes(['e4', 'e5']);
    const evals = [ev({ bestUci: 'e2e4', bestSan: 'e4' }), ev(), ev()];
    const pvSan = ['e4', 'c5', 'Nf3'];
    const rawLines = [
      [{ multipv: 1, depth: 22, score: cp(30), pvUci: ['e2e4', 'c7c5', 'g1f3'], pvSan }],
      [],
      [],
    ];

    const withLines = buildRows(input({ nodes, evals, rawLines }));
    expect(withLines[0]!.pv).toEqual(pvSan);
    expect(withLines[0]!.pv).not.toBe(pvSan); // defensive copy
    expect(withLines[1]!.pv).toEqual([]); // no line, no best move

    const withoutLines = buildRows(input({ nodes, evals }));
    expect(withoutLines[0]!.pv).toEqual(['e4']);
    expect(withoutLines[1]!.pv).toEqual([]);
  });

  it('derives the mover from the FEN, so Black-to-move start positions work', () => {
    // "Practice this position"-style game: Black moves first from a custom FEN.
    const startFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const c = new Chess(startFen);
    const mv = c.move('e5');
    const nodes = [{ id: 'n1', san: mv.san, uci: `${mv.from}${mv.to}`, fen: mv.after, ply: 1 }];
    const rows = buildRows(input({ startFen, nodes, evals: [ev(), ev()] }));
    expect(rows[0]!.side).toBe('black'); // ply parity alone would say 'white'
  });

  it('marks book plies and node ids', () => {
    const nodes = playNodes(['e4', 'e5', 'Nf3']);
    const evals = [ev(), ev(), ev(), ev()];
    const rows = buildRows(input({ nodes, evals, bookPly: 2 }));
    expect(rows.map((r) => r.isBook)).toEqual([true, true, false]);
    expect(rows.map((r) => r.nodeId)).toEqual(['n1', 'n2', 'n3']);
    expect(rows.map((r) => r.side)).toEqual(['white', 'black', 'white']);
  });
});

// --- buildAnalysisReport (assembly) -------------------------------------------

describe('buildAnalysisReport', () => {
  const build = () => {
    const rows = buildRows(scholarsInput());
    return buildAnalysisReport(rows, meta({ result: '1-0', playerColor: 'white' }), {
      eco: 'C20',
      name: "King's Pawn Game",
      leftTheoryAtPly: 2,
    });
  };

  it('assembles a structurally complete report from rows', () => {
    const report = build();

    expect(report.version).toBe(REPORT_VERSION);
    expect(report.moves).toHaveLength(7);
    for (const m of report.moves) {
      expect(m.glyph).toBe(CLASSIFICATION_GLYPH[m.classification]);
      expect(m.explanation.length).toBeGreaterThan(0);
    }

    expect(report.white.moves).toBe(4);
    expect(report.black.moves).toBe(3);
    const total = (['white', 'black'] as const)
      .flatMap((s) => Object.values(report[s].counts))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(7);

    expect(report.phases.map((p) => p.phase)).toEqual(['opening', 'middlegame', 'endgame']);
    expect(report.opening).toEqual({ eco: 'C20', name: "King's Pawn Game", leftTheoryAtPly: 2 });
    expect(report.meta.result).toBe('1-0');

    for (const side of ['white', 'black'] as const) {
      const rating = report.estimatedPerformanceRating[side];
      expect(rating).toBeGreaterThanOrEqual(400);
      expect(rating).toBeLessThanOrEqual(3200);
    }
  });

  it('grades the mating move best-tier and surfaces the mate as a critical moment', () => {
    const report = build();
    const mateMove = report.moves[6]!;
    expect(mateMove.isMate).toBe(true);
    expect(['best', 'brilliant', 'great']).toContain(mateMove.classification);
    expect(mateMove.moveAccuracy).toBe(100);
    expect(report.criticalMoments.some((m) => m.kind === 'mate' && m.ply === 7)).toBe(true);
  });

  it('derives the gameKey from content + engine settings', () => {
    const report = build();
    const rows = buildRows(scholarsInput());
    expect(report.gameKey).toBe(
      reportCacheKey(
        START_FEN,
        rows.map((r) => r.uci),
        REVIEW_ENGINE_SETTINGS,
      ),
    );
  });

  it('is deterministic apart from the createdAt timestamp', () => {
    const a = build();
    const b = build();
    expect({ ...a, createdAt: 0 }).toEqual({ ...b, createdAt: 0 });
  });
});

// --- reportCacheKey ------------------------------------------------------------

describe('reportCacheKey', () => {
  it('is a stable carv1-prefixed 32-bit hex hash', () => {
    const key = reportCacheKey(START_FEN, ['e2e4', 'e7e5'], REVIEW_ENGINE_SETTINGS);
    expect(key).toMatch(/^carv1:[0-9a-f]{8}$/);
    expect(reportCacheKey(START_FEN, ['e2e4', 'e7e5'], REVIEW_ENGINE_SETTINGS)).toBe(key);
  });

  it('changes with the moves, the start position and the engine settings', () => {
    const key = reportCacheKey(START_FEN, ['e2e4', 'e7e5'], REVIEW_ENGINE_SETTINGS);
    expect(reportCacheKey(START_FEN, ['e2e4', 'c7c5'], REVIEW_ENGINE_SETTINGS)).not.toBe(key);
    expect(reportCacheKey('8/8/8/8/8/4k3/8/4K2R w K - 0 1', ['e2e4', 'e7e5'], REVIEW_ENGINE_SETTINGS)).not.toBe(key);
    expect(reportCacheKey(START_FEN, ['e2e4', 'e7e5'], { multipv: 3, movetimeMs: 300, depth: 22 })).not.toBe(key);
  });

  it('stays in sync with the options reviewGame actually passes to analyzeManyOnce', () => {
    // The constant is the settings half of the cache key; if the store's
    // (hands-off) review loop changes its engine options without this
    // constant, stale cached reports would keep hitting under a lying key.
    const src = readFileSync(new URL('../../store/game.ts', import.meta.url), 'utf8');
    const m = src.match(/analyzeManyOnce\([^,]+,\s*\{\s*multipv:\s*(\d+),\s*movetimeMs:\s*(\d+),\s*depth:\s*(\d+)\s*\}\s*\)/);
    expect(m).not.toBeNull();
    expect({ multipv: Number(m![1]), movetimeMs: Number(m![2]), depth: Number(m![3]) }).toEqual(
      REVIEW_ENGINE_SETTINGS,
    );
  });
});

// --- serializeReport / deserializeReport ----------------------------------------

describe('serialization', () => {
  const report = () =>
    buildAnalysisReport(buildRows(scholarsInput()), meta(), { eco: null, name: null, leftTheoryAtPly: 2 });

  it('round-trips a report, nulling the runtime-only node ids', () => {
    const original = report();
    const back = deserializeReport(serializeReport(original));
    expect(back).toEqual({ ...original, moves: original.moves.map((m) => ({ ...m, nodeId: null })) });
    expect(back!.moves.every((m) => m.nodeId === null)).toBe(true);
  });

  it('rejects version mismatches', () => {
    const bumped = { ...report(), version: REPORT_VERSION + 1 };
    expect(deserializeReport(JSON.stringify(bumped))).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(deserializeReport('not json at all')).toBeNull();
    expect(deserializeReport('null')).toBeNull();
    expect(deserializeReport('42')).toBeNull();
    expect(deserializeReport('{"version":1}')).toBeNull();
  });

  it('rejects version-1 entries whose move rows are malformed (corrupt cache)', () => {
    const original = report();
    // A hand-edited / partially written entry: right version, wrong row shape.
    const corrupt = {
      ...original,
      moves: original.moves.map((m, i) => (i === 1 ? { ...m, winAfter: 'NaN-ish', san: undefined } : m)),
    };
    expect(deserializeReport(JSON.stringify(corrupt))).toBeNull();
    const junkMoves = { ...original, moves: [{}, 42, null] };
    expect(deserializeReport(JSON.stringify(junkMoves))).toBeNull();
  });

  it('rejects version-1 entries whose top-level shape is truncated (corrupt cache)', () => {
    const original = report();
    for (const missing of ['meta', 'white', 'black', 'opening', 'phases', 'criticalMoments', 'estimatedPerformanceRating'] as const) {
      const truncated: Record<string, unknown> = { ...original };
      delete truncated[missing];
      expect(deserializeReport(JSON.stringify(truncated))).toBeNull();
    }
    const badSummary = { ...original, white: { ...original.white, accuracy: 'high' } };
    expect(deserializeReport(JSON.stringify(badSummary))).toBeNull();
    const badRating = { ...original, estimatedPerformanceRating: { white: 1500 } };
    expect(deserializeReport(JSON.stringify(badRating))).toBeNull();
  });
});

// --- localStorage cache ----------------------------------------------------------

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

function fakeReport(gameKey: string): AnalysisReport {
  const counts = classificationCounts([]);
  return {
    version: 1,
    createdAt: 0,
    gameKey,
    meta: meta(),
    white: { accuracy: 100, acpl: 0, moves: 0, counts: counts.white },
    black: { accuracy: 100, acpl: 0, moves: 0, counts: counts.black },
    opening: { eco: null, name: null, leftTheoryAtPly: 0 },
    phases: [],
    criticalMoments: [],
    estimatedPerformanceRating: { white: 1500, black: 1500 },
    moves: [],
  };
}

describe('report cache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a report through save + load', () => {
    const original = buildAnalysisReport(buildRows(scholarsInput()), meta(), {
      eco: null,
      name: null,
      leftTheoryAtPly: 2,
    });
    saveCachedReport(original);
    const loaded = loadCachedReport(original.gameKey);
    expect(loaded).toEqual({ ...original, moves: original.moves.map((m) => ({ ...m, nodeId: null })) });
  });

  it('misses on unknown keys', () => {
    expect(loadCachedReport('carv1:00000000')).toBeNull();
  });

  it('evicts the least recently saved report beyond the 20-entry cap', () => {
    for (let i = 0; i <= 20; i++) saveCachedReport(fakeReport(`k${i}`));

    expect(loadCachedReport('k0')).toBeNull();
    expect(loadCachedReport('k1')).not.toBeNull();
    expect(loadCachedReport('k20')).not.toBeNull();
    expect(localStorage.getItem('chesser-report:k0')).toBeNull();

    const index = JSON.parse(localStorage.getItem('chesser-report-index')!) as string[];
    expect(index).toHaveLength(20);
  });

  it('treats a load as a use: loaded reports survive the next eviction', () => {
    for (let i = 0; i < 20; i++) saveCachedReport(fakeReport(`k${i}`));

    expect(loadCachedReport('k0')).not.toBeNull(); // refresh k0 to the front
    saveCachedReport(fakeReport('k20')); // evicts k1, the LRU entry now

    expect(loadCachedReport('k0')).not.toBeNull();
    expect(loadCachedReport('k1')).toBeNull();
    expect(loadCachedReport('k20')).not.toBeNull();
  });

  it('drops corrupt entries and reports a miss', () => {
    localStorage.setItem('chesser-report:kbad', '{broken');
    expect(loadCachedReport('kbad')).toBeNull();
    expect(localStorage.getItem('chesser-report:kbad')).toBeNull();
  });

  it('clears every entry and the index', () => {
    saveCachedReport(fakeReport('k1'));
    saveCachedReport(fakeReport('k2'));
    clearReportCache();
    expect(loadCachedReport('k1')).toBeNull();
    expect(loadCachedReport('k2')).toBeNull();
    expect(localStorage.getItem('chesser-report-index')).toBeNull();
  });

  it('swallows storage failures (quota, blocked access)', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => saveCachedReport(fakeReport('kq'))).not.toThrow();

    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(loadCachedReport('kq')).toBeNull();
  });

  it('behaves as a miss when localStorage does not exist at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadCachedReport('k1')).toBeNull();
    expect(() => saveCachedReport(fakeReport('k1'))).not.toThrow();
    expect(() => clearReportCache()).not.toThrow();
  });
});
