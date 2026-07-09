import { describe, expect, it } from 'vitest';
import { legalDests, playerMoveCount, solutionMove, startExercise, tryStep } from './engine';
import type { ExerciseStep } from './types';

const ex = (partial: Partial<ExerciseStep> & Pick<ExerciseStep, 'fen' | 'goal'>): ExerciseStep => ({
  kind: 'exercise',
  prompt: 'test',
  ...partial,
});

describe('tryStep — move goal', () => {
  const step = ex({
    fen: '7k/8/8/8/8/8/4P3/7K w - - 0 1',
    goal: { type: 'move', moves: ['e2e4'] },
    hint: 'custom hint',
  });

  it('accepts the listed move and completes', () => {
    const res = tryStep(step, startExercise(step), { from: 'e2', to: 'e4' });
    expect(res.verdict).toBe('correct');
    if (res.verdict !== 'correct') return;
    expect(res.done).toBe(true);
    expect(res.san).toBe('e4');
    expect(res.state.done).toBe(true);
  });

  it('rejects a legal-but-wrong move, keeps state and surfaces the hint', () => {
    const state = startExercise(step);
    const res = tryStep(step, state, { from: 'e2', to: 'e3' });
    expect(res.verdict).toBe('wrong');
    if (res.verdict !== 'wrong') return;
    expect(res.message).toBe('custom hint');
    expect(res.fenAfter).not.toBe(step.fen); // shows the wrong move so the player sees it
    expect(state.fen).toBe(step.fen); // original state untouched — retry from the same position
    // retrying with the right move after a wrong attempt succeeds
    expect(tryStep(step, state, { from: 'e2', to: 'e4' }).verdict).toBe('correct');
  });

  it('flags illegal moves', () => {
    expect(tryStep(step, startExercise(step), { from: 'e2', to: 'e5' }).verdict).toBe('illegal');
    expect(tryStep(step, startExercise(step), { from: 'h8', to: 'h7' }).verdict).toBe('illegal'); // not your piece
  });

  it('refuses further moves once done', () => {
    const state = { fen: step.fen, ply: 1, done: true };
    expect(tryStep(step, state, { from: 'e2', to: 'e4' }).verdict).toBe('illegal');
  });
});

describe('tryStep — line goal', () => {
  // Knight fork: Nc7+ (forced reply Ke7 scripted), then Nxa8.
  const step = ex({
    fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
    goal: { type: 'line', moves: ['b5c7', 'e8e7', 'c7a8'] },
  });

  it('plays the scripted reply and continues, then completes', () => {
    const s0 = startExercise(step);
    const r1 = tryStep(step, s0, { from: 'b5', to: 'c7' });
    expect(r1.verdict).toBe('correct');
    if (r1.verdict !== 'correct') return;
    expect(r1.done).toBe(false);
    expect(r1.reply).toEqual({ uci: 'e8e7', san: 'Ke7' });
    expect(r1.state.ply).toBe(2);
    // position after the auto-reply: knight on c7, black king on e7
    expect(r1.state.fen).toContain('2N1k3');

    const r2 = tryStep(step, r1.state, { from: 'c7', to: 'a8' });
    expect(r2.verdict).toBe('correct');
    if (r2.verdict !== 'correct') return;
    expect(r2.done).toBe(true);
    expect(r2.san).toBe('Nxa8');
    expect(r2.reply).toBeUndefined();
  });

  it('rejects deviations from the scripted move', () => {
    const res = tryStep(step, startExercise(step), { from: 'b5', to: 'd6' });
    expect(res.verdict).toBe('wrong');
  });

  it('handles scripted promotions with only from/to input (auto-promote)', () => {
    const promo = ex({
      fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
      goal: {
        type: 'line',
        moves: ['e6d6', 'e8d8', 'e5e6', 'd8e8', 'e6e7', 'e8f7', 'd6d7', 'f7f6', 'e7e8q'],
      },
    });
    let state = startExercise(promo);
    const playerMoves = ['e6d6', 'e5e6', 'e6e7', 'd6d7', 'e7e8'];
    for (const uci of playerMoves) {
      const res = tryStep(promo, state, { from: uci.slice(0, 2), to: uci.slice(2, 4) });
      expect(res.verdict).toBe('correct');
      if (res.verdict !== 'correct') return;
      state = res.state;
    }
    expect(state.done).toBe(true);
    expect(state.fen).toContain('Q'); // the pawn became a queen
  });

  it('counts player moves for progress display', () => {
    expect(playerMoveCount(step)).toBe(2);
  });
});

