import { describe, expect, it } from 'vitest';
import { acpl, cpValue, gameAccuracy, moveAccuracy, winPercent } from './accuracy';
import type { MoveRow, Side } from './types';

/** MoveRow with sensible defaults; side derives from ply unless overridden. */
function row(over: Partial<MoveRow> & { ply: number }): MoveRow {
  const side: Side = over.ply % 2 === 1 ? 'white' : 'black';
  return {
    side,
    san: 'e4',
    uci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
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

describe('winPercent', () => {
  it('maps a level position and missing evals to 50%', () => {
    expect(winPercent({ cp: 0 })).toBe(50);
    expect(winPercent(null)).toBe(50);
  });

  it('maps mate scores to the ±1000cp ceiling (lila WinPercent.fromMate), not 100/0', () => {
    const ceiling = winPercent({ cp: 1000 });
    expect(ceiling).toBeCloseTo(97.545, 1);
    expect(winPercent({ mate: 1 })).toBe(ceiling);
    expect(winPercent({ mate: 12 })).toBe(ceiling);
    expect(winPercent({ mate: -1 })).toBe(winPercent({ cp: -1000 }));
    expect(winPercent({ mate: -12 })).toBeCloseTo(2.455, 1);
  });

  it('approaches (but never reaches) 100 for a large White advantage', () => {
    expect(winPercent({ cp: 1000 })).toBeGreaterThan(97);
    expect(winPercent({ cp: 1000 })).toBeLessThan(100);
  });

  it('is symmetric: winPercent(-cp) = 100 - winPercent(cp)', () => {
    for (const cp of [10, 100, 250, 700, 1000]) {
      expect(winPercent({ cp: -cp })).toBeCloseTo(100 - winPercent({ cp }), 10);
    }
  });

  it('is monotonic in centipawns', () => {
    const cps = [-1000, -400, -50, 0, 50, 400, 1000];
    for (let i = 1; i < cps.length; i++) {
      expect(winPercent({ cp: cps[i]! })).toBeGreaterThan(winPercent({ cp: cps[i - 1]! }));
    }
  });

  it('ceils beyond ±1000 cp (lila Cp.CEILING)', () => {
    expect(winPercent({ cp: 5000 })).toBe(winPercent({ cp: 1000 }));
    expect(winPercent({ cp: 1200 })).toBe(winPercent({ cp: 1000 }));
    expect(winPercent({ cp: -5000 })).toBe(winPercent({ cp: -1000 }));
  });
});

describe('cpValue', () => {
  it('passes centipawns through, ceiled to ±1000', () => {
    expect(cpValue({ cp: 123 })).toBe(123);
    expect(cpValue({ cp: -321 })).toBe(-321);
    expect(cpValue({ cp: 4000 })).toBe(1000);
    expect(cpValue({ cp: -4000 })).toBe(-1000);
  });

  it('caps mate scores at ±1000 with White perspective', () => {
    expect(cpValue({ mate: 2 })).toBe(1000);
    expect(cpValue({ mate: -2 })).toBe(-1000);
  });

  it('treats a missing eval as 0', () => {
    expect(cpValue(null)).toBe(0);
  });
});

describe('moveAccuracy', () => {
  it('is exactly 100 when the mover loses no win% (lila early return)', () => {
    expect(moveAccuracy(50, 50, 'white')).toBe(100);
    expect(moveAccuracy(50, 50, 'black')).toBe(100);
  });

  it('treats a win% gain as no loss (exactly 100)', () => {
    expect(moveAccuracy(40, 80, 'white')).toBe(100);
    expect(moveAccuracy(80, 40, 'black')).toBe(100);
  });

  it('matches lila AccuracyPercent.fromWinPercents exactly (full constants + the +1 bonus)', () => {
    // 10 win% dropped by the mover — lichess production yields ~64.58, one
    // point above the truncated published-page formula (~63.58).
    const expected = 103.1668100711649 * Math.exp(-0.04354415386753951 * 10) - 3.166924740191411 + 1;
    expect(moveAccuracy(60, 50, 'white')).toBeCloseTo(expected, 10);
    expect(moveAccuracy(40, 50, 'black')).toBeCloseTo(expected, 10);
    expect(expected).toBeCloseTo(64.5798, 3);
  });

  it('applies the mover perspective to White-POV inputs', () => {
    // White going 30 → 70 gains; Black making the same White-POV swing loses 40.
    expect(moveAccuracy(30, 70, 'white')).toBeCloseTo(100, 3);
    expect(moveAccuracy(30, 70, 'black')).toBeLessThan(30);
  });

  it('clamps to [0, 100] for catastrophic drops', () => {
    expect(moveAccuracy(100, 0, 'white')).toBe(0);
    expect(moveAccuracy(0, 100, 'black')).toBe(0);
  });

  it('is monotonically non-increasing in the win% drop', () => {
    let prev = Infinity;
    for (let drop = 0; drop <= 100; drop += 5) {
      const acc = moveAccuracy(100, 100 - drop, 'white');
      expect(acc).toBeLessThanOrEqual(prev);
      prev = acc;
    }
  });
});

describe('gameAccuracy', () => {
  it('returns 100 for no moves', () => {
    expect(gameAccuracy([], 'white')).toBe(100);
    expect(gameAccuracy([row({ ply: 1 })], 'black')).toBe(100);
  });

  it('returns 100 for a perfect game', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((ply) => row({ ply, moveAccuracy: 100 }));
    expect(gameAccuracy(rows, 'white')).toBe(100);
    expect(gameAccuracy(rows, 'black')).toBe(100);
  });

  it('equals the single move accuracy for a one-move game', () => {
    expect(gameAccuracy([row({ ply: 1, moveAccuracy: 63.4 })], 'white')).toBe(63.4);
  });

  it('blends the harmonic mean in: one blunder drags below the plain mean', () => {
    // Flat win% series → all volatility weights clamp to 0.5, so the weighted
    // mean equals the arithmetic mean (70); harmonic = 3/(1/100+1/100+1/10) = 25.
    const rows = [
      row({ ply: 1, moveAccuracy: 100 }),
      row({ ply: 3, moveAccuracy: 100 }),
      row({ ply: 5, moveAccuracy: 10 }),
    ];
    expect(gameAccuracy(rows, 'white')).toBe(47.5);
  });

  it('floors accuracies at 1 in the harmonic mean (no division blow-up)', () => {
    const rows = [row({ ply: 1, moveAccuracy: 0 }), row({ ply: 3, moveAccuracy: 0 })];
    // weightedMean 0, harmonic 2/(1/1+1/1) = 1 → (0+1)/2 = 0.5.
    expect(gameAccuracy(rows, 'white')).toBe(0.5);
  });

  it('weights moves in volatile stretches more heavily', () => {
    // Five White moves; win% only swings around the last one, so the blunder's
    // window stdev (20 → clamped to 12) dwarfs the flat windows' 0.5 floor.
    const rows = [
      row({ ply: 1, winBefore: 50, moveAccuracy: 100 }),
      row({ ply: 3, winBefore: 50, moveAccuracy: 100 }),
      row({ ply: 5, winBefore: 50, moveAccuracy: 100 }),
      row({ ply: 7, winBefore: 50, moveAccuracy: 100 }),
      row({ ply: 9, winBefore: 90, moveAccuracy: 0 }),
    ];
    // weightedMean = (0.5·400 + 12·0)/(0.5·4 + 12) = 200/14; harmonic = 5/1.04.
    const expected = Math.round(((200 / 14 + 5 / 1.04) / 2) * 10) / 10;
    expect(gameAccuracy(rows, 'white')).toBe(expected);
    expect(expected).toBeLessThan(15);
  });

  it('only counts the requested side', () => {
    const rows = [
      row({ ply: 1, moveAccuracy: 100 }),
      row({ ply: 2, moveAccuracy: 0 }),
      row({ ply: 3, moveAccuracy: 100 }),
    ];
    expect(gameAccuracy(rows, 'white')).toBe(100);
    expect(gameAccuracy(rows, 'black')).toBeLessThan(1);
  });

  it('grades a delivered checkmate as 100 regardless of the stored value', () => {
    const rows = [
      row({ ply: 1, moveAccuracy: 100 }),
      row({ ply: 3, san: 'Qh5#', moveAccuracy: 0, isMate: true }),
    ];
    expect(gameAccuracy(rows, 'white')).toBe(100);
  });
});

describe('acpl', () => {
  it('is 0 for a perfect game and for no moves', () => {
    const rows = [
      row({ ply: 1, evalBefore: { cp: 30 }, evalAfter: { cp: 30 } }),
      row({ ply: 3, evalBefore: { cp: 25 }, evalAfter: { cp: 40 } }), // gain, not loss
    ];
    expect(acpl(rows, 'white')).toBe(0);
    expect(acpl([], 'black')).toBe(0);
  });

  it('averages mover-POV centipawn losses per side', () => {
    const rows = [
      row({ ply: 1, evalBefore: { cp: 100 }, evalAfter: { cp: 0 } }), // white loses 100
      row({ ply: 2, evalBefore: { cp: 0 }, evalAfter: { cp: 100 } }), // black loses 100
      row({ ply: 3, evalBefore: { cp: 100 }, evalAfter: { cp: 50 } }), // white loses 50
      row({ ply: 4, evalBefore: { cp: 50 }, evalAfter: { cp: 50 } }), // black loses 0
    ];
    expect(acpl(rows, 'white')).toBe(75);
    expect(acpl(rows, 'black')).toBe(50);
  });

  it('caps mate scores at ±1000 like cpValue (lila AccuracyCP ceiling)', () => {
    const rows = [row({ ply: 1, evalBefore: { cp: 500 }, evalAfter: { mate: -3 } })];
    expect(acpl(rows, 'white')).toBe(1500); // 500 − (−1000), not infinity
  });

  it('counts a delivered mate as zero loss but keeps it in the divisor', () => {
    const rows = [
      row({ ply: 1, evalBefore: { cp: 0 }, evalAfter: { cp: -100 } }), // white loses 100
      // Walking into mate-in-1 would read as a huge cp loss without the isMate rule.
      row({ ply: 3, san: 'Qh5#', isMate: true, evalBefore: { cp: 200 }, evalAfter: { mate: -1 } }),
    ];
    expect(acpl(rows, 'white')).toBe(50);
  });

  it('rounds to an integer', () => {
    const rows = [
      row({ ply: 1, evalBefore: { cp: 1 }, evalAfter: { cp: 0 } }),
      row({ ply: 3, evalBefore: { cp: 0 }, evalAfter: { cp: 0 } }),
    ];
    expect(acpl(rows, 'white')).toBe(1); // 0.5 rounds up
  });
});
