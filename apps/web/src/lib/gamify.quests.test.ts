import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from './clock';
import {
  onGamifyEvent,
  recordGameResult,
  recordLesson,
  recordPuzzle,
  recordReview,
  recordRush,
  type GamifyEvent,
} from './gamify';
import { ALL_QUESTS_BONUS_XP, type QuestGroup } from './quests';
import { useQuests } from '../store/quests';
import { useGamify } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useRatings } from '../store/ratings';
import { useAchievements } from '../store/achievements';

const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

/** Drive the real record* wrapper matching a quest group. */
function act(group: QuestGroup): void {
  switch (group) {
    case 'puzzle':
      recordPuzzle(1200, true);
      break;
    case 'game':
      recordGameResult({ opponentRating: 1200, outcome: 'win', timed: false });
      break;
    case 'lesson':
      recordLesson({ firstTime: true, stars: 3 });
      break;
    case 'review':
      recordReview(true);
      break;
    case 'rush':
      recordRush(50);
      break;
  }
}

describe('daily quests through the gamify pipeline (clock-injected)', () => {
  let events: GamifyEvent[];
  let unsub: () => void;

  beforeEach(() => {
    setClock(() => T0);
    useGamify.getState().reset();
    useStreak.getState().reset();
    useRatings.getState().reset();
    useAchievements.getState().reset();
    useQuests.getState().reset();
    events = [];
    unsub = onGamifyEvent((e) => events.push(e));
  });
  afterEach(() => {
    unsub();
    setClock(null);
  });

  it('record* activity completes quests, pays reward XP, and fires the all-done bonus once', () => {
    useQuests.getState().rollover();
    const slate = useQuests.getState().todaysQuests();

    for (const q of slate) {
      // 'max' quests are satisfied by one strong run; 'sum' ones need target reps.
      const reps = q.mode === 'max' ? 1 : q.target;
      for (let i = 0; i < reps; i++) act(q.group);
    }

    const completes = events.filter((e) => e.kind === 'quest-complete');
    expect(new Set(completes.map((e) => (e.kind === 'quest-complete' ? e.id : ''))).size).toBe(slate.length);

    const allDone = events.filter((e) => e.kind === 'quests-all-done');
    expect(allDone).toHaveLength(1);

    // Every quest's reward XP (and the slate bonus) flowed through awardXP('quest').
    const questXp = events
      .filter((e): e is Extract<GamifyEvent, { kind: 'xp-awarded' }> => e.kind === 'xp-awarded' && e.source === 'quest')
      .map((e) => e.amount);
    for (const q of slate) expect(questXp).toContain(q.xp);
    expect(questXp).toContain(ALL_QUESTS_BONUS_XP);

    // Quest achievements re-evaluated in the same pass.
    const unlocked = useAchievements.getState().unlocked;
    expect(unlocked['quests-first']).toBeDefined();
    expect(unlocked['quests-clean-1']).toBeDefined();

    // Reward XP is passive: the streak reflects the activity day only, not extra ticks.
    expect(useStreak.getState().current()).toBe(1);
  });

  it('quest reward XP does not tick the activity counter (passive grants)', () => {
    useQuests.getState().rollover();
    const before = useGamify.getState().todayActivities();
    recordReview(true); // one real activity, possibly with quest progress attached
    // Exactly one activity was recorded no matter what quest XP it triggered.
    expect(useGamify.getState().todayActivities()).toBe(before + 1);
  });

  it('three straight wins unlock the win-streak badge via bestWinStreak', () => {
    for (let i = 0; i < 3; i++) recordGameResult({ opponentRating: 1200, outcome: 'win', timed: false });
    expect(useRatings.getState().categories.bots.bestWinStreak).toBe(3);
    expect(useAchievements.getState().unlocked['play-winstreak-3']).toBeDefined();

    // A loss resets the running streak but the best survives.
    recordGameResult({ opponentRating: 1200, outcome: 'loss', timed: false });
    expect(useRatings.getState().categories.bots.winStreak).toBe(0);
    expect(useRatings.getState().categories.bots.bestWinStreak).toBe(3);
  });
});
