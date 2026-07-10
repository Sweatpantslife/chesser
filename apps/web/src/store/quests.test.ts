import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { type Activity, type QuestDef } from '../lib/quests';
import { useQuests } from './quests';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC
const pinDay = (offsetDays: number) => setClock(() => T0 + offsetDays * DAY);

/** Activities that fully satisfy `q`, whatever its group/mode. */
function satisfy(q: QuestDef): Activity[] {
  const n = q.mode === 'max' ? 1 : q.target;
  const one = (): Activity => {
    switch (q.group) {
      case 'puzzle':
        return { type: 'puzzle', success: true };
      case 'game':
        return { type: 'game', outcome: 'win' };
      case 'lesson':
        return { type: 'lesson', firstTime: true };
      case 'review':
        return { type: 'review', correct: true };
      case 'rush':
        return { type: 'rush', score: Math.max(q.target, 50) };
    }
  };
  return Array.from({ length: n }, one);
}

describe('quests store (clock-injected)', () => {
  beforeEach(() => {
    useQuests.getState().reset();
    pinDay(0);
  });
  afterEach(() => setClock(null));

  it('applyActivity advances the matching quest and completes it exactly once', () => {
    useQuests.getState().rollover();
    const slate = useQuests.getState().todaysQuests();
    const q = slate[0]!;
    let completions = 0;
    for (const a of satisfy(q)) {
      completions += useQuests.getState().applyActivity(a).completed.filter((c) => c.id === q.id).length;
    }
    expect(completions).toBe(1);
    expect(useQuests.getState().done[q.id]).toBeTypeOf('number');
    // Groups are distinct within a slate, so only this quest completed.
    expect(useQuests.getState().totalCompleted).toBe(1);

    // Further matching activity neither re-completes nor regresses it.
    const again = useQuests.getState().applyActivity(satisfy(q)[0]!);
    expect(again.completed).toHaveLength(0);
    expect(useQuests.getState().totalCompleted).toBe(1);
  });

  it('finishing the whole slate reports allDone exactly once and bumps lifetime counters', () => {
    useQuests.getState().rollover();
    const slate = useQuests.getState().todaysQuests();
    let allDoneCount = 0;
    for (const q of slate) {
      for (const a of satisfy(q)) {
        if (useQuests.getState().applyActivity(a).allDone) allDoneCount++;
      }
    }
    expect(allDoneCount).toBe(1);
    const s = useQuests.getState();
    expect(s.bonusPaid).toBe(true);
    expect(s.totalCompleted).toBe(slate.length);
    expect(s.daysAllDone).toBe(1);
    // Extra activity after the sweep never re-reports allDone.
    expect(useQuests.getState().applyActivity({ type: 'review', correct: true }).allDone).toBe(false);
    expect(useQuests.getState().daysAllDone).toBe(1);
  });

  it('rolls the slate on a new day but keeps lifetime totals', () => {
    useQuests.getState().rollover();
    const day0 = useQuests.getState().day;
    const q = useQuests.getState().todaysQuests()[0]!;
    for (const a of satisfy(q)) useQuests.getState().applyActivity(a);
    expect(useQuests.getState().totalCompleted).toBe(1);

    pinDay(1);
    // applyActivity self-rolls — no explicit rollover() needed.
    useQuests.getState().applyActivity({ type: 'review', correct: true });
    const s = useQuests.getState();
    expect(s.day).not.toBe(day0);
    expect(Object.keys(s.done)).toHaveLength(0);
    expect(s.bonusPaid).toBe(false);
    expect(s.totalCompleted).toBe(1); // lifetime counter survived
  });

  it('same-day slates are deterministic across resets (same date → same quests)', () => {
    useQuests.getState().rollover();
    const a = useQuests.getState().todaysQuests().map((q) => q.id);
    useQuests.getState().reset();
    useQuests.getState().rollover();
    const b = useQuests.getState().todaysQuests().map((q) => q.id);
    expect(a).toEqual(b);
  });

  it('importMerge unions same-day progress and lets a later remote day win', () => {
    useQuests.getState().rollover();
    const day0 = useQuests.getState().day;
    const slate = useQuests.getState().todaysQuests();
    const [q1, q2] = [slate[0]!, slate[1]!];
    useQuests.getState().applyActivity(satisfy(q1)[0]!); // partial local progress

    // Same-day remote: per-quest max progress, done union, totals max.
    useQuests.getState().importMerge({
      day: day0,
      progress: { [q2.id]: q2.target },
      done: { [q2.id]: 123 },
      bonusPaid: false,
      totalCompleted: 5,
      daysAllDone: 2,
    });
    let s = useQuests.getState();
    expect(s.done[q2.id]).toBe(123);
    expect(s.progress[q2.id]).toBe(q2.target);
    expect(s.totalCompleted).toBe(5);
    expect(s.daysAllDone).toBe(2);

    // Remote already on a later day: its slate state wins wholesale.
    const later = new Date(T0 + 3 * DAY).toISOString().slice(0, 10);
    useQuests.getState().importMerge({
      day: later,
      progress: { 'quest-lesson': 1 },
      done: { 'quest-lesson': 456 },
      bonusPaid: false,
      totalCompleted: 6,
      daysAllDone: 2,
    });
    s = useQuests.getState();
    expect(s.day).toBe(later);
    expect(s.progress).toEqual({ 'quest-lesson': 1 });
    expect(s.done).toEqual({ 'quest-lesson': 456 });
    expect(s.totalCompleted).toBe(6);

    // Junk never throws or corrupts.
    useQuests.getState().importMerge(null);
    useQuests.getState().importMerge({ day: 42, progress: 'nope', totalCompleted: 'many' });
    expect(useQuests.getState().day).toBe(later);
  });
});
