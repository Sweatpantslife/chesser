import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from './clock';
import {
  WEAKNESS_CLEARED_MIN_ATTEMPTS,
  XP_AWARDS,
  onGamifyEvent,
  recordCoachSession,
  recordCoachTraining,
  type GamifyEvent,
} from './gamify';
import { awardCoachReward } from './coachRewards';
import { useGamify } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useRatings } from '../store/ratings';
import { useAchievements } from '../store/achievements';
import { useQuests } from '../store/quests';
import { useCoach } from '../store/coach';
import type { WeaknessKind } from './weakness';

const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

/** Put one rated attempt in the coach log, then notify gamify — the same
 *  order the coach page uses (recordTraining, then the adapter). */
function attempt(kind: WeaknessKind, solved: boolean, viaAdapter = false): void {
  useCoach.getState().recordTraining(kind, `p-${Math.random()}`, solved);
  if (viaAdapter) awardCoachReward({ kind: 'weakness-trained', weakness: kind, solved });
  else recordCoachTraining(kind, solved);
}

describe('coach → gamification wiring', () => {
  let events: GamifyEvent[];
  let unsub: () => void;

  beforeEach(() => {
    setClock(() => T0);
    useGamify.getState().reset();
    useStreak.getState().reset();
    useRatings.getState().reset();
    useAchievements.getState().reset();
    useQuests.getState().reset();
    useCoach.getState().clear();
    events = [];
    unsub = onGamifyEvent((e) => events.push(e));
  });
  afterEach(() => {
    unsub();
    setClock(null);
  });

  const coachXpEvents = () => events.filter((e) => e.kind === 'xp-awarded' && e.source === 'coach');

  it('a solved training attempt pays the solve bonus as a passive coach grant', () => {
    attempt('hangingPieces', true);
    expect(useGamify.getState().xp).toBe(XP_AWARDS.coachSolveBonus + 15); // + coach-train-1 badge XP
    expect(coachXpEvents()).toHaveLength(1);
    // Passive: the streak is ticked by the base puzzle pipeline, not the bonus.
    expect(useStreak.getState().count).toBe(0);
    expect(useGamify.getState().todayActivities()).toBe(0);
  });

  it('a failed attempt pays no bonus but still counts toward the trained badges', () => {
    attempt('hangingPieces', false);
    expect(coachXpEvents()).toHaveLength(0);
    expect(useAchievements.getState().unlocked['coach-train-1']).toBeDefined();
    expect(events.some((e) => e.kind === 'achievement-unlocked' && e.id === 'coach-train-1')).toBe(true);
  });

  it('crossing the cleared bar pays the clear bonus once and unlocks coach-clear-1', () => {
    // 9 solved attempts: below the 10-attempt minimum, nothing cleared yet.
    for (let i = 0; i < WEAKNESS_CLEARED_MIN_ATTEMPTS - 1; i++) attempt('missedForks', true);
    expect(useAchievements.getState().unlocked['coach-clear-1']).toBeUndefined();
    const before = useGamify.getState().xp;

    // The 10th solved attempt crosses (10/10 of the last 10 solved).
    attempt('missedForks', true);
    const gained = useGamify.getState().xp - before;
    expect(gained).toBe(XP_AWARDS.coachSolveBonus + XP_AWARDS.coachWeaknessCleared + 50); // + coach-clear-1 badge XP
    expect(useAchievements.getState().unlocked['coach-clear-1']).toBeDefined();

    // Already cleared: the next solve pays only the solve bonus, no re-clear.
    const before2 = useGamify.getState().xp;
    attempt('missedForks', true);
    expect(useGamify.getState().xp - before2).toBe(XP_AWARDS.coachSolveBonus);
  });

  it('a genuine regression then recovery re-pays the clear bonus exactly once', () => {
    for (let i = 0; i < 10; i++) attempt('missedMates', true); // cleared
    // Regress: 3 fails pull the last-10 rate to 0.7 (< 0.8).
    for (let i = 0; i < 3; i++) attempt('missedMates', false);
    const before = useGamify.getState().xp;
    // Recover well past the bar: exactly ONE re-clear across all 12 solves.
    for (let i = 0; i < 12; i++) attempt('missedMates', true);
    const gained = useGamify.getState().xp - before;
    expect(gained).toBe(12 * XP_AWARDS.coachSolveBonus + XP_AWARDS.coachWeaknessCleared);
  });

  it('recordCoachSession pays the scaled bonus, capped, and ignores empty sessions', () => {
    recordCoachSession({ solved: 2, attempts: 3 });
    expect(useGamify.getState().xp).toBe(XP_AWARDS.coachSessionBase + 2 * XP_AWARDS.coachSessionPerSolve);

    useGamify.getState().reset();
    recordCoachSession({ solved: 50, attempts: 60 });
    expect(useGamify.getState().xp).toBe(XP_AWARDS.coachSessionCap);

    useGamify.getState().reset();
    recordCoachSession({ solved: 0, attempts: 0 });
    expect(useGamify.getState().xp).toBe(0);
  });

  it('the coachRewards adapter routes both event kinds into the wrappers', () => {
    attempt('endgameMistakes', true, true);
    expect(coachXpEvents()).toHaveLength(1);
    expect(useAchievements.getState().unlocked['coach-train-1']).toBeDefined();

    const before = useGamify.getState().xp;
    awardCoachReward({ kind: 'training-session', weakness: 'endgameMistakes', solved: 1, attempts: 1 });
    expect(useGamify.getState().xp - before).toBe(XP_AWARDS.coachSessionBase + XP_AWARDS.coachSessionPerSolve);
  });

  it('coach-train-50 counts attempts across kinds via the catalogue', () => {
    for (let i = 0; i < 25; i++) attempt('hangingPieces', i % 2 === 0);
    expect(useAchievements.getState().unlocked['coach-train-50']).toBeUndefined();
    for (let i = 0; i < 25; i++) attempt('missedTactics', i % 3 === 0);
    expect(useAchievements.getState().unlocked['coach-train-50']).toBeDefined();
  });
});
