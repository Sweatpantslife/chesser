import { describe, expect, it } from 'vitest';
import { classificationCounts, classifyAll, classifyMove } from './classify';
import type { MoveRow } from './types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * A queen sacrifice position: White plays Qd8+ (d1d8) and Black's best reply
 * is Rxd8 (a8d8), leaving White a full queen down. Mirrored FEN for Black.
 */
const SAC_FEN_WHITE = 'r5k1/8/8/8/8/8/8/3QK3 w - - 0 1';
const SAC_FEN_BLACK = '3qk3/8/8/8/8/8/8/R5K1 b - - 0 1';

function row(overrides: Partial<MoveRow> = {}): MoveRow {
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
    ...overrides,
  };
}

describe('classifyMove — delivered checkmate (best-tier, never a bad grade)', () => {
  // Seam note: mate is detected from the SAN '#' suffix (row.isMate); once
  // fix/coach-trainers lands, coach.ts checkmateWinner() covers the same case.
  it('grades the mating move best when there is no coach grade', () => {
    const r = row({ san: 'Qxf7#', uci: 'h5f7', isMate: true, isCheck: true, winBefore: 90, winAfter: 100 });
    expect(classifyMove(r)).toBe('best');
  });

  it('grades a Black mating move best (mover-POV, not White-POV)', () => {
    // Fool's mate: winAfter = 0 White-POV means 100 for the black mover.
    const r = row({ ply: 4, side: 'black', san: 'Qh4#', uci: 'd8h4', isMate: true, isCheck: true, winBefore: 40, winAfter: 0 });
    expect(classifyMove(r)).toBe('best');
  });

  it('keeps a brilliant/great coach grade on the mating move', () => {
    expect(classifyMove(row({ san: 'Qg7#', isMate: true, coachGrade: 'brilliant' }))).toBe('brilliant');
    expect(classifyMove(row({ san: 'Qg7#', isMate: true, coachGrade: 'great' }))).toBe('great');
  });

  it('overrides any bad coach grade on the mating move', () => {
    expect(classifyMove(row({ san: 'Qg7#', isMate: true, coachGrade: 'blunder' }))).toBe('best');
    expect(classifyMove(row({ san: 'Qg7#', isMate: true, coachGrade: 'miss' }))).toBe('best');
    expect(classifyMove(row({ san: 'Qg7#', isMate: true, coachGrade: 'mistake' }))).toBe('best');
  });

  it('never downgrades a mating move even with a catastrophic-looking win% swing', () => {
    const r = row({ san: 'Ra8#', isMate: true, winBefore: 100, winAfter: 0 });
    expect(classifyMove(r)).toBe('best');
  });
});

describe('classifyMove — mate-against and missed mates (non-mating rows)', () => {
  it('grades a move that walks into a forced mate as a blunder', () => {
    const r = row({ winBefore: 55, winAfter: 0, evalAfter: { mate: -3 } });
    expect(classifyMove(r)).toBe('blunder');
  });

  it('grades a missed mate-in-N as a miss while the mover stays winning', () => {
    const r = row({ evalBefore: { mate: 2 }, winBefore: 100, winAfter: 60, evalAfter: { cp: 250 }, bestMoveSan: 'Qg7#', bestMoveUci: 'd4g7' });
    expect(classifyMove(r)).toBe('miss');
  });

  it('grades a missed mate that throws the game away as a blunder, not a miss', () => {
    const r = row({ evalBefore: { mate: 2 }, winBefore: 100, winAfter: 20, evalAfter: { cp: -300 } });
    expect(classifyMove(r)).toBe('blunder');
  });
});

