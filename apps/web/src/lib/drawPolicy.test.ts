import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreedDrawIsRated, botAcceptsDraw, MIN_DRAW_ACCEPT_PLIES, nonPawnMaterial } from './drawPolicy';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// King + bishop vs king + knight, a bare drawish endgame (6 points of material).
const BARE_ENDGAME_FEN = '8/8/4k3/8/2b5/2N5/4K3/8 w - - 0 40';

test('bot never accepts a draw in the opening, even in a dead-equal position', () => {
  assert.equal(botAcceptsDraw({ plies: 2, botCp: 0, fen: START_FEN }), false);
  assert.equal(botAcceptsDraw({ plies: MIN_DRAW_ACCEPT_PLIES - 1, botCp: 0, fen: START_FEN }), false);
});

test('bot accepts an equal position once the game is sufficiently played out', () => {
  assert.equal(botAcceptsDraw({ plies: MIN_DRAW_ACCEPT_PLIES, botCp: 0, fen: START_FEN }), true);
  assert.equal(botAcceptsDraw({ plies: 60, botCp: 10, fen: START_FEN }), true);
});

test('bot accepts when it stands worse (a draw only helps it)', () => {
  assert.equal(botAcceptsDraw({ plies: 50, botCp: -300, fen: START_FEN }), true);
});

test('bot declines when it is clearly better', () => {
  assert.equal(botAcceptsDraw({ plies: 60, botCp: 200, fen: START_FEN }), false);
  assert.equal(botAcceptsDraw({ plies: 120, botCp: 61, fen: START_FEN }), false);
});

test('bot declines when the position cannot be evaluated', () => {
  assert.equal(botAcceptsDraw({ plies: 60, botCp: null, fen: START_FEN }), false);
});

test('slight edge: declines in a full middlegame, concedes in a bare endgame or a long game', () => {
  assert.equal(botAcceptsDraw({ plies: 50, botCp: 40, fen: START_FEN }), false);
  assert.equal(botAcceptsDraw({ plies: 50, botCp: 40, fen: BARE_ENDGAME_FEN }), true);
  assert.equal(botAcceptsDraw({ plies: 80, botCp: 40, fen: START_FEN }), true);
});

test('nonPawnMaterial counts both sides, excluding kings and pawns', () => {
  assert.equal(nonPawnMaterial(START_FEN), 2 * (3 + 3 + 3 + 3 + 5 + 5 + 9));
  assert.equal(nonPawnMaterial(BARE_ENDGAME_FEN), 6);
  assert.equal(nonPawnMaterial('8/8/4k3/8/8/8/4K3/8 w - - 0 1'), 0);
});

test('early agreed draws are unrated; played-out ones count', () => {
  assert.equal(agreedDrawIsRated(2), false);
  assert.equal(agreedDrawIsRated(MIN_DRAW_ACCEPT_PLIES - 1), false);
  assert.equal(agreedDrawIsRated(MIN_DRAW_ACCEPT_PLIES), true);
});
