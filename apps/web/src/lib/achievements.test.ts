import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementProgress, evaluateAchievements, type AchievementCtx } from './achievements';

const zeroRating = { elo: 0, glicko: 0, peak: 0, played: 0, won: 0 };

/** A fresh player: nothing done yet (level 1 is the floor). */
function baseCtx(over: Partial<AchievementCtx> = {}): AchievementCtx {
  return {
    level: 1,
    streak: 0,
    bestStreak: 0,
    goalMetToday: false,
    goalsMet: 0,
    ratings: { bots: { ...zeroRating }, blitz: { ...zeroRating }, puzzles: { ...zeroRating } },
    puzzlesSolved: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    bestWinStreak: 0,
    botsBeaten: 0,
    topBotBeatenRating: 0,
    rushBest: 0,
    reviews: 0,
    activeDays: 0,
    lessonsCompleted: 0,
    questsCompleted: 0,
    questDaysAllDone: 0,
    weaknessTrainings: 0,
    weaknessesCleared: 0,
    ...over,
  };
}

describe('achievement catalogue (pure evaluation)', () => {
  it('ids are unique and every badge has a positive target', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.target).toBeGreaterThan(0);
  });

  it('a fresh player has earned nothing', () => {
    expect(evaluateAchievements(baseCtx())).toEqual([]);
  });

  it('quest badges follow the lifetime quest counters', () => {
    const earned = new Set(evaluateAchievements(baseCtx({ questsCompleted: 25, questDaysAllDone: 7 })));
    expect(earned.has('quests-first')).toBe(true);
    expect(earned.has('quests-25')).toBe(true);
    expect(earned.has('quests-clean-1')).toBe(true);
    expect(earned.has('quests-clean-7')).toBe(true);

    const partial = new Set(evaluateAchievements(baseCtx({ questsCompleted: 1 })));
    expect(partial.has('quests-first')).toBe(true);
    expect(partial.has('quests-25')).toBe(false);
    expect(partial.has('quests-clean-1')).toBe(false);
  });

  it('win-streak badges read bestWinStreak', () => {
    const earned = new Set(evaluateAchievements(baseCtx({ bestWinStreak: 5, gamesWon: 5, gamesPlayed: 5 })));
    expect(earned.has('play-winstreak-3')).toBe(true);
    expect(earned.has('play-winstreak-5')).toBe(true);
    expect(earned.has('play-winstreak-10')).toBe(false);
  });

  it('review and goal tiers unlock on their counters', () => {
    const earned = new Set(evaluateAchievements(baseCtx({ reviews: 250, goalsMet: 7 })));
    expect(earned.has('learn-reviews-50')).toBe(true);
    expect(earned.has('learn-reviews-250')).toBe(true);
    expect(earned.has('streak-goal-7')).toBe(true);
    expect(earned.has('streak-goal-30')).toBe(false);
    expect(earned.has('streak-first-goal')).toBe(true);
  });

  it('coach badges follow the training counters', () => {
    const earned = new Set(evaluateAchievements(baseCtx({ weaknessTrainings: 50, weaknessesCleared: 1 })));
    expect(earned.has('coach-train-1')).toBe(true);
    expect(earned.has('coach-train-50')).toBe(true);
    expect(earned.has('coach-clear-1')).toBe(true);
    expect(earned.has('coach-clear-3')).toBe(false);

    const partial = new Set(evaluateAchievements(baseCtx({ weaknessTrainings: 1 })));
    expect(partial.has('coach-train-1')).toBe(true);
    expect(partial.has('coach-train-50')).toBe(false);
    expect(partial.has('coach-clear-1')).toBe(false);
  });

  it('achievementProgress clamps at 100% and reports done', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'quests-25')!;
    const over = achievementProgress(a, baseCtx({ questsCompleted: 60 }));
    expect(over.pct).toBe(100);
    expect(over.done).toBe(true);
    const half = achievementProgress(a, baseCtx({ questsCompleted: 5 }));
    expect(half.pct).toBe(20);
    expect(half.done).toBe(false);
  });
});
