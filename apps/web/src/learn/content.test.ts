/**
 * Machine-validation of the hand-authored lesson content (same spirit as
 * scripts/validate-trainers.mts): every FEN must load, every exercise must be
 * solvable from start to finish via the engine, every scripted reply must be
 * legal, and metadata must be coherent. Add a lesson and these tests vet it
 * for free.
 */
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ALL_LESSONS, LESSONS_BY_ID, LESSON_TRACKS, nextLessonId } from './index';
import { solutionMove, startExercise, tryStep } from './engine';
import type { ExerciseStep } from './types';

const SQUARE = /^[a-h][1-8]$/;

describe('lesson catalogue', () => {
  it('has unique lesson ids', () => {
    const ids = ALL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(LESSONS_BY_ID).length).toBe(ids.length);
  });

  it('has a sensible amount of content', () => {
    expect(LESSON_TRACKS.length).toBe(5);
    expect(ALL_LESSONS.length).toBeGreaterThanOrEqual(15);
    for (const l of ALL_LESSONS) {
      expect(l.steps.length, `${l.id} has steps`).toBeGreaterThan(0);
      expect(l.steps.some((s) => s.kind === 'exercise'), `${l.id} should be interactive`).toBe(true);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.summary.length).toBeGreaterThan(0);
    }
  });

  it('nextLessonId walks the catalogue in order and ends with null', () => {
    let id: string | null = ALL_LESSONS[0]!.id;
    const seen = new Set<string>([id]);
    while ((id = nextLessonId(id))) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(ALL_LESSONS.length);
  });
});

describe('lesson content is valid and solvable', () => {
  for (const lesson of ALL_LESSONS) {
    describe(lesson.id, () => {
      lesson.steps.forEach((step, i) => {
        const label = `step ${i + 1} (${step.kind})`;

        it(`${label}: fen and shapes are valid`, () => {
          if (step.fen) expect(() => new Chess(step.fen), `${lesson.id} ${label} fen`).not.toThrow();
          for (const s of step.shapes ?? []) {
            expect(s.orig, `${lesson.id} ${label} shape orig`).toMatch(SQUARE);
            if (s.dest) expect(s.dest, `${lesson.id} ${label} shape dest`).toMatch(SQUARE);
          }
        });

        if (step.kind !== 'exercise') return;

        it(`${label}: solvable via engine from start to finish`, () => {
          let state = startExercise(step);
          let guard = 0;
          while (!state.done) {
            expect(guard++, `${lesson.id} ${label} runaway line`).toBeLessThan(30);
            const sol = solutionMove(step, state);
            expect(sol, `${lesson.id} ${label} has a solution at ply ${state.ply}`).not.toBeNull();
            const res = tryStep(step, state, sol!);
            expect(res.verdict, `${lesson.id} ${label} solution move accepted`).toBe('correct');
            if (res.verdict !== 'correct') return;
            state = res.state;
          }
          expect(state.done).toBe(true);
        });

        it(`${label}: goal metadata is coherent`, () => {
          const game = new Chess(step.fen);
          // The learner always plays the side to move; every authored exercise is from White's seat.
          expect(game.turn(), `${lesson.id} ${label} white to move`).toBe('w');

          if (step.goal.type === 'move' || step.goal.type === 'line') {
            for (const uci of step.goal.moves) {
              expect(uci, `${lesson.id} ${label} uci format ${uci}`).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
            }
          }
          if (step.goal.type === 'line') {
            // Play the whole scripted line — both players' moves must be legal in sequence.
            const g = new Chess(step.fen);
            for (const uci of step.goal.moves) {
              expect(
                () => g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) }),
                `${lesson.id} ${label} line move ${uci}`,
              ).not.toThrow();
            }
            // Lines end on the learner's move (odd length) so the step never
            // finishes waiting on a scripted opponent.
            expect(step.goal.moves.length % 2, `${lesson.id} ${label} line ends on player move`).toBe(1);
          }
          if (step.onlyFrom) {
            for (const sq of step.onlyFrom) expect(sq).toMatch(SQUARE);
            // The solution must originate from an allowed square, or the board would block it.
            const sol = solutionMove(step, startExercise(step));
            expect(sol && step.onlyFrom.includes(sol.from), `${lesson.id} ${label} solution reachable`).toBe(true);
          }
        });
      });
    });
  }
});

describe('teaching-moment spot checks', () => {
  it('the en passant exercise really is en passant', () => {
    const lesson = LESSONS_BY_ID['rules-enpassant']!;
    const step = lesson.steps.find((s) => s.kind === 'exercise') as ExerciseStep;
    const g = new Chess(step.fen);
    const mv = g.move({ from: 'e5', to: 'f6' });
    expect(mv.flags).toContain('e'); // chess.js en-passant flag
  });

  it('the castling exercises really castle', () => {
    const lesson = LESSONS_BY_ID['rules-castling']!;
    const [short, long] = lesson.steps.filter((s) => s.kind === 'exercise') as ExerciseStep[];
    expect(new Chess(short!.fen).move({ from: 'e1', to: 'g1' }).san).toBe('O-O');
    expect(new Chess(long!.fen).move({ from: 'e1', to: 'c1' }).san).toBe('O-O-O');
  });

  it('checkmate exercises end the game, and the stalemate demo is stalemate', () => {
    const mateStep = LESSONS_BY_ID['rules-checkmate']!.steps.find((s) => s.kind === 'exercise') as ExerciseStep;
    const res = tryStep(mateStep, startExercise(mateStep), solutionMove(mateStep, startExercise(mateStep))!);
    expect(res.verdict).toBe('correct');
    if (res.verdict === 'correct') expect(new Chess(res.state.fen).isCheckmate()).toBe(true);

    const demos = [...LESSONS_BY_ID['rules-checkmate']!.steps, ...LESSONS_BY_ID['skill-mate-kq']!.steps].filter(
      (s) => s.kind === 'info' && s.fen && s.fen.includes(' b '),
    );
    expect(demos.length).toBeGreaterThan(0);
    for (const d of demos) expect(new Chess(d.fen!).isStalemate()).toBe(true);
  });

  it('the rook ladder line ends in checkmate', () => {
    const lesson = LESSONS_BY_ID['skill-mate-rooks']!;
    const ladder = lesson.steps.find((s) => s.kind === 'exercise' && s.goal.type === 'line') as ExerciseStep;
    const g = new Chess(ladder.fen);
    for (const uci of (ladder.goal as { type: 'line'; moves: string[] }).moves) {
      g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    }
    expect(g.isCheckmate()).toBe(true);
  });

  it('the pin exercise creates an absolute pin (knight cannot move)', () => {
    const lesson = LESSONS_BY_ID['skill-pins']!;
    const second = lesson.steps.filter((s) => s.kind === 'exercise')[1] as ExerciseStep;
    // In the follow-up position the c6 knight is pinned to the king: it has zero legal moves.
    const g = new Chess(second.fen.replace(' w ', ' b '));
    const knightMoves = g.moves({ verbose: true }).filter((m) => m.from === 'c6');
    expect(knightMoves.length).toBe(0);
  });
});
