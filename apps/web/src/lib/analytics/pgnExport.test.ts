import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { STARTING_FEN } from '@chesser/shared';
import type { PgnMeta } from '../pgn';
import { annotatedPgn } from './pgnExport';
import type { AnalysisReport, Classification, MoveDetail, PlayerSummary } from './types';

const ZERO_COUNTS: Record<Classification, number> = {
  brilliant: 0,
  great: 0,
  best: 0,
  good: 0,
  book: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  miss: 0,
};

function player(): PlayerSummary {
  return { accuracy: 90, acpl: 25, moves: 0, counts: { ...ZERO_COUNTS } };
}

function detail(overrides: Partial<MoveDetail> = {}): MoveDetail {
  return {
    ply: 1,
    side: 'white',
    san: 'e4',
    uci: 'e2e4',
    fenBefore: STARTING_FEN,
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    evalBefore: { cp: 20 },
    evalAfter: { cp: 20 },
    winBefore: 50,
    winAfter: 50,
    moveAccuracy: 100,
    coachGrade: null,
    coachExplanation: null,
    evalText: null,
    bestMoveSan: null,
    bestMoveUci: null,
    bestReplySan: null,
    bestReplyUci: null,
    pv: [],
    secondEvalBefore: null,
    isMate: false,
    isCheck: false,
    isBook: false,
    nodeId: null,
    classification: 'good',
    glyph: '⋯',
    explanation: '',
    ...overrides,
  };
}

function report(moves: MoveDetail[], overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    version: 1,
    createdAt: 0,
    gameKey: 'carv1:test',
    meta: {
      gameNo: 1,
      startFen: STARTING_FEN,
      result: '1-0',
      playerColor: 'white',
      engine: { multipv: 2, movetimeMs: 300, depth: 22 },
    },
    white: player(),
    black: player(),
    opening: { eco: null, name: null, leftTheoryAtPly: 0 },
    phases: [],
    criticalMoments: [],
    estimatedPerformanceRating: { white: 1500, black: 1500 },
    moves,
    ...overrides,
  };
}

const META: PgnMeta = { white: 'Alice', black: 'Bob', result: '1-0', date: '2026.07.09' };

/** The movetext line (after the blank header separator). */
function body(pgn: string): string {
  return pgn.split('\n\n')[1]?.trim() ?? '';
}

describe('annotatedPgn — NAG mapping', () => {
  const cases: Array<[Classification, string]> = [
    ['brilliant', '$3'],
    ['great', '$1'],
    ['inaccuracy', '$6'],
    ['mistake', '$2'],
    ['blunder', '$4'],
    ['miss', '$2'],
  ];
  for (const [cls, nag] of cases) {
    it(`maps ${cls} to ${nag}`, () => {
      const pgn = annotatedPgn(report([detail({ classification: cls, bestMoveSan: 'Nf3' })]), META);
      expect(body(pgn)).toContain(`e4 ${nag} {`);
    });
  }

  for (const cls of ['best', 'good', 'book'] as Classification[]) {
    it(`emits no NAG or label for ${cls}`, () => {
      const pgn = annotatedPgn(report([detail({ classification: cls })]), META);
      expect(body(pgn)).not.toContain('$');
      expect(body(pgn)).toBe('1. e4 { [%eval 0.20] } 1-0');
    });
  }

  it('adds "<Label>. <best> was best." comments on notable moves', () => {
    const pgn = annotatedPgn(
      report([detail({ classification: 'blunder', evalAfter: { cp: -310 }, bestMoveSan: 'Nf3' })]),
      META,
    );
    expect(body(pgn)).toContain('e4 $4 { [%eval -3.10] Blunder. Nf3 was best. }');
  });

  it('uses the "Missed win" label for a miss', () => {
    const pgn = annotatedPgn(report([detail({ classification: 'miss', bestMoveSan: 'Qb3' })]), META);
    expect(body(pgn)).toContain('e4 $2 { [%eval 0.20] Missed win. Qb3 was best. }');
  });

  it('drops the "was best" tail when the played move IS the best move', () => {
    const pgn = annotatedPgn(report([detail({ classification: 'brilliant', bestMoveSan: 'e4' })]), META);
    expect(body(pgn)).toContain('e4 $3 { [%eval 0.20] Brilliant. }');
  });
});

