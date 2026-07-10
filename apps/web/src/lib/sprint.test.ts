import { describe, expect, it } from 'vitest';
import type { Puzzle } from '../trainers/tactics';
import { puzzleRatingOf } from './puzzleRating';
import {
  RUSH_MAX_STRIKES,
  STORM_BASE_POINTS,
  STORM_FAST_BONUS,
  STORM_MAX_TARGET,
  STORM_MIN_TARGET,
  formatClock,
  initialRush,
  initialStorm,
  mulberry32,
  pickSprintPuzzle,
  rushEnd,
  rushMiss,
  rushSolve,
  rushTargetRating,
  stormEnd,
  stormMiss,
  stormMultiplier,
  stormSolve,
} from './sprint';

const puzzle = (id: string, rating: number): Puzzle => ({
  id,
  fen: '8/8/8/8/8/8/8/8 w - - 0 1',
  solution: ['a1a2'],
  theme: 'test',
  difficulty: 'easy',
  turn: 'white',
  rating,
});

describe('mulberry32', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a1 = mulberry32(42);
    const a2 = mulberry32(42);
    const b = mulberry32(43);
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
  });

  it('emits values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('puzzle rush state machine', () => {
  it('counts solves and tracks the running streak and best streak', () => {
    let s = initialRush();
    s = rushSolve(s);
    s = rushSolve(s);
    expect(s.solved).toBe(2);
    expect(s.streak).toBe(2);
    s = rushMiss(s);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
    s = rushSolve(s);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(2);
    expect(s.over).toBe(false);
  });

  it(`ends the run after ${RUSH_MAX_STRIKES} strikes`, () => {
    let s = initialRush();
    s = rushSolve(s);
    s = rushMiss(s);
    expect(s.over).toBe(false);
    s = rushMiss(s);
    expect(s.over).toBe(false);
    s = rushMiss(s);
    expect(s.over).toBe(true);
    expect(s.endReason).toBe('strikes');
    expect(s.strikes).toBe(RUSH_MAX_STRIKES);
    expect(s.solved).toBe(1);
  });

  it('ignores events after the run is over', () => {
    let s = initialRush();
    s = rushMiss(rushMiss(rushMiss(s)));
    expect(s.over).toBe(true);
    expect(rushSolve(s)).toEqual(s);
    expect(rushMiss(s)).toEqual(s);
    expect(rushEnd(s, 'quit')).toEqual(s);
  });

  it('records time / quit endings', () => {
    expect(rushEnd(initialRush(), 'time').endReason).toBe('time');
    expect(rushEnd(initialRush(), 'quit').endReason).toBe('quit');
  });

  it('escalates the target rating with every solve, capped at 2600', () => {
    expect(rushTargetRating(0)).toBe(600);
    expect(rushTargetRating(1)).toBe(645);
    expect(rushTargetRating(10)).toBe(1050);
    expect(rushTargetRating(20)).toBeGreaterThan(rushTargetRating(10));
    expect(rushTargetRating(1000)).toBe(2600);
  });
});

