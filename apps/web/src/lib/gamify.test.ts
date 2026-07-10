import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { setClock } from './clock';
import { awardXP, onGamifyEvent, recordPuzzle, type GamifyEvent } from './gamify';
import { useGamify, xpToReachLevel } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useRatings } from '../store/ratings';
import { useAchievements } from '../store/achievements';
import { useQuests } from '../store/quests';

const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

describe('gamify public API hardening', () => {
  let events: GamifyEvent[];
  let unsub: () => void;
  let consoleError: MockInstance;

  beforeEach(() => {
    setClock(() => T0);
    useGamify.getState().reset();
    useStreak.getState().reset();
    useRatings.getState().reset();
    useAchievements.getState().reset();
    useQuests.getState().reset();
    events = [];
    unsub = onGamifyEvent((e) => events.push(e));
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    unsub();
    setClock(null);
    consoleError.mockRestore();
  });

  it('awardXP rejects NaN/Infinity/negative amounts as a no-op (no corruption, no events)', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5]) {
      const res = awardXP('coach', bad);
      expect(res.xpGained).toBe(0);
      expect(res.leveledUp).toBe(false);
    }
    expect(useGamify.getState().xp).toBe(0);
    expect(useStreak.getState().count).toBe(0); // not even a streak tick
    expect(events).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();

    // …and a valid award still works afterwards.
    awardXP('coach', 10);
    expect(useGamify.getState().xp).toBe(10);
  });

  it('a throwing listener is isolated: later listeners and the record pipeline still run', () => {
    const late: GamifyEvent[] = [];
    const unsubThrow = onGamifyEvent(() => {
      throw new Error('boom');
    });
    const unsubLate = onGamifyEvent((e) => late.push(e));
    try {
      recordPuzzle(1200, true);
    } finally {
      unsubThrow();
      unsubLate();
    }
    // The award completed: XP granted, streak ticked, quests/achievements advanced.
    expect(useGamify.getState().xp).toBeGreaterThan(0);
    expect(useStreak.getState().count).toBe(1);
    expect(useRatings.getState().categories.puzzles.played).toBe(1);
    expect(late.some((e) => e.kind === 'xp-awarded')).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('[gamify] onGamifyEvent listener threw', expect.any(Error));
  });

  it('a listener that calls awardXP from xp-awarded is cut off instead of blowing the stack', () => {
    const unsubRecurse = onGamifyEvent((e) => {
      if (e.kind === 'xp-awarded') awardXP('other', 1, { countsAsActivity: false });
    });
    try {
      expect(() => awardXP('other', 1, { countsAsActivity: false })).not.toThrow();
    } finally {
      unsubRecurse();
    }
    expect(consoleError.mock.calls.some((c) => String(c[0]).includes('listener cycle'))).toBe(true);
    expect(Number.isFinite(useGamify.getState().xp)).toBe(true);
  });

  it('level-gated badges unlock when a bare awardXP crosses the level, matching the toast', () => {
    awardXP('coach', xpToReachLevel(5)); // straight to level 5 without any record* call
    const unlockEvents = events.filter((e) => e.kind === 'achievement-unlocked').map((e) => (e.kind === 'achievement-unlocked' ? e.id : ''));
    expect(events.some((e) => e.kind === 'level-up' && e.level >= 5)).toBe(true);
    expect(useAchievements.getState().unlocked['dedication-level-5']).toBeDefined();
    expect(unlockEvents).toContain('dedication-level-5');
  });

  it('a first solved puzzle at a provisional rating does not unlock the 1600 rating badge', () => {
    recordPuzzle(2120, true); // the hard daily puzzle, day one
    expect(useAchievements.getState().unlocked['rating-puzzles-1600']).toBeUndefined();
  });
});
