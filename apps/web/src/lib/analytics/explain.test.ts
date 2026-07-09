import { describe, expect, it } from 'vitest';
import { explainMove } from './explain';
import type { MoveRow } from './types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

describe('explainMove — coach prose passthrough', () => {
  it('reuses the coach explanation when the final grade matches', () => {
    const r = row({ coachGrade: 'good', coachExplanation: 'Custom coach prose.' });
    expect(explainMove(r, 'good')).toBe('Custom coach prose.');
  });

  it('rebuilds from templates when the final grade differs from the coach grade', () => {
    const r = row({ coachGrade: 'good', coachExplanation: 'Custom coach prose.' });
    expect(explainMove(r, 'inaccuracy')).not.toBe('Custom coach prose.');
  });

  it('passthrough wins over the mate template when the coach graded the mate', () => {
    const r = row({ san: 'Qxf7#', isMate: true, coachGrade: 'best', coachExplanation: 'Coach mate prose.' });
    expect(explainMove(r, 'best')).toBe('Coach mate prose.');
  });
});

describe('explainMove — delivered checkmate', () => {
  // Seam note: mate is detected from row.isMate (SAN '#'); consolidates with
  // coach.ts checkmateWinner() once fix/coach-trainers lands.
  it('announces the mate and nothing else', () => {
    const r = row({ san: 'Qxf7#', uci: 'h5f7', isMate: true, isCheck: true, winBefore: 90, winAfter: 100 });
    expect(explainMove(r, 'best')).toBe('Checkmate — the game ends here.');
  });

  it('works for a Black mating move too', () => {
    const r = row({ ply: 4, side: 'black', san: 'Qh4#', isMate: true, isCheck: true, winAfter: 0 });
    expect(explainMove(r, 'best')).toBe('Checkmate — the game ends here.');
  });
});

describe('explainMove — missed mate in N', () => {
  it('names the mating move the mover skipped', () => {
    const r = row({
      evalBefore: { mate: 2 },
      evalAfter: { cp: 250 },
      winBefore: 100,
      winAfter: 60,
      bestMoveSan: 'Qg7#',
      bestMoveUci: 'd4g7',
    });
    expect(explainMove(r, 'miss')).toBe('You had mate in 2 starting with Qg7#.');
  });

  it('uses Black-POV mate signs (mate: -N = Black mates)', () => {
    const r = row({
      side: 'black',
      ply: 8,
      evalBefore: { mate: -3 },
      evalAfter: { cp: -300 },
      winBefore: 0,
      winAfter: 15,
      bestMoveSan: 'Qg2#',
      bestMoveUci: 'h3g2',
    });
    expect(explainMove(r, 'miss')).toBe('You had mate in 3 starting with Qg2#.');
  });

  it('falls back to generic mate copy without a best-move SAN', () => {
    const r = row({ evalBefore: { mate: 4 }, evalAfter: { cp: 500 }, winBefore: 100, winAfter: 95 });
    expect(explainMove(r, 'good')).toBe('You had a forced mate in 4 here.');
  });

  it('does not fire when the played move IS the engine best', () => {
    const r = row({ evalBefore: { mate: 2 }, evalAfter: { cp: 900 }, uci: 'e2e4', bestMoveUci: 'e2e4', bestMoveSan: 'e4' });
    expect(explainMove(r, 'best')).not.toMatch(/mate in/);
  });

  it('does not fire when the mate is still on after the move', () => {
    const r = row({ evalBefore: { mate: 3 }, evalAfter: { mate: 5 }, winBefore: 100, winAfter: 100 });
    expect(explainMove(r, 'good')).not.toMatch(/mate in/);
  });
});

