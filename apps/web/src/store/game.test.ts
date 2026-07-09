/**
 * Store-level regression tests for rating integrity:
 *  - finished games are recorded exactly once (idempotent across re-syncs),
 *  - threefold repetition is detected and claimable,
 *  - the bot never agrees to early draws and early agreed draws are unrated,
 *  - live engine analysis never streams during an active game.
 *
 * Runs under plain `node --test` (no DOM): the store guards its browser API
 * usage, and the engine client is stubbed out below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Score } from '@chesser/shared';
import { engine } from '../lib/engine';
import { useGame } from './game';
import { useRatings } from './ratings';

// The store schedules UI timers via `window.*`; point it at globalThis.
(globalThis as { window?: unknown }).window ??= globalThis;

// --- engine stubs (no server in unit tests) --------------------------------
const analyzeCalls: string[] = [];
let evalCalls = 0;
let evalCp = 0;
engine.analyze = ((fen: string) => {
  analyzeCalls.push(fen);
}) as typeof engine.analyze;
engine.stopAnalysis = () => {};
engine.botMove = async () => {
  throw new Error('no engine in tests');
};
engine.evalOnce = async () => {
  evalCalls++;
  return { kind: 'cp', value: evalCp } as Score;
};

const bots = () => useRatings.getState().categories.bots;
// A roster/ladder-style opponent (has an id) — its standard-start games are rated.
const OPPONENT = { id: 'test-bot', name: 'Testbot', rating: 1600 };

/** 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 — White (the player) mates next with Qxf7#. */
const MATE_SETUP = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'];
const SHUFFLE = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];

test('a finished game is recorded exactly once, across any number of re-syncs', () => {
  useRatings.getState().reset();
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: MATE_SETUP, opponent: OPPONENT });
  useGame.getState().userMove('h5', 'f7'); // Qxf7#

  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'white');
  assert.equal(bots().played, 1);
  assert.equal(bots().won, 1);
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.outcome, 'win');
  assert.equal(s.gameSummary!.rated, true);
  const eloAfter = bots().elo;

  // Simulate everything a Play-tab revisit / navigation storm can do: each of
  // these re-runs _sync on an already-finished game.
  for (let i = 0; i < 5; i++) useGame.getState()._sync();
  useGame.getState().goToPly(0);
  useGame.getState().goToPly(7);
  useGame.getState()._sync();

  assert.equal(bots().played, 1, 'game must not be recorded twice');
  assert.equal(bots().elo, eloAfter, 'rating must not move again');
});

test('resignation records a single loss', () => {
  useRatings.getState().reset();
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: ['e4', 'e5'], opponent: OPPONENT });
  useGame.getState().resign();

  assert.equal(useGame.getState().isGameOver, true);
  assert.equal(useGame.getState().winner, 'black');
  assert.equal(bots().played, 1);
  assert.equal(bots().lost, 1);
  for (let i = 0; i < 5; i++) useGame.getState()._sync();
  assert.equal(bots().played, 1);
});

test('threefold repetition is detected, claimable, and adjudicated correctly', () => {
  useRatings.getState().reset();
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: [...SHUFFLE, ...SHUFFLE], opponent: OPPONENT });

  const s = useGame.getState();
  assert.equal(s.isGameOver, false, 'claimable, not automatic, in play mode');
  assert.equal(s.drawClaimable, true);
  assert.match(s.status, /repetition/i);

  s.claimDraw();
  const s2 = useGame.getState();
  assert.equal(s2.isGameOver, true);
  assert.equal(s2.winner, 'draw');
  assert.equal(s2.endReason, 'Threefold repetition');
  assert.equal(bots().drawn, 1);
});

test('two occurrences of a position are not claimable', () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: SHUFFLE, opponent: OPPONENT });
  assert.equal(useGame.getState().drawClaimable, false);
});

test('live engine analysis never streams during an active game and resumes at game end', () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: MATE_SETUP, opponent: OPPONENT });
  analyzeCalls.length = 0;

  useGame.getState()._refreshAnalysis();
  useGame.getState().goToPly(2); // navigating also triggers a refresh
  useGame.getState().goToPly(6);
  assert.equal(analyzeCalls.length, 0, 'no analysis stream while playing');
  assert.equal(useGame.getState().evalScore, null);

  useGame.getState().userMove('h5', 'f7'); // Qxf7# — game over
  assert.equal(useGame.getState().isGameOver, true);
  assert.ok(analyzeCalls.length > 0, 'analysis resumes once the game is over');
});

test('bot declines a move-2 draw offer outright, without consulting the engine', async () => {
  useRatings.getState().reset();
  evalCalls = 0;
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: ['e4', 'e5'], opponent: OPPONENT });
  await useGame.getState().offerDraw();

  assert.equal(useGame.getState().drawOffer, 'declined');
  assert.equal(useGame.getState().isGameOver, false, 'game continues');
  assert.equal(evalCalls, 0, 'declined before any eval — nothing to farm');
  assert.equal(bots().played, 0);
  useGame.setState({ drawOffer: 'idle' }); // don't leak the declined→idle timer state
});

test('bot accepts a played-out equal draw, recorded as a rated draw', async () => {
  useRatings.getState().reset();
  evalCp = 0;
  const setup: string[] = [];
  for (let i = 0; i < 10; i++) setup.push(...SHUFFLE); // 40 quiet plies
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: setup, opponent: OPPONENT });
  await useGame.getState().offerDraw();

  const s = useGame.getState();
  assert.equal(s.drawOffer, 'accepted');
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'draw');
  assert.equal(s.endReason, 'Draw agreed');
  assert.equal(bots().drawn, 1);
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.rated, true);
});

test('custom games (hand-picked opponent) are casual — wins never move the rating', () => {
  useRatings.getState().reset();
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: MATE_SETUP, opponent: { name: 'Custom 2600', rating: 2600 } });
  useGame.getState().userMove('h5', 'f7'); // Qxf7#

  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'white');
  assert.equal(bots().played, 0, 'casual game — nothing recorded');
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.rated, false);
  assert.equal(s.gameSummary!.ratingDelta, 0);
});

test('games from a pasted FEN are casual even against a roster opponent', () => {
  useRatings.getState().reset();
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', startFen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1', opponent: OPPONENT });
  useGame.getState().userMove('h1', 'h8'); // Rh8#

  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'white');
  assert.equal(bots().played, 0, 'non-standard start — nothing recorded');
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.rated, false);
});

test('a very early agreed draw is rating-neutral (defence in depth)', () => {
  useRatings.getState().reset();
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: ['e4', 'e5'], opponent: { name: 'GM Bot', rating: 2800 } });
  const eloBefore = bots().elo;

  // Force the "agreed draw" ending directly — even if some path ever produces
  // an early agreed draw, it must not touch the rating.
  useGame.setState({ manualResult: { winner: 'draw', reason: 'Draw agreed' }, drawOffer: 'accepted' });
  useGame.getState()._sync();

  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'draw');
  assert.equal(bots().played, 0, 'unrated — no game recorded');
  assert.equal(bots().elo, eloBefore, 'rating unchanged');
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.rated, false);
  assert.equal(s.gameSummary!.ratingDelta, 0);
});
