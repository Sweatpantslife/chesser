/**
 * Lesson step engine — the pure logic behind every board exercise.
 *
 * Given an exercise step, the current exercise state and an attempted move it
 * decides: illegal / wrong (retry) / correct (and whether the step is done),
 * auto-playing scripted opponent replies for `line` goals. Pure and store-free
 * so it's trivially unit-testable (see engine.test.ts) and the lesson data can
 * be machine-validated end-to-end (see content.test.ts).
 */
import { Chess } from 'chess.js';
import type { ExerciseStep, PromoPiece, StepGoal } from './types';

export interface MoveAttempt {
  from: string;
  to: string;
  promotion?: PromoPiece;
}

export interface ExerciseState {
  fen: string;
  /** Plies consumed so far (index into `goal.moves` for `line` goals). */
  ply: number;
  done: boolean;
}

export type AttemptResult =
  /** Not a legal chess move (can't normally happen via the board UI). */
  | { verdict: 'illegal' }
  /** Legal but doesn't meet the goal. State is unchanged — retry the position. */
  | { verdict: 'wrong'; san: string; fenAfter: string; message: string }
  /** Meets the goal. For unfinished lines, `reply` is the scripted response. */
  | {
      verdict: 'correct';
      san: string;
      /** Position right after the player's move (before any auto-reply). */
      fenAfterPlayer: string;
      /** Scripted opponent reply that was auto-played (line goals only). */
      reply?: { uci: string; san: string };
      state: ExerciseState;
      done: boolean;
    };

const uciOf = (m: MoveAttempt): string => `${m.from}${m.to}${m.promotion ?? ''}`;

const parseUci = (uci: string): MoveAttempt => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  ...(uci[4] ? { promotion: uci[4] as PromoPiece } : {}),
});

const DEFAULT_WRONG: Record<StepGoal['type'], string> = {
  move: 'Not that one — have another look and try again.',
  line: "Legal, but it's not the plan — try again.",
  checkmate: "That doesn't finish the game — look for the move that leaves no escape.",
  capture: "Legal, but you didn't capture anything. Take the piece!",
  promotion: 'Push the pawn all the way to the last rank.',
  any: 'Try again.',
};

export function startExercise(step: ExerciseStep): ExerciseState {
  return { fen: step.fen, ply: 0, done: false };
}

/** Legal destination map for chessground, optionally restricted by origin. */
export function legalDests(fen: string, onlyFrom?: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return map;
  }
  for (const m of game.moves({ verbose: true })) {
    if (onlyFrom && !onlyFrom.includes(m.from)) continue;
    const arr = map.get(m.from) ?? [];
    if (!arr.includes(m.to)) arr.push(m.to);
    map.set(m.from, arr);
  }
  return map;
}

/**
 * Pick the promotion piece when the board UI only reports from/to: lines say
 * exactly what to promote to, promotion goals may prefer a piece, everything
 * else auto-queens (fine for lesson scope — no underpromotion puzzles).
 */
function promotionFor(step: ExerciseStep, state: ExerciseState, attempt: MoveAttempt): PromoPiece {
  if (attempt.promotion) return attempt.promotion;
  if (step.goal.type === 'line') {
    const expected = step.goal.moves[state.ply];
    if (expected && expected.slice(0, 4) === `${attempt.from}${attempt.to}` && expected[4]) {
      return expected[4] as PromoPiece;
    }
  }
  if (step.goal.type === 'promotion' && step.goal.piece) return step.goal.piece;
  return 'q';
}

/** Whether moving from→to in `fen` is a promotion (needs a piece choice). */
export function isPromotion(fen: string, from: string, to: string): boolean {
  try {
    return new Chess(fen).moves({ verbose: true }).some((m) => m.from === from && m.to === to && !!m.promotion);
  } catch {
    return false;
  }
}

