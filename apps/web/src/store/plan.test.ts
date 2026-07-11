import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { isoWeekIdOf, type PuzzlePlanItem } from '../lib/studyPlan';
import type { GameDigest } from '../lib/weakness';
import type { WeaknessKind } from '../lib/weakness';
import { initPlanTracking, PLAN_ITEM_XP, usePlan } from './plan';
import { useCoach } from './coach';
import { useGamify } from './gamify';
import { useLessons } from './lessons';
import { useRatings } from './ratings';

/**
 * Plan store: week rollover, adaptation to the freshest profile/rating, and
 * completion accounting — all with a pinned clock (lib/clock setClock).
 */

const DAY = 86_400_000;
/** Wednesday 2026-07-08 noon LOCAL (matches the generator test's week W28). */
const T0 = new Date(2026, 6, 8, 12, 0, 0).getTime();

function digest(gameKey: string, kinds: WeaknessKind[], createdAt: number): GameDigest {
  return {
    gameKey,
    createdAt,
    playerColor: 'white',
    result: 'loss',
    accuracy: 70,
    acpl: 80,
    moves: 40,
    openingEco: 'C50',
    openingName: 'Italian Game',
    phases: {
      opening: { accuracy: 85, acpl: 30, moves: 10 },
      middlegame: { accuracy: 70, acpl: 90, moves: 20 },
      endgame: { accuracy: 65, acpl: 100, moves: 10 },
    },
    mistakes: kinds.map((kind, i) => ({
      ply: 10 + i,
      san: 'Qd2',
      moveLabel: `${5 + i}.`,
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      bestSan: 'Nf3',
      bestUci: 'g1f3',
      winDrop: 25,
      severity: 'blunder' as const,
      phase: 'middlegame' as const,
      kinds: [kind],
    })),
  };
}

/** Seed the coach store (read-only consumer) with a fork-heavy history. */
function seedForkWeakness(): void {
  useCoach.setState({
    games: {
      g1: digest('g1', ['missedForks', 'missedForks'], T0 - 2 * DAY),
      g2: digest('g2', ['missedForks', 'hangingPieces'], T0 - 3 * DAY),
      g3: digest('g3', ['hangingPieces'], T0 - 4 * DAY),
    },
  });
}

describe('plan store (clock-injected)', () => {
  beforeEach(() => {
    setClock(() => T0);
    usePlan.getState().reset();
    useCoach.getState().clear();
    useLessons.getState().reset();
    useRatings.getState().reset();
  });
  afterEach(() => setClock(null));

  it('ensurePlan generates once per ISO week and is stable within it', () => {
    seedForkWeakness();
    const p1 = usePlan.getState().ensurePlan();
    expect(p1.weekId).toBe(isoWeekIdOf(new Date(T0)));
    const g1 = usePlan.getState().generatedAt;

    // Later the same week: same plan object, no regeneration.
    setClock(() => T0 + 2 * DAY);
    const p2 = usePlan.getState().ensurePlan();
    expect(p2).toBe(p1);
    expect(usePlan.getState().generatedAt).toBe(g1);
  });

  it('regenerates when the ISO week rolls over, clearing week progress', () => {
    seedForkWeakness();
    const p1 = usePlan.getState().ensurePlan();
    usePlan.getState().logItem(p1.items[0]!.id);
    expect(usePlan.getState().progress[p1.items[0]!.id]).toBe(1);

    setClock(() => T0 + 7 * DAY); // next Wednesday → new ISO week
    const p2 = usePlan.getState().ensurePlan();
    expect(p2.weekId).not.toBe(p1.weekId);
    expect(usePlan.getState().progress).toEqual({});
    expect(usePlan.getState().daily).toEqual({});
  });

  it('adapts: regeneration reads the latest weakness profile and rating', () => {
    seedForkWeakness();
    const before = usePlan.getState().regenerate();
    expect(before.focus[0]).toBe('missedForks');
    expect(before.band).toBe('beginner'); // fresh puzzles glicko starts at 1200

    // The player improved: forks fixed, endgame now leaking — and stronger.
    useCoach.getState().clear();
    useCoach.setState({
      games: {
        h1: digest('h1', ['endgameMistakes', 'endgameMistakes'], T0 - DAY),
        h2: digest('h2', ['endgameMistakes'], T0 - 2 * DAY),
      },
    });
    useRatings.setState({
      categories: {
        ...useRatings.getState().categories,
        puzzles: {
          ...useRatings.getState().categories.puzzles,
          glicko: { ...useRatings.getState().categories.puzzles.glicko, rating: 1550 },
        },
      },
    });

    const after = usePlan.getState().regenerate();
    expect(after.focus[0]).toBe('endgameMistakes');
    expect(after.items[0]!.id).toBe('puzzle:endgameMistakes');
    expect(after.band).toBe('intermediate');
  });

  it('daily quotas: +1 caps at perDay per local day and resumes next day', () => {
    seedForkWeakness();
    const plan = usePlan.getState().ensurePlan();
    const quota = plan.items.find((i): i is PuzzlePlanItem => i.kind === 'puzzle')!;

    for (let i = 0; i < quota.perDay + 3; i++) usePlan.getState().logItem(quota.id);
    expect(usePlan.getState().progress[quota.id]).toBe(quota.perDay); // today capped
    expect(usePlan.getState().daily[quota.id]!['2026-07-08']).toBe(quota.perDay);

    setClock(() => T0 + DAY); // same ISO week, next day → quota resets
    usePlan.getState().logItem(quota.id);
    expect(usePlan.getState().progress[quota.id]).toBe(quota.perDay + 1);
    expect(usePlan.getState().daily[quota.id]!['2026-07-09']).toBe(1);
  });

  it('completing an item pays XP exactly once (passive, via the gamify entry point)', () => {
    seedForkWeakness();
    const plan = usePlan.getState().ensurePlan();
    const lesson = plan.items.find((i) => i.kind === 'lesson')!;

    const xp0 = useGamify.getState().xp;
    usePlan.getState().completeItem(lesson.id);
    expect(usePlan.getState().progress[lesson.id]).toBe(lesson.target);
    expect(useGamify.getState().xp).toBe(xp0 + PLAN_ITEM_XP);

    usePlan.getState().completeItem(lesson.id); // idempotent — no double pay
    expect(useGamify.getState().xp).toBe(xp0 + PLAN_ITEM_XP);
  });

  it('auto-credits solved coach drills and finished lessons (read-only subscriptions)', () => {
    seedForkWeakness();
    const plan = usePlan.getState().ensurePlan();
    initPlanTracking();

    // A SOLVED weakness drill ticks the matching quota; a failed one does not.
    useCoach.getState().recordTraining('missedForks', 'puzzle-a', true);
    expect(usePlan.getState().progress['puzzle:missedForks']).toBe(1);
    useCoach.getState().recordTraining('missedForks', 'puzzle-b', false);
    expect(usePlan.getState().progress['puzzle:missedForks']).toBe(1);

    // Completing the planned lesson checks the lesson item off.
    const lesson = plan.items.find((i) => i.kind === 'lesson')!;
    if (lesson.kind !== 'lesson') throw new Error('unreachable');
    useLessons.getState().complete(lesson.lessonId, 3);
    expect(usePlan.getState().progress[lesson.id]).toBe(1);
  });
});