describe('annotatedPgn — [%eval] format', () => {
  it('formats centipawns as pawns with two decimals', () => {
    expect(body(annotatedPgn(report([detail({ evalAfter: { cp: 35 } })]), META))).toContain('[%eval 0.35]');
    expect(body(annotatedPgn(report([detail({ evalAfter: { cp: -120 } })]), META))).toContain('[%eval -1.20]');
    expect(body(annotatedPgn(report([detail({ evalAfter: { cp: 0 } })]), META))).toContain('[%eval 0.00]');
  });

  it('formats mates as #N / #-N', () => {
    expect(body(annotatedPgn(report([detail({ evalAfter: { mate: 3 } })]), META))).toContain('[%eval #3]');
    expect(body(annotatedPgn(report([detail({ evalAfter: { mate: -3 } })]), META))).toContain('[%eval #-3]');
  });

  it('omits the eval tag for mate-0 (mate already delivered) and missing evals', () => {
    const mate0 = annotatedPgn(report([detail({ san: 'Qxf7#', isMate: true, evalAfter: { mate: 0 } })]), META);
    expect(body(mate0)).toBe('1. Qxf7# 1-0');
    const none = annotatedPgn(report([detail({ evalAfter: null })]), META);
    expect(body(none)).toBe('1. e4 1-0');
  });
});

describe('annotatedPgn — delivered checkmate is never annotated as an error', () => {
  // Seam: mate is detected from the SAN '#' suffix (row.isMate); consolidates
  // with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
  it('suppresses a bad NAG/comment on the mating move', () => {
    const r = detail({ san: 'Qxf7#', isMate: true, classification: 'blunder', bestMoveSan: 'Qh4', evalAfter: null });
    const pgn = annotatedPgn(report([r]), META);
    expect(body(pgn)).toBe('1. Qxf7# 1-0');
  });

  it('keeps a brilliant NAG on a mating move', () => {
    const r = detail({ san: 'Qxf7#', isMate: true, classification: 'brilliant', evalAfter: null });
    expect(body(annotatedPgn(report([r]), META))).toBe('1. Qxf7# $3 { Brilliant. } 1-0');
  });
});

describe('annotatedPgn — headers', () => {
  it('writes the six base tags in lib/pgn.ts layout', () => {
    const pgn = annotatedPgn(report([]), META);
    expect(pgn.startsWith('[Event "Chesser game"]\n[Site "Chesser"]\n[Date "2026.07.09"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n')).toBe(true);
  });

  it('adds [ECO]/[Opening] when the report knows the opening', () => {
    const pgn = annotatedPgn(
      report([], { opening: { eco: 'B22', name: 'Sicilian Defense: Alapin Variation', leftTheoryAtPly: 6 } }),
      META,
    );
    expect(pgn).toContain('[ECO "B22"]\n[Opening "Sicilian Defense: Alapin Variation"]');
  });

  it('adds [SetUp]/[FEN] for a custom start position', () => {
    const fen = 'k7/8/1K6/8/8/8/8/7R w - - 0 1';
    const pgn = annotatedPgn(report([], { meta: { ...report([]).meta, startFen: fen } }), META);
    expect(pgn).toContain(`[SetUp "1"]\n[FEN "${fen}"]`);
  });

  it('escapes quotes in tag values', () => {
    const pgn = annotatedPgn(report([]), { ...META, white: 'Alice "The Rook"' });
    expect(pgn).toContain('[White "Alice \\"The Rook\\""]');
  });
});