describe('explainMove — allowed mate / back rank', () => {
  it('calls out a weak back rank when the reply is a heavy-piece check on the home rank', () => {
    // White played Ra1-a2?? and Black has Re1# on the bare back rank.
    const r = row({
      san: 'Ra2',
      uci: 'a1a2',
      fenBefore: '4r1k1/8/8/8/8/8/5PPP/R5K1 w - - 0 1',
      fenAfter: '4r1k1/8/8/8/8/8/R4PPP/6K1 b - - 1 1',
      evalBefore: { cp: 50 },
      evalAfter: { mate: -1 },
      winBefore: 55,
      winAfter: 0,
      bestReplySan: 'Re1#',
      bestReplyUci: 'e8e1',
    });
    expect(explainMove(r, 'blunder')).toBe('This exposes your weak back rank — Re1# leads to mate in 1.');
  });

  it('reports a generic forced mate when the reply is not a back-rank check', () => {
    // White played Rc2-c1?? but the killer is the smothering-style Nf2#
    // (Kh1 is boxed in by its own g1 rook and g2/h2 pawns).
    const r = row({
      san: 'Rc1',
      uci: 'c2c1',
      fenBefore: '6k1/8/8/8/6n1/8/2R3PP/6RK w - - 0 1',
      fenAfter: '6k1/8/8/8/6n1/8/6PP/2R3RK b - - 1 1',
      evalBefore: { cp: 100 },
      evalAfter: { mate: -1 },
      winBefore: 60,
      winAfter: 0,
      bestReplySan: 'Nf2#',
      bestReplyUci: 'g4f2',
    });
    expect(explainMove(r, 'blunder')).toBe('This walks into a forced mate in 1, starting with Nf2#.');
  });
});

describe('explainMove — hung piece', () => {
  it('names the piece the best reply takes for free', () => {
    // Nc3?? walks the knight into the d4 pawn's capture.
    const r = row({
      san: 'Nc3',
      uci: 'b1c3',
      fenBefore: 'k7/8/8/8/3p4/8/8/1N2K3 w - - 0 1',
      fenAfter: 'k7/8/8/8/3p4/2N5/8/4K3 b - - 1 1',
      evalBefore: { cp: 150 },
      evalAfter: { cp: -200 },
      winBefore: 60,
      winAfter: 15,
      bestReplySan: 'dxc3',
      bestReplyUci: 'd4c3',
    });
    expect(explainMove(r, 'blunder')).toBe('This leaves the knight hanging — dxc3 just takes it.');
  });

  it('does not call a brilliant sacrifice "hanging"', () => {
    // Qd8+!! Rxd8 loses the queen on purpose; brilliant is not a bad grade.
    const r = row({
      san: 'Qd8+',
      uci: 'd1d8',
      isCheck: true,
      fenBefore: 'r5k1/8/8/8/8/8/8/3QK3 w - - 0 1',
      fenAfter: 'r2Q2k1/8/8/8/8/8/8/4K3 b - - 1 1',
      winBefore: 60,
      winAfter: 65,
      bestReplySan: 'Rxd8',
      bestReplyUci: 'a8d8',
    });
    expect(explainMove(r, 'brilliant')).toBe('A queen sacrifice the engine still rates in your favour — a brilliant resource.');
  });
});

describe('explainMove — allowed tactic', () => {
  it('names the fork the reply lands', () => {
    // Rc1?? lets Black play Ne2+, forking the g1 king and c1 rook.
    const r = row({
      san: 'Rc1',
      uci: 'c2c1',
      fenBefore: '6k1/8/8/8/3n4/8/2R5/6K1 w - - 0 1',
      fenAfter: '6k1/8/8/8/3n4/8/8/2R3K1 b - - 1 1',
      evalBefore: { cp: 80 },
      evalAfter: { cp: -450 },
      winBefore: 60,
      winAfter: 10,
      bestReplySan: 'Ne2+',
      bestReplyUci: 'd4e2',
    });
    expect(explainMove(r, 'blunder')).toBe('This allows Ne2+, forking your king and rook.');
  });

  it('falls back to eval phrasing when the reply captures without a nameable fork', () => {
    // e5?? drops the pawn to Bxe5 (only 1 pawn, so not the "hanging" template).
    const r = row({
      san: 'e5',
      uci: 'e4e5',
      fenBefore: '6k1/8/8/8/4P3/2b5/8/6K1 w - - 0 1',
      fenAfter: '6k1/8/8/4P3/8/2b5/8/6K1 b - - 0 1',
      evalBefore: { cp: -50 },
      evalAfter: { cp: -300 },
      winBefore: 55,
      winAfter: 20,
      bestReplySan: 'Bxe5',
      bestReplyUci: 'c3e5',
    });
    expect(explainMove(r, 'blunder')).toBe('This allows Bxe5 — your position slips to losing.');
  });
});

