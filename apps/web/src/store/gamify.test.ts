import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import { levelFromXp, levelProgress, useGamify, xpToReachLevel } from './gamify';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC
const pinDay = (offsetDays: number) => setClock(() => T0 + offsetDays * DAY);

describe('level curve', () => {
  it('xpToReachLevel follows BASE 60 + STEP 40 (cost of level L→L+1 is 60 + 40·(L−1) more each level)', () => {
    expect(xpToReachLevel(1)).toBe(0);
    expect(xpToReachLevel(2)).toBe(100); // 60 + 40
    expect(xpToReachLevel(3)).toBe(240); // +140
    expect(xpToReachLevel(4)).toBe(420); // +180
    // Closed form: (L−1)·60 + 40·(L−1)·L/2
    for (let l = 1; l <= 30; l++) {
      const n = l - 1;
      expect(xpToReachLevel(l)).toBe(n * 60 + (40 * n * (n + 1)) / 2);
    }
  });

  it('levelFromXp is exact at the boundaries', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(239)).toBe(2);
    expect(levelFromXp(240)).toBe(3);
    expect(levelFromXp(xpToReachLevel(10))).toBe(10);
    expect(levelFromXp(xpToReachLevel(10) - 1)).toBe(9);
  });

  it('levelProgress reports XP into the level and to the next', () => {
    const p = levelProgress(150); // level 2 spans 100..240
    expect(p.level).toBe(2);
    expect(p.intoLevel).toBe(50);
    expect(p.span).toBe(140);
    expect(p.toNext).toBe(90);
    expect(p.pct).toBe(Math.round((50 / 140) * 100));
  });
});

describe('gamify store award() (clock-injected)', () => {
  beforeEach(() => {
    useGamify.getState().reset();
    pinDay(0);
  });
  afterEach(() => setClock(null));

  it('crossing a level boundary reports leveledUp exactly once', () => {
    const a = useGamify.getState().award(99);
    expect(a.leveledUp).toBe(false);
    const b = useGamify.getState().award(1); // total 100 → level 2
    expect(b.leveledUp).toBe(true);
    expect(b.level).toBe(2);
    const c = useGamify.getState().award(1);
    expect(c.leveledUp).toBe(false);
  });

  it('day logs roll over with the injected clock and the daily-goal streak follows', () => {
    useGamify.getState().setGoalXp(20);
    useGamify.getState().award(25);
    expect(useGamify.getState().todayXp()).toBe(25);
    expect(useGamify.getState().goalMetToday()).toBe(true);
    expect(useGamify.getState().streak).toBe(1);

    pinDay(1); // next day: today's XP resets, streak continues on goal
    expect(useGamify.getState().todayXp()).toBe(0);
    const r = useGamify.getState().award(20);
    expect(r.goalJustMet).toBe(true);
    expect(r.streak).toBe(2);

    pinDay(3); // skipped a day → goal streak restarts at 1
    const r2 = useGamify.getState().award(20);
    expect(r2.streak).toBe(1);
    expect(useGamify.getState().bestStreak).toBe(2);
  });
});