describe('puzzle storm scoring & combo', () => {
  it('multiplier tiers step at 5 / 10 / 15 consecutive solves', () => {
    expect(stormMultiplier(0)).toBe(1);
    expect(stormMultiplier(4)).toBe(1);
    expect(stormMultiplier(5)).toBe(1.5);
    expect(stormMultiplier(9)).toBe(1.5);
    expect(stormMultiplier(10)).toBe(2);
    expect(stormMultiplier(14)).toBe(2);
    expect(stormMultiplier(15)).toBe(3);
    expect(stormMultiplier(50)).toBe(3);
  });

  it('pays base points, multiplies by the combo tier, and adds the speed bonus', () => {
    let s = initialStorm(1200);
    // slow solve: base only
    let r = stormSolve(s, 20_000);
    expect(r.points).toBe(STORM_BASE_POINTS);
    expect(r.multiplier).toBe(1);
    s = r.state;
    // fast solve: base + speed bonus
    r = stormSolve(s, 2_000);
    expect(r.points).toBe(STORM_BASE_POINTS + STORM_FAST_BONUS);
    s = r.state;
    // reach a 5-combo: multiplier kicks in on the 5th consecutive solve
    r = stormSolve(s, 20_000); // 3
    r = stormSolve(r.state, 20_000); // 4
    r = stormSolve(r.state, 20_000); // 5
    expect(r.state.combo).toBe(5);
    expect(r.multiplier).toBe(1.5);
    expect(r.points).toBe(Math.round(STORM_BASE_POINTS * 1.5));
    expect(r.state.score).toBe(10 + 15 + 10 + 10 + 15);
  });

  it('a miss resets the combo but keeps score and bestCombo', () => {
    let s = initialStorm(1200);
    for (let i = 0; i < 6; i++) s = stormSolve(s, 20_000).state;
    expect(s.combo).toBe(6);
    const before = s.score;
    s = stormMiss(s);
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(6);
    expect(s.missed).toBe(1);
    expect(s.score).toBe(before);
    // rebuilding starts from ×1 again
    const r = stormSolve(s, 20_000);
    expect(r.multiplier).toBe(1);
  });

  it('adapts the difficulty target to pace: up on solves, down on misses, clamped', () => {
    let s = initialStorm(1200);
    expect(s.target).toBe(1000); // opens 200 below the player
    const t0 = s.target;
    s = stormSolve(s, 2_000).state; // fast → biggest step up
    const fastStep = s.target - t0;
    let s2 = initialStorm(1200);
    s2 = stormSolve(s2, 8_000).state; // normal
    const normalStep = s2.target - t0;
    let s3 = initialStorm(1200);
    s3 = stormSolve(s3, 30_000).state; // slow
    const slowStep = s3.target - t0;
    expect(fastStep).toBeGreaterThan(normalStep);
    expect(normalStep).toBeGreaterThan(slowStep);
    expect(slowStep).toBeGreaterThan(0);

    const missed = stormMiss(s);
    expect(missed.target).toBeLessThan(s.target);

    // clamping at both ends
    let low = initialStorm(0);
    expect(low.target).toBe(STORM_MIN_TARGET);
    for (let i = 0; i < 50; i++) low = stormMiss(low);
    expect(low.target).toBe(STORM_MIN_TARGET);
    let high = initialStorm(4000);
    for (let i = 0; i < 200; i++) high = stormSolve(high, 1_000).state;
    expect(high.target).toBe(STORM_MAX_TARGET);
  });

  it('ignores events after the run is over', () => {
    const s = stormEnd(initialStorm(1200), 'time');
    expect(s.over).toBe(true);
    expect(stormSolve(s, 1000).state).toEqual(s);
    expect(stormSolve(s, 1000).points).toBe(0);
    expect(stormMiss(s)).toEqual(s);
  });
});

describe('pickSprintPuzzle (deterministic selection)', () => {
  const pool = [
    puzzle('a', 600),
    puzzle('b', 650),
    puzzle('c', 700),
    puzzle('d', 1500),
    puzzle('e', 1550),
    puzzle('f', 2400),
  ];

  it('replays identically for the same seed and pool', () => {
    const run = () => {
      const rand = mulberry32(123);
      const used = new Set<string>();
      const ids: string[] = [];
      for (let i = 0; i < pool.length; i++) {
        const p = pickSprintPuzzle(pool, 600 + i * 300, used, rand);
        ids.push(p!.id);
        used.add(p!.id);
      }
      return ids;
    };
    expect(run()).toEqual(run());
  });

  it('picks within the tightest rating window that has candidates', () => {
    const rand = mulberry32(1);
    const p = pickSprintPuzzle(pool, 1520, new Set(), rand);
    expect(['d', 'e']).toContain(p!.id); // both within ±150 of 1520
  });

  it('skips already-served ids, then recycles once everything is used', () => {
    const rand = mulberry32(9);
    const used = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const p = pickSprintPuzzle(pool, 700, used, rand);
      expect(p).not.toBeNull();
      expect(used.has(p!.id)).toBe(false);
      used.add(p!.id);
    }
    expect(used.size).toBe(pool.length);
    // pool exhausted → recycles rather than returning null
    const recycled = pickSprintPuzzle(pool, 700, used, rand);
    expect(recycled).not.toBeNull();
  });

  it('widens the window when nothing is near the target', () => {
    const farPool = [puzzle('far', 2400)];
    const p = pickSprintPuzzle(farPool, 600, new Set(), mulberry32(5));
    expect(p!.id).toBe('far');
  });

  it('returns null only for an empty pool', () => {
    expect(pickSprintPuzzle([], 1200, new Set(), mulberry32(1))).toBeNull();
  });

  it('respects explicit puzzle ratings via puzzleRatingOf', () => {
    // sanity: the helper the picker filters by prefers the explicit rating
    expect(puzzleRatingOf(puzzle('x', 1234))).toBe(1234);
  });
});

describe('formatClock', () => {
  it('formats ms as m:ss, ceiling seconds, flooring at 0:00', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(59_400)).toBe('1:00'); // ceil to the next visible second
    expect(formatClock(1_000)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-500)).toBe('0:00');
  });
});
