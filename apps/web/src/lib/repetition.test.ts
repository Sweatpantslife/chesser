import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { countRepetitions, isThreefoldRepetition, repetitionKey } from './repetition';

/** Play SAN moves from the start and return every position (start included). */
function fensAfter(sans: string[]): string[] {
  const c = new Chess();
  const fens = [c.fen()];
  for (const san of sans) {
    c.move(san);
    fens.push(c.fen());
  }
  return fens;
}

const SHUFFLE = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];

test('knight shuffle: threefold fires when the start position occurs a third time', () => {
  const fens = fensAfter([...SHUFFLE, ...SHUFFLE]);
  assert.equal(isThreefoldRepetition(fens), true);
  assert.equal(countRepetitions(fens, fens[fens.length - 1]!), 3);
});

test('two occurrences are not yet a threefold repetition', () => {
  const fens = fensAfter(SHUFFLE); // start position has occurred only twice
  assert.equal(isThreefoldRepetition(fens), false);
  assert.equal(countRepetitions(fens, fens[fens.length - 1]!), 2);
});

test('same placement with different castling rights is NOT a repetition', () => {
  // Reach the starting placement twice with full rights, then shuffle the
  // kingside rooks out and back (losing O-O rights for both sides) and reach
  // the same placement again. Placement + side to move match the start, but
  // castling rights differ — so it must not count towards the repetition.
  const moves = [...SHUFFLE, 'Nf3', 'Nf6', 'Rg1', 'Rg8', 'Rh1', 'Rh8', 'Ng1', 'Ng8'];
  const fens = fensAfter(moves);
  const last = fens[fens.length - 1]!;
  assert.equal(new Chess(last).fen().split(' ')[0], new Chess().fen().split(' ')[0], 'sanity: same placement');
  assert.notEqual(repetitionKey(last), repetitionKey(fens[0]!), 'castling rights differ');
  assert.equal(isThreefoldRepetition(fens), false);

  // Two more shuffles repeat the rights-less position a 2nd and 3rd time.
  const fens2 = fensAfter([...moves, ...SHUFFLE]);
  assert.equal(isThreefoldRepetition(fens2), false); // 2nd occurrence only
  const fens3 = fensAfter([...moves, ...SHUFFLE, ...SHUFFLE]);
  assert.equal(isThreefoldRepetition(fens3), true); // 3rd occurrence
});

test('a real en-passant right distinguishes otherwise identical positions', () => {
  // Black pawn on d4 really can capture e4xe3 en passant.
  const withEp = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3';
  const withoutEp = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3';
  assert.notEqual(repetitionKey(withEp), repetitionKey(withoutEp));
  assert.equal(countRepetitions([withEp, withoutEp], withoutEp), 1);
});

test('an unusable en-passant square does NOT distinguish positions', () => {
  // No black pawn can capture on e3, so the ep field grants no actual right.
  const uselessEp = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const noEp = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  assert.equal(repetitionKey(uselessEp), repetitionKey(noEp));
  assert.equal(countRepetitions([uselessEp, noEp, uselessEp], noEp), 3);
});

test('half-move and full-move counters never distinguish positions', () => {
  const a = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const b = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 42 99';
  assert.equal(repetitionKey(a), repetitionKey(b));
});

test('empty history is never a repetition', () => {
  assert.equal(isThreefoldRepetition([]), false);
});
