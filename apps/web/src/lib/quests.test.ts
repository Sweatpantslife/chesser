import { describe, expect, it } from 'vitest';
import {
  DAILY_QUEST_COUNT,
  QUEST_CATALOGUE,
  questsForDay,
  questValueAfter,
  type Activity,
} from './quests';

const day = (offset: number): string => {
  const d = new Date(Date.UTC(2026, 6, 1) + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};

describe('quest catalogue', () => {
  it('ids are unique and every quest has a positive target and xp', () => {
    const ids = new Set(QUEST_CATALOGUE.map((q) => q.id));
    expect(ids.size).toBe(QUEST_CATALOGUE.length);
    for (const q of QUEST_CATALOGUE) {
      expect(q.target).toBeGreaterThan(0);
      expect(q.xp).toBeGreaterThan(0);
    }
  });
});

describe('questsForDay rotation (deterministic, seeded only by the date string)', () => {
  it('same date → the exact same slate', () => {
    for (let i = 0; i < 10; i++) {
      const a = questsForDay(day(i)).map((q) => q.id);
      const b = questsForDay(day(i)).map((q) => q.id);
      expect(a).toEqual(b);
    }
  });

  it('every slate has DAILY_QUEST_COUNT quests from distinct groups', () => {
    for (let i = 0; i < 120; i++) {
      const slate = questsForDay(day(i));
      expect(slate).toHaveLength(DAILY_QUEST_COUNT);
      expect(new Set(slate.map((q) => q.group)).size).toBe(DAILY_QUEST_COUNT);
      expect(new Set(slate.map((q) => q.id)).size).toBe(DAILY_QUEST_COUNT);
    }
  });

  it('different dates rotate the slate', () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 30; i++) {
      signatures.add(
        questsForDay(day(i))
          .map((q) => q.id)
          .sort()
          .join('|'),
      );
    }
    // 30 consecutive days must not serve one fixed slate.
    expect(signatures.size).toBeGreaterThan(5);
  });

  it('every catalogue quest shows up within a year', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 365; i++) for (const q of questsForDay(day(i))) seen.add(q.id);
    expect(seen.size).toBe(QUEST_CATALOGUE.length);
  });
});

describe('questValueAfter', () => {
  const solve: Activity = { type: 'puzzle', success: true };
  const fail: Activity = { type: 'puzzle', success: false };
  const rush = (score: number): Activity => ({ type: 'rush', score });

  it('sum quests accumulate matching activities and ignore the rest', () => {
    const q = QUEST_CATALOGUE.find((x) => x.id === 'quest-puzzles-3')!;
    let v = 0;
    v = questValueAfter(q, v, solve);
    v = questValueAfter(q, v, fail); // failed solve contributes nothing
    v = questValueAfter(q, v, { type: 'lesson', firstTime: true }); // wrong type
    v = questValueAfter(q, v, solve);
    expect(v).toBe(2);
  });

  it('max quests keep the best single value', () => {
    const q = QUEST_CATALOGUE.find((x) => x.id === 'quest-rush-10')!;
    let v = 0;
    v = questValueAfter(q, v, rush(4));
    v = questValueAfter(q, v, rush(12));
    v = questValueAfter(q, v, rush(7)); // worse run doesn't regress
    expect(v).toBe(12);
  });
});
