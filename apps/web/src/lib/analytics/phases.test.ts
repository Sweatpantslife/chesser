import { describe, expect, it } from 'vitest';
import { acpl, gameAccuracy } from './accuracy';
import { detectPhases, findCriticalMoments, phaseBreakdown, phaseOfPly } from './phases';
import type { Classification, MoveDetail, MoveRow, Side } from './types';
import { CLASSIFICATION_GLYPH } from './types';

// — FEN fixtures (phases.ts only parses the board field, but all are legal-shaped) —

/** Start position: 14 majors/minors, both back ranks full. */
const FEN_OPENING = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** 11 majors/minors (White lost N+R+R), White back rank has 4 non-king pieces. */
const FEN_MM_11 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKB2 w kq - 0 1';
/** 10 majors/minors (White down to N+B+Q). */
const FEN_MM_10 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQK3 w kq - 0 1';
/** 7 majors/minors — middlegame material but not yet endgame. */
const FEN_MM_7 = '1nbqkb2/pppppppp/8/8/8/8/PPPPPPPP/1NBQK3 w - - 0 1';
/** 6 majors/minors — endgame material. */
const FEN_MM_6 = '1nbqk3/pppppppp/8/8/8/8/PPPPPPPP/1NBQK3 w - - 0 1';
/** 2 majors/minors — deep endgame (rook ending). */
const FEN_MM_2 = '4r3/5pk1/8/8/8/8/5PK1/4R3 w - - 0 40';
/** Full material (14) but BOTH back ranks sparse (2 non-king pieces each). */
const FEN_SPARSE_BOTH = 'r4rk1/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R4RK1 w - - 0 10';
/** 13 majors/minors, only White's back rank sparse — NOT a middlegame trigger. */
const FEN_SPARSE_WHITE_ONLY = 'rnbqkbnr/pppppppp/8/8/2B1N3/2N1B3/PPPPPPPP/R2QK3 w kq - 0 1';

/** MoveRow with sensible defaults; side derives from ply unless overridden. */
function row(over: Partial<MoveRow> & { ply: number }): MoveRow {
  const side: Side = over.ply % 2 === 1 ? 'white' : 'black';
  return {
    side,
    san: 'e4',
    uci: 'e2e4',
    fenBefore: FEN_OPENING,
    fenAfter: FEN_OPENING,
    evalBefore: { cp: 0 },
    evalAfter: { cp: 0 },
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
    ...over,
  };
}

/** Contiguous rows, plies 1..n, fenAfter taken from the list. */
function rowsFromFens(fens: string[]): MoveRow[] {
  return fens.map((fenAfter, i) => row({ ply: i + 1, fenAfter }));
}

/** MoveDetail with defaults (classification 'good' — glyph not annotation-style). */
function detail(over: Partial<MoveDetail> & { ply: number }): MoveDetail {
  const classification: Classification = over.classification ?? 'good';
  return {
    ...row(over),
    classification,
    glyph: CLASSIFICATION_GLYPH[classification],
    explanation: '',
    ...over,
  };
}