describe('explainMove — missed tactic', () => {
  it('names the fork the mover skipped', () => {
    // Kd2? instead of Nc7+, forking the e8 king and a8 rook.
    const r = row({
      san: 'Kd2',
      uci: 'e1d2',
      fenBefore: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1',
      fenAfter: 'r3k3/8/8/3N4/8/8/3K4/8 b - - 1 1',
      evalBefore: { cp: 600 },
      evalAfter: { cp: 100 },
      winBefore: 95,
      winAfter: 60,
      bestMoveSan: 'Nc7+',
      bestMoveUci: 'd5c7',
      pv: ['Nc7+', 'Kd8', 'Nxa8'],
    });
    expect(explainMove(r, 'blunder')).toBe('You missed a fork — Nc7+ attacks the king and rook.');
  });

  it('names the piece the engine line wins', () => {
    // The queen just takes the loose d5 knight; no second fork target.
    const r = row({
      san: 'Kb1',
      uci: 'a1b1',
      fenBefore: 'k7/8/8/3n4/8/8/8/K2Q4 w - - 0 1',
      fenAfter: 'k7/8/8/3n4/8/8/8/1K1Q4 b - - 1 1',
      evalBefore: { cp: 400 },
      evalAfter: { cp: 50 },
      winBefore: 80,
      winAfter: 55,
      bestMoveSan: 'Qxd5+',
      bestMoveUci: 'd1d5',
      pv: ['Qxd5+', 'Kb8'],
    });
    expect(explainMove(r, 'mistake')).toBe('You missed Qxd5+, winning the knight: Qxd5+ Kb8.');
  });

  it('quotes the PV for a checking line with no verified material gain', () => {
    const base: Partial<MoveRow> = {
      san: 'Kb1',
      uci: 'a1b1',
      fenBefore: 'k7/8/8/8/8/8/8/K3Q3 w - - 0 1',
      fenAfter: 'k7/8/8/8/8/8/8/1K2Q3 b - - 1 1',
      evalBefore: { cp: 500 },
      evalAfter: { cp: 100 },
      winBefore: 85,
      winAfter: 50,
      bestMoveSan: 'Qe8+',
      bestMoveUci: 'e1e8',
      pv: ['Qe8+', 'Ka7'],
    };
    expect(explainMove(row(base), 'miss')).toBe('Missed win — Qe8+ was the move: Qe8+ Ka7.');
    expect(explainMove(row(base), 'inaccuracy')).toBe('You missed a stronger idea — Qe8+ was the move: Qe8+ Ka7.');
  });
});