describe('tryStep — checkmate goal', () => {
  const step = ex({ fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', goal: { type: 'checkmate' } });

  it('accepts any mating move', () => {
    const res = tryStep(step, startExercise(step), { from: 'e1', to: 'e8' });
    expect(res.verdict).toBe('correct');
    if (res.verdict !== 'correct') return;
    expect(res.san).toBe('Re8#');
  });

  it('rejects a check that is not mate', () => {
    // Re1-e7 is not even check; try a non-mating rook move
    expect(tryStep(step, startExercise(step), { from: 'e1', to: 'e7' }).verdict).toBe('wrong');
  });
});

describe('tryStep — capture goal', () => {
  const step = ex({ fen: '7k/8/8/3p4/4P3/8/8/7K w - - 0 1', goal: { type: 'capture' } });

  it('accepts a capture', () => {
    const res = tryStep(step, startExercise(step), { from: 'e4', to: 'd5' });
    expect(res.verdict).toBe('correct');
  });

  it('rejects a quiet move', () => {
    const res = tryStep(step, startExercise(step), { from: 'e4', to: 'e5' });
    expect(res.verdict).toBe('wrong');
    if (res.verdict !== 'wrong') return;
    expect(res.message.length).toBeGreaterThan(0); // default message when no hint given
  });
});

describe('tryStep — promotion goal', () => {
  const step = ex({ fen: '7k/4P3/8/8/8/8/8/7K w - - 0 1', goal: { type: 'promotion', piece: 'q' } });

  it('auto-promotes to the requested piece when the UI only sends from/to', () => {
    const res = tryStep(step, startExercise(step), { from: 'e7', to: 'e8' });
    expect(res.verdict).toBe('correct');
    if (res.verdict !== 'correct') return;
    expect(res.san).toBe('e8=Q+');
  });

  it('rejects a non-promoting move', () => {
    expect(tryStep(step, startExercise(step), { from: 'h1', to: 'h2' }).verdict).toBe('wrong');
  });
});

describe('tryStep — any goal (escape check)', () => {
  const step = ex({ fen: '7k/8/8/8/8/8/8/r3K3 w - - 0 1', goal: { type: 'any' } });

  it('accepts any legal move', () => {
    expect(tryStep(step, startExercise(step), { from: 'e1', to: 'e2' }).verdict).toBe('correct');
  });

  it('still rejects illegal moves (staying in check)', () => {
    expect(tryStep(step, startExercise(step), { from: 'e1', to: 'd1' }).verdict).toBe('illegal');
  });
});

describe('legalDests', () => {
  it('maps every origin to its targets', () => {
    const dests = legalDests('7k/8/8/8/8/8/4P3/7K w - - 0 1');
    expect(dests.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(dests.get('h1')).toBeDefined();
  });

  it('respects the onlyFrom restriction', () => {
    const dests = legalDests('7k/8/8/8/8/5p2/4PPPP/4K1N1 w - - 0 1', ['g1']);
    expect([...dests.keys()]).toEqual(['g1']);
    expect(dests.get('g1')).toEqual(expect.arrayContaining(['f3', 'h3']));
  });

  it('returns an empty map for garbage fens', () => {
    expect(legalDests('not a fen').size).toBe(0);
  });
});

describe('solutionMove', () => {
  it('finds the listed move for move goals', () => {
    const step = ex({ fen: '7k/8/8/8/8/8/4P3/7K w - - 0 1', goal: { type: 'move', moves: ['e2e4'] } });
    expect(solutionMove(step, startExercise(step))).toEqual({ from: 'e2', to: 'e4' });
  });

  it('finds a mating move for checkmate goals', () => {
    const step = ex({ fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', goal: { type: 'checkmate' } });
    const sol = solutionMove(step, startExercise(step));
    expect(sol).toEqual({ from: 'e1', to: 'e8' });
  });

  it('finds the promotion for promotion goals', () => {
    const step = ex({ fen: '7k/4P3/8/8/8/8/8/7K w - - 0 1', goal: { type: 'promotion', piece: 'q' } });
    expect(solutionMove(step, startExercise(step))).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('returns null once the exercise is done', () => {
    const step = ex({ fen: '7k/8/8/8/8/8/4P3/7K w - - 0 1', goal: { type: 'move', moves: ['e2e4'] } });
    expect(solutionMove(step, { fen: step.fen, ply: 1, done: true })).toBeNull();
  });
});