describe('detectPhases', () => {
  it('keeps a short, full-material game entirely in the opening', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_OPENING, FEN_OPENING, FEN_OPENING]);
    const b = detectPhases(rows, 2);
    expect(b.openingEndPly).toBe(4);
    expect(b.endgameStartPly).toBe(Infinity);
  });

  it('starts the middlegame at the first ply with ≤ 10 majors and minors', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_OPENING, FEN_OPENING, FEN_OPENING, FEN_MM_10, FEN_MM_10]);
    const b = detectPhases(rows, 2);
    expect(b.openingEndPly).toBe(4);
    expect(b.endgameStartPly).toBe(Infinity);
  });

  it('does not trigger the middlegame at 11 majors and minors', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_MM_11, FEN_MM_11]);
    expect(detectPhases(rows, 0).openingEndPly).toBe(3);
  });

  it('starts the middlegame on sparse back ranks even with full material', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_OPENING, FEN_SPARSE_BOTH, FEN_SPARSE_BOTH]);
    expect(detectPhases(rows, 0).openingEndPly).toBe(2);
  });

  it('requires BOTH back ranks to be sparse', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_SPARSE_WHITE_ONLY, FEN_SPARSE_WHITE_ONLY]);
    expect(detectPhases(rows, 0).openingEndPly).toBe(3);
  });

  it('keeps book moves in the opening past the structural boundary', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_MM_10, FEN_MM_10, FEN_MM_10, FEN_MM_10, FEN_MM_10]);
    // Structure says middlegame from ply 2, but theory ran to ply 5.
    expect(detectPhases(rows, 5).openingEndPly).toBe(5);
    expect(detectPhases(rows, 0).openingEndPly).toBe(1);
  });

  it('starts the endgame at the first ply with ≤ 6 majors and minors, not 7', () => {
    const rows = rowsFromFens([FEN_OPENING, FEN_MM_10, FEN_MM_7, FEN_MM_7, FEN_MM_6, FEN_MM_2]);
    const b = detectPhases(rows, 0);
    expect(b.openingEndPly).toBe(1);
    expect(b.endgameStartPly).toBe(5);
  });

  it('clamps endgameStartPly to openingEndPly + 1 when book runs deep', () => {
    const rows = rowsFromFens([FEN_MM_6, FEN_MM_6, FEN_MM_6, FEN_MM_6]);
    const b = detectPhases(rows, 3);
    expect(b.openingEndPly).toBe(3);
    expect(b.endgameStartPly).toBe(4);
  });

  it('lets a custom position start straight in the endgame', () => {
    const rows = rowsFromFens([FEN_MM_2, FEN_MM_2]);
    const b = detectPhases(rows, 0);
    expect(b.openingEndPly).toBe(0); // game starts in middlegame-or-later
    expect(b.endgameStartPly).toBe(1);
    expect(phaseOfPly(b, 1)).toBe('endgame');
  });

  it('handles no rows', () => {
    expect(detectPhases([], 0)).toEqual({ openingEndPly: 0, endgameStartPly: Infinity });
  });
});

describe('phaseOfPly', () => {
  it('maps plies to phases against the boundaries', () => {
    const b = { openingEndPly: 8, endgameStartPly: 21 };
    expect(phaseOfPly(b, 1)).toBe('opening');
    expect(phaseOfPly(b, 8)).toBe('opening');
    expect(phaseOfPly(b, 9)).toBe('middlegame');
    expect(phaseOfPly(b, 20)).toBe('middlegame');
    expect(phaseOfPly(b, 21)).toBe('endgame');
    expect(phaseOfPly(b, 99)).toBe('endgame');
  });

  it('treats an unreached endgame (Infinity) as middlegame forever', () => {
    const b = { openingEndPly: 4, endgameStartPly: Infinity };
    expect(phaseOfPly(b, 5)).toBe('middlegame');
    expect(phaseOfPly(b, 500)).toBe('middlegame');
  });
});