/** Evaluate one attempted move against the step's goal. */
export function tryStep(step: ExerciseStep, state: ExerciseState, attempt: MoveAttempt): AttemptResult {
  if (state.done) return { verdict: 'illegal' };
  const game = new Chess(state.fen);
  const promotion = isPromotion(state.fen, attempt.from, attempt.to) ? promotionFor(step, state, attempt) : undefined;
  let move;
  try {
    move = game.move({ from: attempt.from, to: attempt.to, ...(promotion ? { promotion } : {}) });
  } catch {
    return { verdict: 'illegal' };
  }

  const wrong = (): AttemptResult => ({
    verdict: 'wrong',
    san: move.san,
    fenAfter: game.fen(),
    message: step.hint ?? DEFAULT_WRONG[step.goal.type],
  });

  const complete = (): AttemptResult => ({
    verdict: 'correct',
    san: move.san,
    fenAfterPlayer: game.fen(),
    state: { fen: game.fen(), ply: state.ply + 1, done: true },
    done: true,
  });

  const goal = step.goal;
  switch (goal.type) {
    case 'any':
      return complete();
    case 'capture':
      return move.captured ? complete() : wrong();
    case 'promotion':
      return move.promotion && (!goal.piece || move.promotion === goal.piece) ? complete() : wrong();
    case 'checkmate':
      return game.isCheckmate() ? complete() : wrong();
    case 'move': {
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      return goal.moves.some((m) => m === uci || m === uci.slice(0, 4)) ? complete() : wrong();
    }
    case 'line': {
      const expected = goal.moves[state.ply];
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      if (!expected || (expected !== uci && expected !== uci.slice(0, 4))) return wrong();
      const fenAfterPlayer = game.fen();
      const replyUci = goal.moves[state.ply + 1];
      if (replyUci === undefined) {
        return { verdict: 'correct', san: move.san, fenAfterPlayer, state: { fen: fenAfterPlayer, ply: state.ply + 1, done: true }, done: true };
      }
      // Auto-play the scripted opponent reply.
      const reply = game.move(parseUci(replyUci)); // content tests guarantee legality
      const done = state.ply + 2 >= goal.moves.length;
      return {
        verdict: 'correct',
        san: move.san,
        fenAfterPlayer,
        reply: { uci: replyUci, san: reply.san },
        state: { fen: game.fen(), ply: state.ply + 2, done },
        done,
      };
    }
  }
}

/**
 * A move that satisfies the goal from the current state, or null if none
 * exists. Powers the "show me" button and lets the content tests prove every
 * exercise is actually solvable.
 */
export function solutionMove(step: ExerciseStep, state: ExerciseState): MoveAttempt | null {
  if (state.done) return null;
  const goal = step.goal;
  const game = new Chess(state.fen);
  // Respect the exercise's origin restriction — the board blocks anything else.
  const legal = game.moves({ verbose: true }).filter((m) => !step.onlyFrom || step.onlyFrom.includes(m.from));
  const isLegal = (a: MoveAttempt) =>
    legal.some((m) => m.from === a.from && m.to === a.to && (a.promotion ? m.promotion === a.promotion : true));

  switch (goal.type) {
    case 'move': {
      for (const uci of goal.moves) {
        const a = parseUci(uci);
        if (isLegal(a)) return a;
      }
      return null;
    }
    case 'line': {
      const expected = goal.moves[state.ply];
      if (!expected) return null;
      const a = parseUci(expected);
      return isLegal(a) ? a : null;
    }
    case 'checkmate': {
      for (const m of legal) {
        const g = new Chess(state.fen);
        g.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
        if (g.isCheckmate()) return { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion as PromoPiece } : {}) };
      }
      return null;
    }
    case 'capture': {
      const m = legal.find((x) => !!x.captured);
      return m ? { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion as PromoPiece } : {}) } : null;
    }
    case 'promotion': {
      const want = goal.piece ?? 'q';
      const m = legal.find((x) => x.promotion === want);
      return m ? { from: m.from, to: m.to, promotion: want } : null;
    }
    case 'any': {
      const m = legal[0];
      return m ? { from: m.from, to: m.to, ...(m.promotion ? { promotion: 'q' as PromoPiece } : {}) } : null;
    }
  }
}

/** How many moves the learner makes in this exercise (for progress UI). */
export function playerMoveCount(step: ExerciseStep): number {
  return step.goal.type === 'line' ? Math.ceil(step.goal.moves.length / 2) : 1;
}

export { uciOf };
