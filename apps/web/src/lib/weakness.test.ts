import { describe, expect, it } from 'vitest';
import type { AnalysisReport, MoveDetail, PhaseStats, PlayerSummary } from './analytics/types';
import {
  buildWeaknessProfile,
  describeExample,
  digestReport,
  insightFor,
  tagMistake,
  WEAKNESS_META,
  type GameDigest,
} from './weakness';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** White to move: Ra8# is mate in 1 (and a back-rank mate). */
const BACK_RANK_FEN = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
/** White to move: Nc7+ forks the king on e8 and the rook on a8. */
const FORK_FEN = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';

function move(overrides: Partial<MoveDetail> = {}): MoveDetail {
  return {
    ply: 1,
    side: 'white',
    san: 'e4',
    uci: 'e2e4',
    fenBefore: START,
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

const summary = (overrides: Partial<PlayerSummary> = {}): PlayerSummary => ({
  accuracy: 85,
  acpl: 40,
  moves: 20,
  counts: { brilliant: 0, great: 0, best: 8, good: 8, book: 2, inaccuracy: 1, mistake: 1, blunder: 0, miss: 0 },
  ...overrides,
});

const sideAcc = (accuracy: number, moves: number) => ({ accuracy, acpl: 30, moves });

/** Fixed fixture boundaries: opening 1–8, middlegame 9–30, endgame 31–60. */
function fixturePhases(): PhaseStats[] {
  return [
    { phase: 'opening', startPly: 1, endPly: 8, white: sideAcc(92, 4), black: sideAcc(90, 4) },
    { phase: 'middlegame', startPly: 9, endPly: 30, white: sideAcc(84, 8), black: sideAcc(80, 8) },
    { phase: 'endgame', startPly: 31, endPly: 60, white: sideAcc(70, 5), black: sideAcc(75, 5) },
  ];
}

function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  const moves = overrides.moves ?? [move()];
  return {
    version: 1,
    createdAt: 1_000_000,
    gameKey: 'carv1:fixture01',
    meta: {
      gameNo: 1,
      startFen: START,
      result: '1-0',
      playerColor: 'white',
      engine: { multipv: 2, movetimeMs: 0, depth: 18 },
    },
    white: summary(),
    black: summary({ accuracy: 78 }),
    opening: { eco: 'B20', name: 'Sicilian Defense', leftTheoryAtPly: 6 },
    phases: fixturePhases(),
    criticalMoments: [],
    estimatedPerformanceRating: { white: 1500, black: 1400 },
    moves,
    ...overrides,
  };
}

/** A blunder row at `ply` that hangs the moved piece (refutation captures it). */
function hangingBlunder(ply: number): MoveDetail {
  return move({
    ply,
    side: ply % 2 === 1 ? 'white' : 'black',
    san: 'Qd4',
    uci: 'd1d4',
    classification: 'blunder',
    winBefore: ply % 2 === 1 ? 70 : 30,
    winAfter: ply % 2 === 1 ? 25 : 75,
    bestReplySan: 'Nxd4',
    bestReplyUci: 'c6d4',
  });
}

// ---------------------------------------------------------------------------
// tagMistake
// ---------------------------------------------------------------------------

describe('tagMistake — weakness bucket tagging', () => {
  it('tags a hung piece when the refutation captures the moved piece', () => {
    const kinds = tagMistake(hangingBlunder(15), 'middlegame', 45);
    expect(kinds).toContain('hangingPieces');
  });

  it('tags a hung piece on a capture refutation with a large drop even off-square', () => {
    const m = move({ san: 'Rd1', uci: 'a1d1', bestReplySan: 'Qxa2', bestReplyUci: 'b2a2', classification: 'blunder' });
    expect(tagMistake(m, 'middlegame', 30)).toContain('hangingPieces');
    // Small drop + refutation not taking the moved piece → not "hanging".
    expect(tagMistake(m, 'middlegame', 5)).not.toContain('hangingPieces');
  });

  it('tags a missed mate when the engine line mates (back rank)', () => {
    const m = move({
      fenBefore: BACK_RANK_FEN,
      san: 'Kd2',
      uci: 'e1d2',
      classification: 'miss',
      bestMoveSan: 'Ra8#',
      bestMoveUci: 'a1a8',
      pv: ['Ra8#'],
    });
    expect(tagMistake(m, 'middlegame', 40)).toContain('missedMates');
  });

  it('tags a missed fork when the engine line forks (verified on the board)', () => {
    const m = move({
      fenBefore: FORK_FEN,
      san: 'Kd2',
      uci: 'e1d2',
      classification: 'mistake',
      bestMoveSan: 'Nc7+',
      bestMoveUci: 'b5c7',
      pv: ['Nc7+'],
    });
    expect(tagMistake(m, 'middlegame', 25)).toContain('missedForks');
  });

  it('falls back to missedTactics for a big drop with a forcing best move and no named motif', () => {
    const m = move({ classification: 'blunder', bestMoveSan: 'Qxb7', bestMoveUci: 'd1b7' });
    expect(tagMistake(m, 'middlegame', 30)).toEqual(['missedTactics']);
    // Quiet best move → no tactical claim at all.
    const quiet = move({ classification: 'blunder', bestMoveSan: 'Rd1', bestMoveUci: 'a1d1' });
    expect(tagMistake(quiet, 'middlegame', 30)).toEqual([]);
  });

  it('stacks phase buckets on top of tactical ones', () => {
    expect(tagMistake(hangingBlunder(3), 'opening', 45)).toEqual(['hangingPieces', 'openingMistakes']);
    expect(tagMistake(hangingBlunder(41), 'endgame', 45)).toEqual(['hangingPieces', 'endgameMistakes']);
  });
});

// ---------------------------------------------------------------------------
// digestReport
// ---------------------------------------------------------------------------

describe('digestReport', () => {
  it('returns null without a player colour (analysis-board review)', () => {
    const r = report();
    expect(digestReport({ ...r, meta: { ...r.meta, playerColor: null } })).toBeNull();
  });

  it('digests the player side only, with result, opening and phase stats', () => {
    const r = report({
      moves: [
        hangingBlunder(15),
        // Opponent blunder — must NOT appear in the player's digest.
        move({ ply: 16, side: 'black', san: 'Qh4', uci: 'd8h4', classification: 'blunder', winBefore: 25, winAfter: 80 }),
      ],
    });
    const d = digestReport(r)!;
    expect(d.playerColor).toBe('white');
    expect(d.result).toBe('win');
    expect(d.openingName).toBe('Sicilian Defense');
    expect(d.accuracy).toBe(85);
    expect(d.phases.opening).toEqual({ accuracy: 92, acpl: 30, moves: 4 });
    expect(d.mistakes).toHaveLength(1);
    expect(d.mistakes[0]!.san).toBe('Qd4');
    expect(d.mistakes[0]!.moveLabel).toBe('8.');
    expect(d.mistakes[0]!.winDrop).toBe(45);
    expect(d.mistakes[0]!.phase).toBe('middlegame');
  });

  it('maps results from the player POV (black win = 0-1)', () => {
    const r = report({ moves: [move({ side: 'black', ply: 2, san: 'e5', uci: 'e7e5' })] });
    const black = digestReport({ ...r, meta: { ...r.meta, playerColor: 'black', result: '0-1' } })!;
    expect(black.result).toBe('win');
    const draw = digestReport({ ...r, meta: { ...r.meta, playerColor: 'black', result: '1/2-1/2' } })!;
    expect(draw.result).toBe('draw');
  });

  it('computes mover-POV win drops for Black', () => {
    const r = report({
      meta: { gameNo: 1, startFen: START, result: '0-1', playerColor: 'black', engine: { multipv: 2, movetimeMs: 0, depth: 18 } },
      moves: [
        move({ ply: 14, side: 'black', san: 'Rd8', uci: 'a8d8', classification: 'mistake', winBefore: 30, winAfter: 65 }),
      ],
    });
    const d = digestReport(r)!;
    // White-POV 30 → 65 means Black dropped 70 → 35.
    expect(d.mistakes[0]!.winDrop).toBe(35);
    expect(d.mistakes[0]!.moveLabel).toBe('7…');
  });
});

// ---------------------------------------------------------------------------
// buildWeaknessProfile
// ---------------------------------------------------------------------------

let seq = 0;
function digest(overrides: Partial<GameDigest> = {}): GameDigest {
  seq++;
  return {
    gameKey: `g${seq}`,
    createdAt: seq * 1000,
    playerColor: 'white',
    result: 'win',
    accuracy: 85,
    acpl: 40,
    moves: 20,
    openingEco: 'B20',
    openingName: 'Sicilian Defense',
    phases: {
      opening: { accuracy: 92, acpl: 20, moves: 4 },
      middlegame: { accuracy: 84, acpl: 40, moves: 11 },
      endgame: { accuracy: 70, acpl: 60, moves: 5 },
    },
    mistakes: [],
    ...overrides,
  };
}

const mistake = (kinds: GameDigest['mistakes'][number]['kinds'], severity: 'blunder' | 'mistake' | 'miss' = 'blunder', winDrop = 30) => ({
  ply: 15,
  san: 'Qd4',
  moveLabel: '8.',
  fenBefore: START,
  bestSan: 'Nf3',
  bestUci: 'g1f3',
  winDrop,
  severity,
  phase: 'middlegame' as const,
  kinds,
});

describe('buildWeaknessProfile', () => {
  it('requires recurrence: a pattern seen once is not a weakness', () => {
    const p = buildWeaknessProfile([digest({ mistakes: [mistake(['hangingPieces'])] })]);
    expect(p.weaknesses).toHaveLength(0);
    expect(p.games).toBe(1);
  });

  it('ranks weaknesses by severity-weighted frequency and keeps worst examples first', () => {
    const p = buildWeaknessProfile([
      digest({ mistakes: [mistake(['hangingPieces'], 'blunder', 40), mistake(['missedForks'], 'mistake', 12)] }),
      digest({ mistakes: [mistake(['hangingPieces'], 'blunder', 25), mistake(['missedForks'], 'mistake', 15)] }),
    ]);
    expect(p.weaknesses.map((w) => w.kind)).toEqual(['hangingPieces', 'missedForks']);
    const hang = p.weaknesses[0]!;
    expect(hang.count).toBe(2);
    expect(hang.games).toBe(2);
    expect(hang.examples[0]!.winDrop).toBe(40); // worst first
    expect(hang.meta.puzzleThemes).toEqual(['hangingPiece']);
  });

  it('is deterministic: catalogue order breaks ties', () => {
    const games = [
      digest({ mistakes: [mistake(['missedMates']), mistake(['hangingPieces'])] }),
      digest({ mistakes: [mistake(['missedMates']), mistake(['hangingPieces'])] }),
    ];
    const p1 = buildWeaknessProfile(games);
    const p2 = buildWeaknessProfile([...games].reverse());
    expect(p1.weaknesses.map((w) => w.kind)).toEqual(p2.weaknesses.map((w) => w.kind));
    expect(p1.weaknesses.map((w) => w.kind)).toEqual(['hangingPieces', 'missedMates']);
  });

  it('reports a trend once both halves have enough games (negative = improving)', () => {
    // 6 games, newest first after sorting: 3 recent with 0 hangs, 3 earlier with 2 hangs each.
    const older = [0, 1, 2].map((i) =>
      digest({ createdAt: 1000 + i, mistakes: [mistake(['hangingPieces']), mistake(['hangingPieces'])] }),
    );
    const newer = [0, 1, 2].map((i) => digest({ createdAt: 2000 + i, mistakes: [mistake(['missedForks'])] }));
    const p = buildWeaknessProfile([...older, ...newer]);
    const hang = p.weaknesses.find((w) => w.kind === 'hangingPieces')!;
    expect(hang.trend).toBe(-2);
    // Fewer than 3 games per half → no trend voiced.
    const small = buildWeaknessProfile(older.slice(0, 2).concat(newer.slice(0, 2)));
    const hangSmall = small.weaknesses.find((w) => w.kind === 'hangingPieces')!;
    expect(hangSmall.trend).toBeNull();
  });

  it('finds the weakest phase and colour/opening tendencies', () => {
    const p = buildWeaknessProfile([
      digest({ result: 'win' }),
      digest({ result: 'loss', playerColor: 'black', accuracy: 75, openingName: 'French Defense' }),
      digest({ result: 'loss', playerColor: 'black', accuracy: 71, openingName: 'French Defense' }),
    ]);
    expect(p.worstPhase).toBe('endgame');
    expect(p.colors.white).toMatchObject({ games: 1, wins: 1, losses: 0, accuracy: 85 });
    expect(p.colors.black).toMatchObject({ games: 2, wins: 0, losses: 2, accuracy: 73 });
    // Sicilian appears once → filtered; French appears twice → reported.
    expect(p.openings).toHaveLength(1);
    expect(p.openings[0]).toMatchObject({ name: 'French Defense', games: 2, losses: 2 });
  });

  it('weights the overall accuracy by moves played', () => {
    const p = buildWeaknessProfile([digest({ accuracy: 90, moves: 30 }), digest({ accuracy: 60, moves: 10 })]);
    expect(p.accuracy).toBe(82.5);
  });
});

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

describe('plain-language insights', () => {
  const profileWith = (kinds: GameDigest['mistakes'][number]['kinds']) =>
    buildWeaknessProfile([digest({ mistakes: [mistake(kinds, 'blunder', 38)] }), digest({ mistakes: [mistake(kinds)] })]);

  it('voices frequency, a concrete own-game example and the advice', () => {
    const p = profileWith(['hangingPieces']);
    const text = insightFor(p.weaknesses[0]!, p);
    expect(text).toContain('Hanging pieces showed up 2 times across 2 of your last 2 games');
    expect(text).toContain('8. Qd4 in your Sicilian Defense game');
    expect(text).toContain('38% of your winning chances');
    expect(text).toContain('Nf3 was the move');
    expect(text).toContain(WEAKNESS_META.hangingPieces.advice);
  });

  it('celebrates an improving trend instead of repeating the advice', () => {
    const older = [0, 1, 2].map((i) =>
      digest({ createdAt: 1000 + i, mistakes: [mistake(['missedMates']), mistake(['missedMates'])] }),
    );
    const newer = [0, 1, 2].map((i) => digest({ createdAt: 2000 + i }));
    const p = buildWeaknessProfile([...older, ...newer]);
    const text = insightFor(p.weaknesses.find((w) => w.kind === 'missedMates')!, p);
    expect(text).toContain('already happening less');
  });

  it('describes examples with the move-list label and game context', () => {
    const p = profileWith(['missedForks']);
    expect(describeExample(p.weaknesses[0]!.examples[0]!)).toBe(
      '8. Qd4 in your Sicilian Defense game gave away 38% of your winning chances — Nf3 was the move.',
    );
  });
});