describe('classifyMove — coach grade passthrough and escalation', () => {
  it('passes every non-mate coach grade through when the drop is small', () => {
    const grades = ['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'miss'] as const;
    for (const g of grades) expect(classifyMove(row({ coachGrade: g }))).toBe(g);
  });

  it('escalates a coach "good" to the lichess tier its drop lands in', () => {
    expect(classifyMove(row({ coachGrade: 'good', winBefore: 60, winAfter: 53, bestMoveUci: 'g1f3' }))).toBe('inaccuracy');
    expect(classifyMove(row({ coachGrade: 'good', winBefore: 60, winAfter: 48, bestMoveUci: 'g1f3' }))).toBe('mistake');
    expect(classifyMove(row({ coachGrade: 'good', winBefore: 60, winAfter: 40, bestMoveUci: 'g1f3' }))).toBe('blunder');
  });

  it('escalates a coach "inaccuracy" past the mistake tier when the drop says blunder', () => {
    const r = row({ coachGrade: 'inaccuracy', winBefore: 70, winAfter: 20, bestMoveUci: 'g1f3' });
    expect(classifyMove(r)).toBe('blunder');
  });

  it('re-applies the missed-win read to escalated errors', () => {
    // Coach "good" (house drop < 30) but a 25-point drop from a winning
    // position that lands near equal → miss, not blunder.
    const r = row({ coachGrade: 'good', winBefore: 85, winAfter: 60, bestMoveUci: 'g1f3' });
    expect(classifyMove(r)).toBe('miss');
  });

  it('never escalates the engine\'s own first choice, whatever the eval noise says', () => {
    const r = row({ coachGrade: 'best', uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 60, winAfter: 48 });
    expect(classifyMove(r)).toBe('best');
  });

  it('never downgrades a coach error and leaves special grades alone', () => {
    expect(classifyMove(row({ coachGrade: 'blunder', winBefore: 50, winAfter: 49 }))).toBe('blunder');
    expect(classifyMove(row({ coachGrade: 'brilliant', winBefore: 90, winAfter: 20 }))).toBe('brilliant');
    expect(classifyMove(row({ coachGrade: 'great', winBefore: 90, winAfter: 20 }))).toBe('great');
    expect(classifyMove(row({ coachGrade: 'miss', winBefore: 90, winAfter: 20 }))).toBe('miss');
  });
});

describe('classifyMove — win%-drop thresholds (derived path, lichess 15/10/5)', () => {
  it('drop ≥ 15 → blunder', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 45 }))).toBe('blunder');
  });

  it('drop just under 15 → mistake', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 45.1 }))).toBe('mistake');
  });

  it('drop ≥ 10 → mistake', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 50 }))).toBe('mistake');
  });

  it('drop just under 10 → inaccuracy', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 50.1 }))).toBe('inaccuracy');
  });

  it('drop ≥ 5 → inaccuracy', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 55 }))).toBe('inaccuracy');
  });

  it('drop just under 5 → good when not the engine move', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 55.1, bestMoveUci: 'g1f3' }))).toBe('good');
  });

  it('drop < 2 → best even when not the engine move', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 58.5, bestMoveUci: 'g1f3' }))).toBe('best');
  });

  it('drop of exactly 2 → good when not the engine move', () => {
    expect(classifyMove(row({ winBefore: 60, winAfter: 58, bestMoveUci: 'g1f3' }))).toBe('good');
  });

  it('matching the engine move → best despite a mid-size drop', () => {
    expect(classifyMove(row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 60, winAfter: 52 }))).toBe('best');
  });

  it('uses mover-POV for Black (White-POV win% rising = Black dropping)', () => {
    expect(classifyMove(row({ side: 'black', ply: 2, winBefore: 40, winAfter: 75 }))).toBe('blunder');
    expect(classifyMove(row({ side: 'black', ply: 2, winBefore: 40, winAfter: 38 }))).toBe('best');
  });
});

describe('classifyMove — book', () => {
  it('book when still in theory and the drop is small', () => {
    expect(classifyMove(row({ isBook: true, winBefore: 55, winAfter: 52 }))).toBe('book');
  });

  it('not book when the theory move loses 5+ win% (engine disagrees with the book)', () => {
    expect(classifyMove(row({ isBook: true, winBefore: 60, winAfter: 55 }))).toBe('inaccuracy');
  });
});

describe('classifyMove — miss thresholds', () => {
  it('a blunder from a winning position landing near equal → miss', () => {
    expect(classifyMove(row({ winBefore: 85, winAfter: 50 }))).toBe('miss');
  });

  it('boundary: winAfter of exactly 38 and 65 still count as a miss', () => {
    expect(classifyMove(row({ winBefore: 85, winAfter: 38 }))).toBe('miss');
    expect(classifyMove(row({ winBefore: 85, winAfter: 65 }))).toBe('miss');
  });

  it('winAfter below 38 → the game was thrown away, stays blunder', () => {
    expect(classifyMove(row({ winBefore: 85, winAfter: 37.9 }))).toBe('blunder');
  });

  it('winBefore below 75 → not a squandered win, stays blunder', () => {
    expect(classifyMove(row({ winBefore: 74.9, winAfter: 40 }))).toBe('blunder');
  });

  it('drop under 10 never misses (gate is mistake/blunder only)', () => {
    expect(classifyMove(row({ winBefore: 80, winAfter: 70.1 }))).toBe('inaccuracy');
  });
});

