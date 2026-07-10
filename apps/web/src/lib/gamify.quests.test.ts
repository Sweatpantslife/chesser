import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock, todayStr } from './clock';
import {
  onGamifyEvent,
  recordGameResult,
  recordLesson,
  recordPuzzle,
  recordReview,
  recordRush,
  recordStorm,
  type GamifyEvent,
} from './gamify';
import { ALL_QUESTS_BONUS_XP, questsForDay, type QuestGroup } from './quests';
import { useQuests } from '../store/quests';
import { useGamify } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useRatings } from '../store/ratings';
import { useAchievements } from '../store/achievements';
import { useSprints } from '../store/sprints';

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
    case 'storm':
      recordStorm({ solved: 20, score: 300 });
      break;
  }
}

/** Pin the clock to the first day (from T0) whose slate has a `group` quest. */
function pinDayWithGroup(group: QuestGroup): void {
  for (let off = 0; off < 400; off++) {
    setClock(() => T0 + off * 86_400_000);
    if (questsForDay(todayStr()).some((q) => q.group === group)) return;
  }
  throw new Error(`no day within 400 of T0 has a '${group}' quest`);
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
    useSprints.getState().reset();
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

  it('a storm run does not advance rush quests', () => {
    pinDayWithGroup('rush');
    useQuests.getState().rollover();
    const rushQuests = useQuests.getState().todaysQuests().filter((q) => q.group === 'rush');
    expect(rushQuests.length).toBeGreaterThan(0);

    recordStorm({ solved: 25, score: 400 }); // a monster run, but it's Storm

    const s = useQuests.getState();
    for (const q of rushQuests) {
      expect(s.progress[q.id] ?? 0).toBe(0);
      expect(q.id in s.done).toBe(false);
    }
    // The run itself still paid XP, tagged with its own source.
    const stormXp = events.filter((e) => e.kind === 'xp-awarded' && e.source === 'storm');
    expect(stormXp).toHaveLength(1);
  });

  it('storm quests advance on recordStorm, not on recordRush', () => {
    pinDayWithGroup('storm');
    useQuests.getState().rollover();
    const stormQuests = useQuests.getState().todaysQuests().filter((q) => q.group === 'storm');
    expect(stormQuests.length).toBeGreaterThan(0);

    recordRush(50); // a huge Rush run contributes nothing to storm quests
    for (const q of stormQuests) {
      expect(useQuests.getState().progress[q.id] ?? 0).toBe(0);
    }

    recordStorm({ solved: 12, score: 150 }); // satisfies both storm quests' targets
    const s = useQuests.getState();
    for (const q of stormQuests) {
      expect(q.id in s.done).toBe(true);
    }
    const completes = events.filter((e) => e.kind === 'quest-complete').map((e) => (e.kind === 'quest-complete' ? e.id : ''));
    for (const q of stormQuests) expect(completes).toContain(q.id);
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
