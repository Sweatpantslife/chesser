import { test } from 'node:test';
import assert from 'node:assert/strict';

// The store pulls in browser-flavoured modules (Web Audio sounds, the engine
// WebSocket client). Give them a minimal `window` so they no-op under node,
// and stub `window.setTimeout` so `_maybeTriggerBot` never actually kicks off
// an engine request (there is no server in unit tests).
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as unknown as { window: { setTimeout: () => number } }).window.setTimeout = () => 0;

const { useGame } = await import('./game');

/**
 * Regression tests for the premove-enabling interaction state produced by
 * `_sync()`: chessground can only queue a premove while `movable.color` stays
 * the player's colour during the opponent's turn (with no real destinations).
 * This was broken by `movableColor` being unset whenever it wasn't the
 * player's move, which made the premove wiring in Board.tsx inert.
 */

test('analysis mode: both sides movable with legal destinations', () => {
  useGame.getState().newGame({ mode: 'analysis' });
  const s = useGame.getState();
  assert.equal(s.movableColor, 'both');
  assert.ok(s.dests.size > 0);
  assert.deepEqual(s.dests.get('e2'), ['e3', 'e4']);
});

test('play mode, player to move: player colour movable with real dests', () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white' });
  const s = useGame.getState();
  assert.equal(s.turnColor, 'white');
  assert.equal(s.movableColor, 'white');
  assert.ok(s.dests.size > 0);
});

test("play mode, bot to move: player colour STAYS movable (premove) but with no dests", () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white' });
  useGame.getState().userMove('e2', 'e4'); // hand the turn to the bot
  const s = useGame.getState();
  assert.equal(s.turnColor, 'black');
  // The player's pieces must remain selectable so chessground can queue a
  // premove while the bot thinks…
  assert.equal(s.movableColor, 'white');
  // …but there must be no real destinations, so no actual move can be played
  // out of turn.
  assert.equal(s.dests.size, 0);
});

test('play mode, browsing history: nothing movable (no premove off the live tip)', () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white' });
  useGame.getState().userMove('e2', 'e4');
  useGame.getState().goToPly(0);
  const s = useGame.getState();
  assert.equal(s.movableColor, undefined);
  assert.equal(s.dests.size, 0);
});

test('play mode, game over: nothing movable', () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white', startFen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1' });
  useGame.getState().userMove('g6', 'g7'); // checkmate
  const s = useGame.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.movableColor, undefined);
  assert.equal(s.dests.size, 0);
});

test('play mode, opponent move lands: real dests come back for the premove to execute against', () => {
  useGame.getState().newGame({ mode: 'play', playerColor: 'white' });
  useGame.getState().userMove('e2', 'e4');
  // Simulate the bot reply landing (as _maybeTriggerBot does: clear the
  // thinking flag, then apply the move at the live tip).
  useGame.setState({ thinking: false });
  useGame.getState()._applyMove({ from: 'e7', to: 'e5' });
  const s = useGame.getState();
  assert.equal(s.turnColor, 'white');
  assert.equal(s.movableColor, 'white');
  // Fresh legal destinations — Board.tsx's playPremove() validates the queued
  // premove against these, so an illegal premove can never execute.
  assert.ok((s.dests.get('g1') ?? []).includes('f3'));
  assert.equal(s.dests.has('e7'), false);
});
