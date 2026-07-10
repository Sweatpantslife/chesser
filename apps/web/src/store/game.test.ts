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
import { deriveGameResult } from '../lib/gameResult';
import { useGame } from './game';
import { useLadder } from './ladder';
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
const blitz = () => useRatings.getState().categories.blitz;
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
  // Deliberately an otherwise-RATED setup (roster opponent, standard start,
  // no takebacks), so the unrated verdict can only come from the
  // early-agreed-draw branch itself.
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: ['e4', 'e5'], opponent: OPPONENT });
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

test('analysis board: threefold repetition annotates but never ends the game or blocks moves', () => {
  useGame.getState().newGame({ mode: 'analysis' });
  const shuffleUci = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
  for (const uci of shuffleUci) useGame.getState().userMove(uci.slice(0, 2), uci.slice(2, 4));

  const s = useGame.getState();
  assert.equal(s.isGameOver, false, 'exploration must never auto-end on repetition');
  assert.equal(s.winner, null);
  assert.match(s.status, /threefold repetition/i, 'still annotated in the status line');

  useGame.getState().userMove('e2', 'e4'); // moving on must still work
  assert.equal(useGame.getState().history.length, 9, 'move accepted after the third occurrence');
  assert.doesNotMatch(useGame.getState().status, /repetition/i);
});

test('a decisive PGN passing through a repetition exports 1-0 at every ply', () => {
  const pgn = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. e4 e5 6. Qh5 Nc6 7. Bc4 Nf6 8. Qxf7# 1-0';
  assert.equal(useGame.getState().loadPgn(pgn), true);
  const plies = useGame.getState().history.length;
  assert.equal(plies, 15);
  for (let ply = 0; ply <= plies; ply++) {
    useGame.getState().goToPly(ply);
    assert.equal(deriveGameResult(useGame.getState()), '1-0', `wrong result when viewing ply ${ply}`);
  }
});

test('takeback makes the game unrated: a retried win records no Elo/XP/ladder credit', async () => {
  useRatings.getState().reset();
  const opp = { id: 'takeback-bot', name: 'Takeback Bot', rating: 1600 };
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: MATE_SETUP, opponent: opp });

  useGame.getState().takeback(); // undoes 3...Nf6 and 3.Qh5 — the "retry" move
  assert.equal(useGame.getState().takebackUsed, true);
  assert.equal(useGame.getState().history.length, 4);

  // Retry the winning attempt: replay Qh5, scripted bot reply Nf6, then mate.
  const originalBotMove = engine.botMove;
  engine.botMove = (async () => ({ uci: 'g8f6' })) as unknown as typeof engine.botMove;
  useGame.getState().userMove('d1', 'h5');
  // The bot reply lands after a simulated (jittered) think time — poll for it.
  const deadline = Date.now() + 10_000;
  while (useGame.getState().history.length < 6 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  engine.botMove = originalBotMove;
  assert.equal(useGame.getState().history.length, 6, 'bot replied');

  useGame.getState().userMove('h5', 'f7'); // Qxf7#
  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'white');
  assert.equal(bots().played, 0, 'takeback game must not touch ratings');
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.rated, false);
  assert.equal('takeback-bot' in useLadder.getState().defeated, false, 'no ladder credit');
});

test('a new game during the bot dispatch delay cancels the stale engine request', async () => {
  useRatings.getState().reset();
  let botCalls = 0;
  const originalBotMove = engine.botMove;
  engine.botMove = (async () => {
    botCalls++;
    return { uci: 'g8f6' };
  }) as unknown as typeof engine.botMove;

  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: ['e4', 'e5'], opponent: OPPONENT });
  useGame.getState().userMove('g1', 'f3'); // bot's turn — dispatch scheduled within 300ms
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', opponent: OPPONENT }); // reset before it fires

  await new Promise((r) => setTimeout(r, 600)); // past the dispatch delay cap
  engine.botMove = originalBotMove;
  assert.equal(botCalls, 0, 'stale dispatch must not reach the engine');
  assert.equal(useGame.getState().thinking, false);
});

test('flagging on time records the loss once and resumes the analysis stream', () => {
  useRatings.getState().reset();
  useGame.getState().setTimeControl({ initialMs: 1000, incrementMs: 0, label: 'test 1+0' });
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', setupSan: ['e4', 'e5'], opponent: OPPONENT });
  analyzeCalls.length = 0;

  useGame.getState()._tick(5000); // the player (white, to move) flags

  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.winner, 'black');
  assert.equal(s.endReason, 'on time');
  assert.equal(blitz().played, 1, 'timed game recorded under blitz');
  assert.equal(blitz().lost, 1);
  assert.ok(analyzeCalls.length > 0, 'post-game analysis stream resumes after a flag');
  useGame.getState().setTimeControl(null); // don't leak the clock into later tests
});

test('casual endgame practice: the bot answers early draw offers on the merits', async () => {
  useRatings.getState().reset();
  evalCp = 0;
  evalCalls = 0;
  useGame.getState().newGame({
    mode: 'play',
    playerColor: 'white',
    startFen: 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', // dead-equal R+K vs R+K
    setupSan: ['Rb1', 'Rb8'],
    opponent: { name: 'Endgame Sparring', rating: 1600 },
  });
  await useGame.getState().offerDraw();

  const s = useGame.getState();
  assert.equal(s.drawOffer, 'accepted', 'no 20-move stonewall in casual games');
  assert.equal(s.winner, 'draw');
  assert.ok(evalCalls > 0, 'decided on the evaluation, not the ply floor');
  assert.equal(bots().played, 0, 'casual game — the draw is unrated');
  assert.ok(s.gameSummary);
  assert.equal(s.gameSummary!.rated, false);
});