describe('explainMove — good/normal fallbacks', () => {
  it('book', () => {
    expect(explainMove(row({ isBook: true }), 'book')).toBe('Still in opening theory — a well-established book move.');
  });

  it('best: plain, with an eval word', () => {
    expect(explainMove(row({ evalAfter: { cp: 0 } }), 'best')).toBe("Best move. You're about equal.");
  });

  it('best: castling', () => {
    const r = row({
      san: 'O-O',
      uci: 'e1g1',
      fenBefore: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
      fenAfter: 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1',
    });
    expect(explainMove(r, 'best')).toBe('Best move — tucking your king to safety by castling.');
  });

  it('best: a capture that nets material', () => {
    const r = row({
      san: 'Qxd5+',
      uci: 'd1d5',
      isCheck: true,
      fenBefore: 'k7/8/8/3n4/8/8/8/K2Q4 w - - 0 1',
      fenAfter: 'k7/8/8/3Q4/8/8/8/K7 b - - 0 1',
      evalAfter: { cp: 400 },
      bestReplySan: 'Kb8',
      bestReplyUci: 'a8b8',
    });
    expect(explainMove(r, 'best')).toBe('Best move — winning the knight.');
  });

  it('best: an even recapture reads as a fair trade', () => {
    const r = row({
      san: 'Nxd5',
      uci: 'c3d5',
      fenBefore: 'k7/8/4p3/3n4/8/2N5/1P6/K7 w - - 0 1',
      fenAfter: 'k7/8/4p3/3N4/8/8/1P6/K7 b - - 0 1',
      evalAfter: { cp: 10 },
      bestReplySan: 'exd5',
      bestReplyUci: 'e6d5',
    });
    expect(explainMove(r, 'best')).toBe("Best move — a fair trade. You're about equal.");
  });

  it('good: a quiet early minor-piece move is a developing move', () => {
    const r = row({ san: 'Nf3', uci: 'g1f3', fenBefore: START, fenAfter: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1' });
    expect(explainMove(r, 'good')).toBe('A solid developing move.');
  });

  it('good: keeps the advantage when the mover stays clearly on top', () => {
    const r = row({
      ply: 21,
      san: 'Rd1',
      uci: 'a1d1',
      fenBefore: 'k7/8/8/8/8/8/8/R3K3 w - - 0 1',
      fenAfter: 'k7/8/8/8/8/8/8/3RK3 b - - 1 1',
      winAfter: 70,
      bestMoveSan: 'Ra8+',
      bestMoveUci: 'a1a8',
    });
    expect(explainMove(r, 'good')).toBe('Keeps your advantage — though Ra8+ was slightly more precise.');
  });

  it('great: turnaround vs holding copy', () => {
    expect(explainMove(row({ winBefore: 40, winAfter: 55 }), 'great')).toBe('Great move — the resource that turns the game back in your favour.');
    expect(explainMove(row({ winBefore: 60, winAfter: 62 }), 'great')).toBe('Great move — the only move that keeps your advantage together.');
  });
});

describe('explainMove — generic error fallbacks (no board/PV evidence)', () => {
  it('inaccuracy', () => {
    expect(explainMove(row({ bestMoveSan: 'Nf3', winBefore: 60, winAfter: 48 }), 'inaccuracy')).toBe('Inaccurate — Nf3 would have kept more of your edge.');
  });

  it('mistake', () => {
    const r = row({ bestMoveSan: 'Nf3', evalAfter: { cp: -150 }, winBefore: 55, winAfter: 33 });
    expect(explainMove(r, 'mistake')).toBe('A mistake — it lets your position slip to worse. Nf3 was stronger.');
  });

  it('blunder', () => {
    const r = row({ bestMoveSan: 'Nf3', evalAfter: { cp: -700 }, winBefore: 50, winAfter: 5 });
    expect(explainMove(r, 'blunder')).toBe('Blunder — it swings the game to completely lost. Nf3 was needed.');
  });

  it('miss', () => {
    const r = row({ bestMoveSan: 'Qd5', evalBefore: { cp: 700 }, winBefore: 95, winAfter: 55 });
    expect(explainMove(r, 'miss')).toBe('Missed win — you were completely winning, but Qd5 was the way to convert.');
  });
});

describe('explainMove — robustness', () => {
  it('never throws on unparseable FENs/PVs and still explains from the evals', () => {
    const r = row({
      fenBefore: 'not a fen',
      fenAfter: 'also not a fen',
      bestReplyUci: 'e8e1',
      bestMoveSan: 'Qd8',
      pv: ['Qd8', 'Kxd8'],
      evalAfter: { cp: -700 },
      winBefore: 60,
      winAfter: 5,
    });
    let text = '';
    expect(() => {
      text = explainMove(r, 'blunder');
    }).not.toThrow();
    expect(text).toBe('Blunder — it swings the game to completely lost. Qd8 was needed.');
  });

  it('returns 1–2 sentences without emoji for every grade', () => {
    const grades = ['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'miss'] as const;
    for (const g of grades) {
      const text = explainMove(row({ bestMoveSan: 'Nf3' }), g);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/^[A-Z]/);
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false);
    }
  });
});