describe('phaseBreakdown', () => {
  it('always returns the three phases in order with inclusive spans', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((ply) => row({ ply }));
    const b = { openingEndPly: 3, endgameStartPly: 7 };
    const phases = phaseBreakdown(rows, b);
    expect(phases.map((p) => p.phase)).toEqual(['opening', 'middlegame', 'endgame']);
    expect(phases.map((p) => [p.startPly, p.endPly])).toEqual([
      [1, 3],
      [4, 6],
      [7, 8],
    ]);
  });

  it('aggregates accuracy/acpl/moves per side from the phase rows only', () => {
    const rows = [
      row({ ply: 1, moveAccuracy: 100, evalBefore: { cp: 20 }, evalAfter: { cp: 20 } }),
      row({ ply: 2, moveAccuracy: 90, evalBefore: { cp: 20 }, evalAfter: { cp: 60 } }),
      row({ ply: 3, moveAccuracy: 40, evalBefore: { cp: 60 }, evalAfter: { cp: -140 } }),
      row({ ply: 4, moveAccuracy: 100, evalBefore: { cp: -140 }, evalAfter: { cp: -140 } }),
    ];
    const b = { openingEndPly: 2, endgameStartPly: Infinity };
    const [opening, middlegame, endgame] = phaseBreakdown(rows, b);
    const openingRows = rows.slice(0, 2);
    const middleRows = rows.slice(2);
    expect(opening!.white).toEqual({
      accuracy: gameAccuracy(openingRows, 'white'),
      acpl: acpl(openingRows, 'white'),
      moves: 1,
    });
    expect(opening!.black.moves).toBe(1);
    expect(middlegame!.white).toEqual({
      accuracy: gameAccuracy(middleRows, 'white'),
      acpl: acpl(middleRows, 'white'),
      moves: 1,
    });
    expect(middlegame!.white.acpl).toBe(200);
    expect(endgame!.white.moves).toBe(0);
  });

  it('marks empty phases with moves 0, accuracy 100, acpl 0 and endPly < startPly', () => {
    const rows = [1, 2, 3, 4].map((ply) => row({ ply }));
    // Opening ends at 2, endgame starts at 3 → empty middlegame.
    const phases = phaseBreakdown(rows, { openingEndPly: 2, endgameStartPly: 3 });
    const middlegame = phases[1]!;
    expect(middlegame.endPly).toBeLessThan(middlegame.startPly);
    expect(middlegame.white).toEqual({ accuracy: 100, acpl: 0, moves: 0 });
    expect(middlegame.black).toEqual({ accuracy: 100, acpl: 0, moves: 0 });
    // An unreached endgame is empty too.
    const [, , endgame] = phaseBreakdown(rows, { openingEndPly: 2, endgameStartPly: Infinity });
    expect(endgame!.white.moves + endgame!.black.moves).toBe(0);
    expect(endgame!.endPly).toBeLessThan(endgame!.startPly);
  });
});