describe('annotatedPgn — round-trips through chess.js', () => {
  it('parses a fully annotated Scholar\'s Mate game and preserves every move', () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
    const grades: Classification[] = ['best', 'book', 'inaccuracy', 'good', 'good', 'blunder', 'best'];
    const moves = sans.map((san, i) =>
      detail({
        ply: i + 1,
        side: i % 2 === 0 ? 'white' : 'black',
        san,
        classification: grades[i]!,
        bestMoveSan: san === 'Nf6' ? 'g6' : null,
        evalAfter: san === 'Qxf7#' ? { mate: 0 } : { cp: 30 * (i + 1) },
        isMate: san === 'Qxf7#',
      }),
    );
    const pgn = annotatedPgn(report(moves, { opening: { eco: 'C20', name: "King's Pawn Game", leftTheoryAtPly: 2 } }), META);

    const c = new Chess();
    c.loadPgn(pgn); // throws on anything chess.js cannot parse
    expect(c.history()).toEqual(sans);
    expect(c.isCheckmate()).toBe(true);
    const headers = c.getHeaders();
    expect(headers.White).toBe('Alice');
    expect(headers.Black).toBe('Bob');
    expect(headers.Result).toBe('1-0');
    expect(headers.ECO).toBe('C20');
    expect(c.getComments().length).toBeGreaterThan(0);
  });

  it('parses a custom-FEN game', () => {
    const fen = 'k7/8/1K6/8/8/8/8/7R w - - 0 1';
    const moves = [detail({ san: 'Rh8#', uci: 'h1h8', isMate: true, classification: 'best', evalAfter: { mate: 0 }, fenBefore: fen })];
    const pgn = annotatedPgn(report(moves, { meta: { ...report([]).meta, startFen: fen } }), META);
    const c = new Chess();
    c.loadPgn(pgn);
    expect(c.history()).toEqual(['Rh8#']);
    expect(c.isCheckmate()).toBe(true);
  });
});

describe('annotatedPgn — movetext numbering', () => {
  it('restates the move number for a black move after a comment', () => {
    const moves = [
      detail({ ply: 1, side: 'white', san: 'e4', evalAfter: { cp: 35 } }),
      detail({ ply: 2, side: 'black', san: 'c5', evalAfter: null }),
      detail({ ply: 3, side: 'white', san: 'Nf3', evalAfter: null }),
      detail({ ply: 4, side: 'black', san: 'd6', evalAfter: null }),
    ];
    const pgn = annotatedPgn(report(moves), META);
    // Comment after e4 forces "1..."; the quiet Nf3 does not force "2...".
    expect(body(pgn)).toBe('1. e4 { [%eval 0.35] } 1... c5 2. Nf3 d6 1-0');
  });

  it('ends the movetext with the result', () => {
    const pgn = annotatedPgn(report([detail()]), { ...META, result: '1/2-1/2' });
    expect(body(pgn).endsWith('1/2-1/2')).toBe(true);
    expect(pgn.endsWith('\n')).toBe(true);
  });

  it('numbers a black-to-move custom position from the FEN fullmove counter', () => {
    // "Practice this position" games often start with Black to move mid-game;
    // the movetext must open "N... <san>" with the FEN's own numbering.
    const fen = '4k3/8/8/8/8/8/8/4K2R b K - 0 12';
    const moves = [
      detail({ ply: 1, side: 'black', san: 'Kd7', uci: 'e8d7', fenBefore: fen, evalAfter: null }),
      detail({ ply: 2, side: 'white', san: 'Rh8', uci: 'h1h8', evalAfter: null }),
      detail({ ply: 3, side: 'black', san: 'Kc7', uci: 'd7c7', evalAfter: null }),
    ];
    const pgn = annotatedPgn(
      report(moves, { meta: { ...report([]).meta, startFen: fen } }),
      { ...META, result: '*' },
    );
    expect(body(pgn)).toBe('12... Kd7 13. Rh8 Kc7 *');

    const c = new Chess();
    c.loadPgn(pgn);
    expect(c.history()).toEqual(['Kd7', 'Rh8', 'Kc7']);
  });
});