describe('classifyMove — brilliant (sound sacrifice)', () => {
  it('a best-move queen sacrifice that stays winning → brilliant', () => {
    const r = row({
      fenBefore: SAC_FEN_WHITE,
      san: 'Qd8+',
      uci: 'd1d8',
      bestMoveUci: 'd1d8',
      bestReplyUci: 'a8d8',
      winBefore: 60,
      winAfter: 65,
      isCheck: true,
    });
    expect(classifyMove(r)).toBe('brilliant');
  });

  it('a Black sacrifice uses Black material/POV signs', () => {
    const r = row({
      side: 'black',
      ply: 2,
      fenBefore: SAC_FEN_BLACK,
      san: 'Qd1+',
      uci: 'd8d1',
      bestMoveUci: 'd8d1',
      bestReplyUci: 'a1d1',
      winBefore: 40,
      winAfter: 35,
      isCheck: true,
    });
    expect(classifyMove(r)).toBe('brilliant');
  });

  it('not brilliant when already completely winning (winBefore > 95)', () => {
    const r = row({ fenBefore: SAC_FEN_WHITE, uci: 'd1d8', bestMoveUci: 'd1d8', bestReplyUci: 'a8d8', winBefore: 96, winAfter: 96 });
    expect(classifyMove(r)).toBe('best');
  });

  it('not brilliant when the sacrifice is unsound (winAfter < 50)', () => {
    const r = row({ fenBefore: SAC_FEN_WHITE, uci: 'd1d8', bestMoveUci: 'd1d8', bestReplyUci: 'a8d8', winBefore: 55, winAfter: 49 });
    expect(classifyMove(r)).toBe('best');
  });

  it('no material given up → not brilliant', () => {
    expect(classifyMove(row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 60, winAfter: 65 }))).toBe('best');
  });
});

describe('classifyMove — great (turnaround / only move)', () => {
  it('a best move that turns a losing game around → great', () => {
    expect(classifyMove(row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 40, winAfter: 55 }))).toBe('great');
  });

  it('turnaround boundary: winAfter must reach 52', () => {
    expect(classifyMove(row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 40, winAfter: 51.9 }))).toBe('best');
  });

  it('an only-move (big gap to the runner-up) → great', () => {
    const r = row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 70, winAfter: 68, secondEvalBefore: { cp: -300 } });
    expect(classifyMove(r)).toBe('great');
  });

  it('runner-up nearly as good → not great', () => {
    const r = row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 70, winAfter: 68, secondEvalBefore: { cp: 150 } });
    expect(classifyMove(r)).toBe('best');
  });

  it('no only-move credit when already overwhelming (winBefore > 90)', () => {
    const r = row({ uci: 'e2e4', bestMoveUci: 'e2e4', winBefore: 92, winAfter: 91, secondEvalBefore: { cp: -300 } });
    expect(classifyMove(r)).toBe('best');
  });
});

describe('classifyAll', () => {
  it('maps rows in order', () => {
    const rows = [
      row({ ply: 1, winBefore: 60, winAfter: 30 }),
      row({ ply: 2, side: 'black', san: 'Qh4#', isMate: true }),
      row({ ply: 3, coachGrade: 'good' }),
    ];
    expect(classifyAll(rows)).toEqual(['blunder', 'best', 'good']);
  });
});

describe('classificationCounts', () => {
  it('zero-fills every class for both sides', () => {
    const counts = classificationCounts([]);
    const keys = ['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'miss'];
    for (const k of keys) {
      expect(counts.white).toHaveProperty(k, 0);
      expect(counts.black).toHaveProperty(k, 0);
    }
  });

  it('tallies per side', () => {
    const counts = classificationCounts([
      { side: 'white', classification: 'best' },
      { side: 'white', classification: 'best' },
      { side: 'white', classification: 'blunder' },
      { side: 'black', classification: 'miss' },
    ]);
    expect(counts.white.best).toBe(2);
    expect(counts.white.blunder).toBe(1);
    expect(counts.white.miss).toBe(0);
    expect(counts.black.miss).toBe(1);
    expect(counts.black.best).toBe(0);
  });
});
