// Regression tests for the anti-blunder correctness check
// (apps/web/src/lib/threats.ts + trainers/blunders.ts).
//
// The trainer used to count ANY non-scripted move as a success — even one that
// loses to the identical mate (browser audit: back-rank drill, Rd1–d5 still
// runs into …Re1# but was greeted with green "dodges the trap" + an SRS pass).
// The fix checks the position after the player's move for a mate-in-one reply.
//
// Run via the workspace's tsx:   pnpm test:threats
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

import { mateInOneUci } from '../apps/web/src/lib/threats.ts';
import { BLUNDER_POSITIONS } from '../apps/web/src/trainers/blunders.ts';

const after = (fen: string, uci: string): string => {
  const g = new Chess(fen);
  const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  assert.ok(mv, `move ${uci} must be legal from ${fen}`);
  return g.fen();
};

test('mateInOneUci: basics', () => {
  // White mates with Qd1–h5# (bundled puzzle t2's position).
  assert.equal(mateInOneUci('rnbqkbnr/ppppp2p/8/5pp1/4P3/6PB/PPPP1P1P/RNBQK1NR w KQkq - 0 4'), 'd1h5');
  // Starting position: no mate in one.
  assert.equal(mateInOneUci(new Chess().fen()), null);
  // Terminal position (already mate): no moves, hence null.
  assert.equal(mateInOneUci('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), null);
  // Garbage input.
  assert.equal(mateInOneUci('not a fen'), null);
});

test('mateInOneUci: promotion mates include the promotion piece', () => {
  // White promotes with mate: g7–g8=Q#.
  assert.equal(mateInOneUci('6k1/6P1/6K1/8/8/8/8/4R3 w - - 0 1'), 'e1e8');
  assert.equal(mateInOneUci('7k/5KP1/8/8/8/8/8/8 w - - 0 1'), 'g7g8q');
});

test('every bundled drill: the tempting move loses to a mate-in-one', () => {
  for (const b of BLUNDER_POSITIONS) {
    const mate = mateInOneUci(after(b.fen, b.tempting));
    assert.ok(mate, `${b.id}: tempting ${b.tempting} must allow a mate-in-one`);
    // And it is the scripted refutation.
    assert.equal(mate, b.refutation[1], `${b.id}: refutation mismatch`);
  }
});

test('every bundled drill: the model move survives (no mate-in-one reply)', () => {
  for (const b of BLUNDER_POSITIONS) {
    assert.equal(mateInOneUci(after(b.fen, b.best[0]!)), null, `${b.id}: best ${b.best[0]} must not hang a mate`);
  }
});

test('audit repro: back-rank drill, Rd1-d5 dodges the script but still hangs …Re1#', () => {
  const b = BLUNDER_POSITIONS.find((x) => x.id === 'blunder-backrank-1')!;
  assert.notEqual('d1d5', b.tempting); // not the intercepted move…
  assert.equal(mateInOneUci(after(b.fen, 'd1d5')), 'e8e1'); // …but loses identically
});