describe('findCriticalMoments', () => {
  it('includes 18-point White-POV swings and skips smaller quiet moves', () => {
    const moments = findCriticalMoments([
      detail({ ply: 1, winBefore: 50, winAfter: 32 }), // exactly 18
      detail({ ply: 5, winBefore: 50, winAfter: 33.1 }), // 16.9 — out
    ]);
    expect(moments.map((m) => m.ply)).toEqual([1]);
    expect(moments[0]!.winSwing).toBe(18);
  });

  it('always includes blunder/miss/brilliant grades and delivered mates', () => {
    const moments = findCriticalMoments([
      detail({ ply: 3, classification: 'brilliant', winBefore: 55, winAfter: 58 }),
      detail({ ply: 7, classification: 'miss', winBefore: 90, winAfter: 60 }),
      detail({ ply: 11, san: 'Qh5#', isMate: true, winBefore: 99, winAfter: 100 }),
    ]);
    expect(moments.map((m) => m.kind)).toEqual(['missed-win', 'brilliant', 'mate']);
  });

  it('maps kinds: mate wins over grade, then miss, brilliant, turnaround, blunder', () => {
    const mate = detail({ ply: 9, san: 'Ra8#', isMate: true, classification: 'best', winBefore: 98, winAfter: 100 });
    // Black move: White-POV 60 → 40 means mover went 40 → 60.
    const turnaround = detail({ ply: 4, winBefore: 60, winAfter: 40 });
    const blunder = detail({ ply: 1, classification: 'blunder', winBefore: 55, winAfter: 15 });
    const [a] = findCriticalMoments([mate]);
    const [b] = findCriticalMoments([turnaround]);
    const [c] = findCriticalMoments([blunder]);
    expect(a!.kind).toBe('mate');
    expect(b!.kind).toBe('turnaround');
    expect(c!.kind).toBe('blunder');
  });

  it('sorts by winSwing descending with the mate pinned last as the finale', () => {
    const moments = findCriticalMoments([
      detail({ ply: 1, classification: 'blunder', winBefore: 50, winAfter: 20 }), // 30
      detail({ ply: 5, classification: 'blunder', winBefore: 80, winAfter: 20 }), // 60
      detail({ ply: 9, san: 'Qg7#', isMate: true, winBefore: 95, winAfter: 100 }), // 5, pinned
    ]);
    expect(moments.map((m) => m.ply)).toEqual([5, 1, 9]);
    expect(moments[2]!.kind).toBe('mate');
  });

  it('keeps only the larger swing of two moments on adjacent plies', () => {
    const moments = findCriticalMoments([
      detail({ ply: 10, winBefore: 20, winAfter: 50 }), // 30
      detail({ ply: 11, winBefore: 50, winAfter: 25 }), // 25 — adjacent, dropped
      detail({ ply: 13, winBefore: 25, winAfter: 45 }), // 20 — not adjacent, kept
    ]);
    expect(moments.map((m) => m.ply)).toEqual([10, 13]);
  });

  it('never dedupes the mate away, even next to a bigger adjacent swing', () => {
    const moments = findCriticalMoments([
      detail({ ply: 20, classification: 'blunder', winBefore: 40, winAfter: 95 }), // walks into mate
      detail({ ply: 21, san: 'Rh8#', isMate: true, winBefore: 95, winAfter: 100 }),
    ]);
    expect(moments.map((m) => m.ply)).toEqual([20, 21]);
  });

  it('caps the list at limit (default 6), sacrificing the smallest swings', () => {
    const details = [1, 5, 9, 13, 17, 21, 25, 29].map((ply, i) =>
      detail({ ply, winBefore: 90, winAfter: 90 - 20 - i }),
    );
    expect(findCriticalMoments(details)).toHaveLength(6);
    const top2 = findCriticalMoments(details, 2);
    expect(top2.map((m) => m.ply)).toEqual([29, 25]);
    // The mate still makes the cut as the finale.
    const withMate = [...details, detail({ ply: 33, san: 'Qf7#', isMate: true, winBefore: 99, winAfter: 100 })];
    const capped = findCriticalMoments(withMate, 3);
    expect(capped).toHaveLength(3);
    expect(capped[2]!.kind).toBe('mate');
  });

  it('writes descriptions with move-list numbering and annotation glyphs', () => {
    const [white] = findCriticalMoments([
      detail({ ply: 27, san: 'Qxb7', classification: 'blunder', winBefore: 80, winAfter: 30 }),
    ]);
    expect(white!.description).toBe('14. Qxb7?? throws away a winning position.');
    const [black] = findCriticalMoments([
      // Black (mover) POV: 80 → 15.
      detail({ ply: 12, san: 'Nxe4', classification: 'blunder', winBefore: 20, winAfter: 85 }),
    ]);
    expect(black!.description).toBe('6… Nxe4?? throws away a winning position.');
    // Non-annotation glyphs (✓ ⋯ ◫ ✗) are never appended to the SAN.
    const [miss] = findCriticalMoments([
      detail({ ply: 3, san: 'Bd3', classification: 'miss', winBefore: 90, winAfter: 55 }),
    ]);
    expect(miss!.description).toBe('2. Bd3 lets a winning position slip away.');
  });

  it('describes a mate and a turnaround from the mover perspective', () => {
    const [mate] = findCriticalMoments([
      detail({ ply: 42, san: 'Qh2#', isMate: true, winBefore: 2, winAfter: 0 }),
    ]);
    expect(mate!.description).toBe('21… Qh2# — Black delivers checkmate.');
    const [turn] = findCriticalMoments([
      detail({ ply: 8, san: 'Rxf2', winBefore: 62, winAfter: 38 }),
    ]);
    expect(turn!.kind).toBe('turnaround');
    expect(turn!.description).toBe("4… Rxf2 turns the game around in Black's favour.");
  });

  it('returns an empty list for a quiet game', () => {
    const quiet = [1, 2, 3, 4].map((ply) => detail({ ply, winBefore: 50, winAfter: 52 }));
    expect(findCriticalMoments(quiet)).toEqual([]);
  });
});
