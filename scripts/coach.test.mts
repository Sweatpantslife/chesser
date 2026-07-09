// Regression tests for the game-review grading path (apps/web/src/lib/coach.ts),
// focused on mate-score handling:
//
//  * a move that DELIVERS checkmate must grade as best/great — the position
//    after it is terminal, the engine returns no eval (score null), and that
//    used to read as 50/50 and grade the mating move "missed win" at 9%
//    accuracy (poisoning the SRS mistakes deck);
//  * a move that PRESERVES a forced mate (mate-in-3 → mate-in-2) is best;
//  * mate-in-N vs centipawn comparisons behave (cp → mate is an improvement,
//    throwing a forced mate away for a small cp edge is a "missed win").
//
// Run via the workspace's tsx:   pnpm test:coach
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

import {
  buildMoveReviews,
  checkmateWinner,
  cpOf,
  type BuildInput,
  type PositionEval,
} from '../apps/web/src/lib/coach.ts';
import { whiteWinPercent } from '../apps/web/src/lib/format.ts';

const WINNING_GRADES = ['best', 'great', 'brilliant'];

const ev = (score: PositionEval['score'], bestUci: string | null = null, secondScore: PositionEval['score'] = null): PositionEval => ({
  score,
  bestUci,
  bestSan: null,
  secondScore,
});

/** Build a one-move review: `uci` played from `fen`, with the given evals. */
function reviewOne(fen: string, uci: string, pre: PositionEval, post: PositionEval, bookPly = 0) {
  const g = new Chess(fen);
  const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
  assert.ok(mv, `test move ${uci} must be legal from ${fen}`);
  const ply = fen.split(' ')[1] === 'w' ? 1 : 2; // side is derived from ply parity
  const input: BuildInput = {
    startFen: fen,
    nodes: [{ id: 'n1', san: mv.san, uci, fen: g.fen(), ply }],
    evals: [pre, post],
    bookPly,
  };
  const out = buildMoveReviews(input);
  assert.equal(out.length, 1);
  return out[0]!;
}

// A real bundled puzzle (t2): White mates in one with Qd1–h5#.
const MATE_IN_1_FEN = 'rnbqkbnr/ppppp2p/8/5pp1/4P3/6PB/PPPP1P1P/RNBQK1NR w KQkq - 0 4';

test('checkmateWinner: detects the mater from a terminal FEN', () => {
  const g = new Chess(MATE_IN_1_FEN);
  g.move({ from: 'd1', to: 'h5' });
  assert.equal(checkmateWinner(g.fen()), 'white');
  assert.equal(checkmateWinner(MATE_IN_1_FEN), null); // not terminal
  // Stalemate is not a checkmate.
  assert.equal(checkmateWinner('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), null);
  assert.equal(checkmateWinner('not a fen'), null);
});

test('white move that delivers mate grades as a winning move (terminal eval is null)', () => {
  const r = reviewOne(
    MATE_IN_1_FEN,
    'd1h5',
    ev({ kind: 'mate', value: 1 }, 'd1h5', { kind: 'cp', value: 250 }),
    ev(null), // what the engine really reports for a mated position: nothing
  );
  assert.ok(WINNING_GRADES.includes(r.classification), `expected best/great/brilliant, got ${r.classification}`);
  assert.equal(r.winWhiteAfter, 100);
  assert.equal(r.evalText, '#');
  assert.match(r.explanation, /checkmate/i);
});

test('black move that delivers mate grades as a winning move', () => {
  // Fool's mate: 1.f3 e5 2.g4 Qh4#
  const g = new Chess();
  for (const san of ['f3', 'e5', 'g4']) g.move(san);
  const fen = g.fen();
  const r = reviewOne(fen, 'd8h4', ev({ kind: 'mate', value: -1 }, 'd8h4'), ev(null));
  assert.ok(WINNING_GRADES.includes(r.classification), `expected best/great/brilliant, got ${r.classification}`);
  assert.equal(r.winWhiteAfter, 0); // Black won: White's win chance is zero
  assert.equal(r.evalText, '#');
});

test('mating move is never demoted to "book"', () => {
  const r = reviewOne(MATE_IN_1_FEN, 'd1h5', ev({ kind: 'mate', value: 1 }, 'd1h5'), ev(null), 10);
  assert.notEqual(r.classification, 'book');
  assert.ok(WINNING_GRADES.includes(r.classification));
});

test('even a slower mate still grades as winning (played move differs from engine best)', () => {
  // Engine prefers some other move, but the player's move mates on the spot:
  // a delivered mate can't be a mistake.
  const r = reviewOne(MATE_IN_1_FEN, 'd1h5', ev({ kind: 'cp', value: 900 }, 'h3f5'), ev(null));
  assert.ok(WINNING_GRADES.includes(r.classification), `expected best/great/brilliant, got ${r.classification}`);
});

test('move preserving a forced mate (mate-in-3 → mate-in-2) is best', () => {
  // KQ vs K: White keeps the mating net closed.
  const fen = '4k3/8/8/8/8/8/3QK3/8 w - - 0 1';
  const r = reviewOne(fen, 'd2d6', ev({ kind: 'mate', value: 3 }, 'd2d6'), ev({ kind: 'mate', value: 2 }, null));
  assert.ok(WINNING_GRADES.includes(r.classification), `expected best/great/brilliant, got ${r.classification}`);
});

test('converting a big cp edge into a forced mate is not punished', () => {
  const fen = '4k3/8/8/8/8/8/3QK3/8 w - - 0 1';
  const r = reviewOne(fen, 'd2d6', ev({ kind: 'cp', value: 800 }, 'd2d6'), ev({ kind: 'mate', value: 3 }, null));
  assert.ok(['best', 'good', 'great', 'brilliant'].includes(r.classification), `got ${r.classification}`);
});

test('throwing away a forced mate for a small cp edge is a missed win', () => {
  const fen = '4k3/8/8/8/8/8/3QK3/8 w - - 0 1';
  const r = reviewOne(
    fen,
    'd2a5', // not the engine move
    ev({ kind: 'mate', value: 3 }, 'd2d6', { kind: 'mate', value: 4 }),
    ev({ kind: 'cp', value: 120 }, 'e8d8'),
  );
  assert.ok(['miss', 'mistake', 'blunder'].includes(r.classification), `expected an error grade, got ${r.classification}`);
});

test('defending while the opponent keeps a forced mate is not graded as an error', () => {
  // Black is getting mated either way (mate-for-White shrinks by force).
  const g = new Chess('4k3/8/8/8/8/8/3QK3/8 w - - 0 1');
  g.move({ from: 'd2', to: 'd6' });
  const fen = g.fen(); // Black to move, lost
  const mv = new Chess(fen).moves({ verbose: true })[0]!;
  const r = reviewOne(fen, mv.from + mv.to, ev({ kind: 'mate', value: 2 }, mv.from + mv.to), ev({ kind: 'mate', value: 2 }, null));
  assert.ok(['best', 'good'].includes(r.classification), `got ${r.classification}`);
});

test('score helpers handle mate scores on both sides', () => {
  assert.equal(whiteWinPercent({ kind: 'mate', value: 5 }), 100);
  assert.equal(whiteWinPercent({ kind: 'mate', value: -5 }), 0);
  assert.equal(whiteWinPercent(null), 50);
  assert.equal(cpOf({ kind: 'mate', value: 2 }), 1500);
  assert.equal(cpOf({ kind: 'mate', value: -2 }), -1500);
  assert.equal(cpOf({ kind: 'cp', value: 99999 }), 1500); // clamped, comparable with mate
});
