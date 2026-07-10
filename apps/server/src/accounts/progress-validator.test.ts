import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProgress, LIMITS } from './progress-validator.js';

// ---------------------------------------------------------------------------
// Fixtures — a plausible account snapshot and helpers to mutate it.
// All day keys are derived from a pinned "now" so the tests are deterministic.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00:00Z
const day = (offset: number): string => new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10);

interface CatShape {
  elo: number;
  eloPeak: number;
  glicko: { rating: number; rd: number; vol: number };
  glickoPeak: number;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  winStreak: number;
  bestWinStreak: number;
  history: Record<string, { elo: number; glicko: number }>;
}

function cat(over: Partial<CatShape> = {}): CatShape {
  return {
    elo: 1500,
    eloPeak: 1500,
    glicko: { rating: 1500, rd: 350, vol: 0.06 },
    glickoPeak: 1500,
    played: 0,
    won: 0,
    lost: 0,
    drawn: 0,
    winStreak: 0,
    bestWinStreak: 0,
    history: {},
    ...over,
  };
}

/** 5 active days ending 5 days ago, 200 XP each. */
function storedDays(): Record<string, { xp: number; activities: number }> {
  const days: Record<string, { xp: number; activities: number }> = {};
  for (let i = 9; i >= 5; i--) days[day(-i)] = { xp: 200, activities: 10 };
  return days;
}

function storedPuzzleHistory(): Record<string, { elo: number; glicko: number }> {
  const h: Record<string, { elo: number; glicko: number }> = {};
  for (let i = 9; i >= 5; i--) h[day(-i)] = { elo: 1380 + (9 - i) * 5, glicko: 1400 + (9 - i) * 5 };
  return h;
}

/** The account as the server last stored it: 100 puzzles, 1000 XP, 3-day streak. */
function storedSnapshot() {
  return {
    ratings: {
      legacyMigrated: true,
      categories: {
        bots: cat(),
        blitz: cat(),
        puzzles: cat({
          elo: 1400,
          eloPeak: 1450,
          glicko: { rating: 1420, rd: 90, vol: 0.06 },
          glickoPeak: 1430,
          played: 100,
          won: 60,
          lost: 40,
          history: storedPuzzleHistory(),
        }),
      },
    },
    gamify: { xp: 1000, days: storedDays(), goalXp: 40, streak: 2, bestStreak: 3, lastGoalDay: day(-5), goalsMet: 5 },
    streak: { count: 3, best: 5, lastDay: day(-5), freezes: 1, milestonesAwarded: [3] },
    quests: { day: day(-5), progress: {}, done: {}, bonusPaid: false, totalCompleted: 10, daysAllDone: 2 },
    achievements: { unlocked: { 'tactics-solve-50': NOW - 10 * 86_400_000 } },
    ladder: { defeated: { 'bot-1': NOW - 20 * 86_400_000 } },
    lessons: { completed: { 'basics-1': { stars: 3 } } },
  };
}

/**
 * A realistic offline batch: the device was offline for the last 3 days and
 * now syncs 120 new puzzles (+120 Elo), 1100 new XP over 3 day logs, a streak
 * that grew to 6, and the badges those stats genuinely earn.
 */
function offlineBatch() {
  const s = storedSnapshot();
  const days = { ...s.gamify.days, [day(-2)]: { xp: 350, activities: 40 }, [day(-1)]: { xp: 400, activities: 45 }, [day(0)]: { xp: 350, activities: 35 } };
  return {
    ...s,
    ratings: {
      legacyMigrated: true,
      categories: {
        bots: cat(),
        blitz: cat(),
        puzzles: cat({
          elo: 1520,
          eloPeak: 1520,
          glicko: { rating: 1540, rd: 60, vol: 0.06 },
          glickoPeak: 1540,
          played: 220,
          won: 140,
          lost: 80,
          history: {
            ...storedPuzzleHistory(),
            [day(-2)]: { elo: 1460, glicko: 1470 },
            [day(-1)]: { elo: 1490, glicko: 1510 },
            [day(0)]: { elo: 1520, glicko: 1540 },
          },
        }),
      },
    },
    gamify: { xp: 2100, days, goalXp: 40, streak: 6, bestStreak: 6, lastGoalDay: day(0), goalsMet: 8 },
    streak: { count: 6, best: 6, lastDay: day(0), freezes: 2, milestonesAwarded: [3] },
    quests: { day: day(0), progress: { 'quest-puzzles-3': 3 }, done: { 'quest-puzzles-3': NOW }, bonusPaid: false, totalCompleted: 16, daysAllDone: 3 },
    achievements: {
      unlocked: {
        'tactics-solve-50': NOW - 10 * 86_400_000,
        'streak-streak-3': NOW - 86_400_000,
        'dedication-level-5': NOW - 86_400_000,
      } as Record<string, number>,
    },
  };
}

function expectOk(res: ReturnType<typeof validateProgress>): asserts res is Extract<ReturnType<typeof validateProgress>, { ok: true }> {
  assert.equal(res.ok, true, res.ok ? undefined : `expected acceptance, got: ${res.error}`);
}
function expectReject(res: ReturnType<typeof validateProgress>, re: RegExp): void {
  assert.equal(res.ok, false, 'expected rejection');
  if (!res.ok) assert.match(res.error, re);
}

const puzzlesOf = (data: unknown): CatShape =>
  (data as { ratings: { categories: { puzzles: CatShape } } }).ratings.categories.puzzles;

// ---------------------------------------------------------------------------
// Accepted payloads
// ---------------------------------------------------------------------------

describe('accepted payloads', () => {
  it('accepts a first sync of a plausible account (no stored baseline)', () => {
    const res = validateProgress(storedSnapshot(), null, NOW);
    expectOk(res);
    assert.deepEqual(res.adjustments, []);
    assert.equal(puzzlesOf(res.data).played, 100);
  });

  it('accepts a realistic offline batch sync against the stored baseline', () => {
    const res = validateProgress(offlineBatch(), storedSnapshot(), NOW);
    expectOk(res);
    assert.deepEqual(res.adjustments, []);
    const p = puzzlesOf(res.data);
    assert.equal(p.played, 220);
    assert.equal(p.elo, 1520);
    const streak = (res.data as { streak: { count: number } }).streak;
    assert.equal(streak.count, 6);
    const unlocked = (res.data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;
    assert.ok('streak-streak-3' in unlocked);
    assert.ok('dedication-level-5' in unlocked);
  });

  it('accepts null (clearing progress) and passes a legacy bare blob through', () => {
    const nullRes = validateProgress(null, storedSnapshot(), NOW);
    expectOk(nullRes);
    assert.equal(nullRes.data, null);

    const legacy = { cards: { 'e4:e5': { due: 1 } }, streak: 4 }; // pre-sections client blob
    const res = validateProgress(legacy, null, NOW);
    expectOk(res);
    assert.deepEqual(res.data, legacy);
  });

  it('keeps stored maxima when a stale device pushes older, lower counters', () => {
    const stale = storedSnapshot();
    stale.ratings.categories.puzzles.played = 50;
    stale.ratings.categories.puzzles.won = 30;
    stale.ratings.categories.puzzles.lost = 20;
    stale.ratings.categories.puzzles.elo = 1350;
    stale.gamify.xp = 600;
    const res = validateProgress(stale, storedSnapshot(), NOW);
    expectOk(res);
    const p = puzzlesOf(res.data);
    assert.equal(p.played, 100); // counters stay at the stored max
    assert.equal(p.elo, 1400); // more-played stored side owns the live rating
    assert.equal((res.data as { gamify: { xp: number } }).gamify.xp, 1000);
  });

  it('keeps an achievement backed by merged (stored) stats even if the pushing device is stale', () => {
    const stale = storedSnapshot();
    stale.ratings.categories.puzzles.played = 10;
    stale.ratings.categories.puzzles.won = 6;
    stale.ratings.categories.puzzles.lost = 4;
    // The stale device still claims the badge the account genuinely earned
    // (stored: 60 puzzles solved ≥ 50).
    const res = validateProgress(stale, storedSnapshot(), NOW);
    expectOk(res);
    const unlocked = (res.data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;
    assert.ok('tactics-solve-50' in unlocked);
  });
});

// ---------------------------------------------------------------------------
// Rejected payloads — impossible claims fail the whole PUT
// ---------------------------------------------------------------------------

describe('rejected payloads', () => {
  it('rejects an impossible rating jump (+900 Elo over 2 claimed games)', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.played = 102;
    cheat.ratings.categories.puzzles.won = 62;
    cheat.ratings.categories.puzzles.elo = 2300;
    cheat.ratings.categories.puzzles.eloPeak = 2300;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /rating jump/i);
  });

  it('rejects an impossible Glicko jump', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.played = 101;
    cheat.ratings.categories.puzzles.won = 61;
    cheat.ratings.categories.puzzles.glicko = { rating: 1820, rd: 60, vol: 0.06 }; // +400 in one game
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /glicko jump/i);
  });

  it('rejects a rating outside the absolute bounds', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.elo = 9999;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /outside the plausible range/i);
  });

  it('rejects an absurd XP total (hard cap)', () => {
    const cheat = storedSnapshot();
    cheat.gamify.xp = 1_000_000_000;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /implausibly large/i);
  });

  it('rejects an XP total not backed by the claimed day logs', () => {
    const cheat = storedSnapshot();
    cheat.gamify.xp = 50_000; // day logs only sum to 1000
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /not backed/i);
  });

  it('rejects a single day log above the per-day XP cap', () => {
    const cheat = storedSnapshot();
    cheat.gamify.days[day(-5)] = { xp: LIMITS.xpPerDay + 1, activities: 10 };
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /implausibly large/i);
  });

  it('rejects future-dated day logs', () => {
    const cheat = storedSnapshot();
    cheat.gamify.days[day(5)] = { xp: 100, activities: 5 };
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /future-dated/i);
  });

  it('allows a one-day-ahead day key (client local calendar vs server UTC)', () => {
    const ok = storedSnapshot();
    ok.gamify.days[day(1)] = { xp: 100, activities: 5 };
    ok.gamify.xp = 1100;
    expectOk(validateProgress(ok, storedSnapshot(), NOW));
  });

  it('rejects a streak longer than the claimed active days', () => {
    const cheat = storedSnapshot();
    cheat.streak = { count: 40, best: 40, lastDay: day(0), freezes: 1, milestonesAwarded: [3, 7, 30] };
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /exceeds the \d+ claimed active day/i);
  });

  it('rejects an implausible batch (2000 new games on one claimed day)', () => {
    const cheat = storedSnapshot();
    const p = cheat.ratings.categories.puzzles;
    p.played = 2100;
    p.won = 1200;
    p.lost = 900;
    p.history[day(0)] = { elo: 1400, glicko: 1420 };
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /more than the plausible/i);
  });

  it('rejects self-contradictory game stats (won+lost+drawn > played)', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.won = 90;
    cheat.ratings.categories.puzzles.lost = 40;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /exceed the .* played/i);
  });

  it('rejects a win streak longer than the games won', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.bestWinStreak = 61;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /win streak/i);
  });

  it('rejects malformed numbers instead of storing them', () => {
    const junk = storedSnapshot();
    (junk.gamify as { xp: unknown }).xp = 'lots';
    expectReject(validateProgress(junk, storedSnapshot(), NOW), /malformed/i);
  });

  it('rejects daily-goal claims beyond the days with activity', () => {
    const cheat = storedSnapshot();
    cheat.gamify.goalsMet = 50;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /daily goal/i);
  });

  it('rejects lifetime quest counts beyond the plausible per-day slate', () => {
    const cheat = storedSnapshot();
    cheat.quests.totalCompleted = 10_000;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /quest/i);
  });

  it('rejects non-object payloads', () => {
    expectReject(validateProgress('gimme xp', null, NOW), /must be an object/i);
  });
});

// ---------------------------------------------------------------------------
// Rating-peak plausibility — peaks must be backed by games everywhere
// ---------------------------------------------------------------------------

describe('rating-peak plausibility', () => {
  it('rejects a first-sync peak unreachable from the starting rating (no stored baseline)', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles = cat({ elo: 1200, eloPeak: 3600, played: 0, won: 0, lost: 0 });
    expectReject(validateProgress(cheat, null, NOW), /peak rating .* unreachable from the starting rating/i);
  });

  it('rejects a first-sync live rating unreachable from the starting rating', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles = cat({ elo: 3600, eloPeak: 3600, played: 0, won: 0, lost: 0 });
    expectReject(validateProgress(cheat, null, NOW), /unreachable from the starting rating/i);
  });

  it('rejects a first-sync Glicko peak unreachable with the claimed games', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles = cat({ elo: 1200, eloPeak: 1200, glickoPeak: 3600, played: 2, won: 1, lost: 1 });
    expectReject(validateProgress(cheat, null, NOW), /glicko peak .* unreachable/i);
  });

  it('clamps peaks claimed without new games instead of max-merging them in', () => {
    const cheat = storedSnapshot(); // same played count as stored (100)
    cheat.ratings.categories.puzzles.eloPeak = 3600;
    cheat.ratings.categories.puzzles.glickoPeak = 3600;
    (cheat.achievements.unlocked as Record<string, number>)['rating-puzzles-2000'] = NOW;
    const res = validateProgress(cheat, storedSnapshot(), NOW);
    expectOk(res);
    const p = puzzlesOf(res.data);
    assert.equal(p.eloPeak, 1450); // stored peak, not the fabricated one
    assert.equal(p.glickoPeak, 1430);
    assert.ok(res.adjustments.some((a) => a.includes('without new games')));
    const unlocked = (res.data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;
    assert.ok(!('rating-puzzles-2000' in unlocked)); // clamped peak can't back the badge
  });

  it('rejects a peak beyond per-game reach even when new games are claimed', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.played = 102;
    cheat.ratings.categories.puzzles.won = 62;
    cheat.ratings.categories.puzzles.eloPeak = 2000; // 2 games can add at most 80
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /peak .* unreachable/i);
  });

  it('rejects a first-sync legacy puzzle peak unreachable with the claimed puzzles', () => {
    const payload = { puzzleRating: { rating: 1200, peak: 3600, played: 2, solved: 1, history: {} } };
    expectReject(validateProgress(payload, null, NOW), /peak rating .* unreachable/i);
  });

  it('clamps a legacy puzzle peak claimed without new puzzles', () => {
    const stored = { puzzleRating: { rating: 1400, peak: 1450, played: 100, solved: 60, history: {} } };
    const cheat = { puzzleRating: { rating: 1400, peak: 3600, played: 100, solved: 60, history: {} } };
    const res = validateProgress(cheat, stored, NOW);
    expectOk(res);
    const legacy = (res.data as { puzzleRating: { peak: number } }).puzzleRating;
    assert.equal(legacy.peak, 1450);
    assert.ok(res.adjustments.some((a) => a.includes('without new puzzles')));
  });
});

// ---------------------------------------------------------------------------
// Zero-activity padding days can't back goal/streak/quest claims
// ---------------------------------------------------------------------------

describe('padding-day claims', () => {
  /** Adds `n` zero-XP, zero-activity day logs far in the past. */
  function pad(days: Record<string, { xp: number; activities: number }>, n: number): void {
    for (let i = 0; i < n; i++) days[day(-30 - i)] = { xp: 0, activities: 0 };
  }

  it('rejects goalsMet backed only by zero-XP padding days', () => {
    const cheat = storedSnapshot();
    pad(cheat.gamify.days, 45);
    cheat.gamify.goalsMet = 50; // only 5 days have xp ≥ the minimum goal
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /daily goal/i);
  });

  it('rejects a best goal-streak backed only by padding days', () => {
    const cheat = storedSnapshot();
    pad(cheat.gamify.days, 45);
    cheat.gamify.goalsMet = 50;
    cheat.gamify.bestStreak = 50;
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /daily goal|goal streak/i);
  });

  it('rejects a best activity streak beyond the claimed active days', () => {
    const cheat = storedSnapshot();
    pad(cheat.gamify.days, 95);
    cheat.streak.best = 100; // only 5 days have activities ≥ 1
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /best streak .* exceeds the \d+ claimed active day/i);
  });

  it('rejects lifetime quest counts backed only by padding days', () => {
    const cheat = storedSnapshot();
    pad(cheat.gamify.days, 95);
    cheat.quests.totalCompleted = 300; // 6/day over 5 active days allows 30
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /quest count/i);
  });
});

// ---------------------------------------------------------------------------
// Partial payloads — merged-view validation: omitted sections are preserved
// and stored stats still back (or disprove) every claim
// ---------------------------------------------------------------------------

describe('partial payloads (merged-view validation)', () => {
  const unlockedOf = (data: unknown): Record<string, number> =>
    (data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;

  it('drops fabricated claims from a payload containing only an achievements section', () => {
    // No gamify/ratings/streak sections at all: the stored stats (60 puzzles
    // solved, level 6, 0 games won, peak 1450, streak best 5) must still be
    // the ones the claims are checked against — not "unverifiable".
    const cheat = {
      achievements: {
        unlocked: {
          'tactics-solve-1000': NOW,
          'rating-puzzles-2000': NOW,
          'dedication-level-25': NOW,
          'play-win-150': NOW,
          'streak-streak-30': NOW,
        },
      },
    };
    const res = validateProgress(cheat, storedSnapshot(), NOW);
    expectOk(res);
    const unlocked = unlockedOf(res.data);
    for (const id of Object.keys(cheat.achievements.unlocked)) {
      assert.ok(!(id in unlocked), `${id} should have been dropped`);
    }
    assert.ok('tactics-solve-50' in unlocked); // the stored, earned badge survives
    // …and the partial payload deleted nothing.
    assert.equal(puzzlesOf(res.data).played, 100);
    assert.equal((res.data as { gamify: { xp: number } }).gamify.xp, 1000);
  });

  it('preserves stored sections omitted from the payload (omitting ratings cannot delete them)', () => {
    const partial = storedSnapshot() as Record<string, unknown>;
    delete partial.ratings;
    const res = validateProgress(partial, storedSnapshot(), NOW);
    expectOk(res);
    const p = puzzlesOf(res.data);
    assert.equal(p.played, 100);
    assert.equal(p.eloPeak, 1450);
    // The rating badge stays backed by the stored (preserved) categories.
    assert.ok('tactics-solve-50' in unlockedOf(res.data));
  });

  it('preserves stored rating categories omitted from the payload', () => {
    const partial = storedSnapshot();
    delete (partial.ratings.categories as Record<string, unknown>).puzzles;
    const res = validateProgress(partial, storedSnapshot(), NOW);
    expectOk(res);
    assert.equal(puzzlesOf(res.data).played, 100);
    assert.equal(puzzlesOf(res.data).eloPeak, 1450);
  });

  it('accepts an honest XP total when older day logs were pruned client-side', () => {
    const pruned = storedSnapshot();
    // The client kept only the most recent day log but the lifetime XP total
    // (1000, backed by the 5 stored day logs) is untouched.
    pruned.gamify.days = { [day(-5)]: { xp: 200, activities: 10 } };
    const res = validateProgress(pruned, storedSnapshot(), NOW);
    expectOk(res);
    const gamify = (res.data as { gamify: { xp: number; days: Record<string, unknown> } }).gamify;
    assert.equal(gamify.xp, 1000);
    assert.equal(Object.keys(gamify.days).length, 5); // stored logs survive the merge
  });

  it('still rejects a fabricated XP total that even the stored day logs cannot back', () => {
    const cheat = storedSnapshot();
    cheat.gamify.days = { [day(-5)]: { xp: 200, activities: 10 } };
    cheat.gamify.xp = 50_000; // stored ∪ incoming day logs sum to 1000
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /not backed/i);
  });

  it('bounds streak claims by the stored day logs when the payload omits the gamify section', () => {
    const cheat = storedSnapshot() as Record<string, unknown>;
    delete cheat.gamify;
    cheat.streak = { count: 40, best: 40, lastDay: day(0), freezes: 1, milestonesAwarded: [3, 7, 30] };
    expectReject(validateProgress(cheat, storedSnapshot(), NOW), /exceeds the \d+ claimed active day/i);
  });

  it('drops verifiable claims on a fresh account with no backing stats (achievements-only first PUT)', () => {
    // Nothing stored, nothing incoming to back the claims: every verifiable
    // badge must be treated as backed-by-0 and dropped, not "unverifiable".
    const cheat = {
      achievements: {
        unlocked: {
          'tactics-solve-1000': NOW,
          'play-win-150': NOW,
          'dedication-level-25': NOW,
          'streak-streak-100': NOW,
          'rating-puzzles-2000': NOW,
          'rush-rush-15': NOW, // genuinely unverifiable id — passes through
        },
      },
    };
    const res = validateProgress(cheat, null, NOW);
    expectOk(res);
    const unlocked = unlockedOf(res.data);
    for (const id of ['tactics-solve-1000', 'play-win-150', 'dedication-level-25', 'streak-streak-100', 'rating-puzzles-2000']) {
      assert.ok(!(id in unlocked), `${id} should have been dropped`);
    }
    assert.ok('rush-rush-15' in unlocked);
    assert.ok(res.adjustments.some((a) => a.includes('tactics-solve-1000')));
  });

  it('keeps genuinely backed badges on a fresh first sync of a full snapshot', () => {
    const res = validateProgress(storedSnapshot(), null, NOW);
    expectOk(res);
    assert.ok('tactics-solve-50' in unlockedOf(res.data)); // 60 puzzles solved ≥ 50
  });

  it('rejects a forged streak on a fresh account when the gamify section is omitted', () => {
    const cheat = { streak: { count: 99_999, best: 99_999, lastDay: day(0), freezes: 2, milestonesAwarded: [3, 7, 30, 100] } };
    expectReject(validateProgress(cheat, null, NOW), /exceeds the 0 claimed active day/i);
  });

  it('rejects forged lifetime quest counters on a fresh account when the gamify section is omitted', () => {
    const cheat = { quests: { day: day(0), progress: {}, done: {}, bonusPaid: false, totalCompleted: 1000, daysAllDone: 500 } };
    expectReject(validateProgress(cheat, null, NOW), /quest count of \d+ exceeds the plausible .* over 0 active day/i);
  });

  it('still accepts a runless streak and zeroed quest counters without a gamify section', () => {
    const empty = {
      streak: { count: 0, best: 0, lastDay: '', freezes: 0, milestonesAwarded: [] },
      quests: { day: day(0), progress: {}, done: {}, bonusPaid: false, totalCompleted: 0, daysAllDone: 0 },
    };
    expectOk(validateProgress(empty, null, NOW));
  });

  it('slots a legacy bare blob into the progress section instead of wiping stored sections', () => {
    const legacy = { cards: { 'e4:e5': { due: 1 } }, streak: 4 };
    const res = validateProgress(legacy, storedSnapshot(), NOW);
    expectOk(res);
    assert.deepEqual((res.data as { progress: unknown }).progress, legacy);
    assert.equal(puzzlesOf(res.data).played, 100);
    assert.ok('tactics-solve-50' in unlockedOf(res.data));
  });
});

// ---------------------------------------------------------------------------
// Clamped payloads — normalizable noise is adjusted, not fatal
// ---------------------------------------------------------------------------

describe('clamped payloads', () => {
  it('drops a fabricated achievement whose backing stat falls short', () => {
    const cheat = offlineBatch();
    cheat.achievements.unlocked['tactics-solve-1000'] = NOW; // only 140 solved
    const res = validateProgress(cheat, storedSnapshot(), NOW);
    expectOk(res);
    const unlocked = (res.data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;
    assert.ok(!('tactics-solve-1000' in unlocked));
    assert.ok('tactics-solve-50' in unlocked); // legit claims survive
    assert.ok(res.adjustments.some((a) => a.includes('tactics-solve-1000')));
  });

  it('drops a fabricated rating achievement', () => {
    const cheat = offlineBatch();
    cheat.achievements.unlocked['rating-puzzles-2000'] = NOW; // peak is 1540
    const res = validateProgress(cheat, storedSnapshot(), NOW);
    expectOk(res);
    const unlocked = (res.data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;
    assert.ok(!('rating-puzzles-2000' in unlocked));
  });

  it('passes through achievement ids the server cannot verify', () => {
    const batch = offlineBatch();
    batch.achievements.unlocked['rush-rush-15'] = NOW; // rush scores are not synced
    const res = validateProgress(batch, storedSnapshot(), NOW);
    expectOk(res);
    const unlocked = (res.data as { achievements: { unlocked: Record<string, number> } }).achievements.unlocked;
    assert.ok('rush-rush-15' in unlocked);
  });

  it('clamps streak freezes to the bank cap', () => {
    const greedy = storedSnapshot();
    greedy.streak.freezes = 99;
    const res = validateProgress(greedy, storedSnapshot(), NOW);
    expectOk(res);
    assert.equal((res.data as { streak: { freezes: number } }).streak.freezes, LIMITS.freezesCap);
    assert.ok(res.adjustments.some((a) => a.includes('freezes')));
  });

  it('drops streak milestones no claimed run could have reached', () => {
    const cheat = storedSnapshot();
    cheat.streak.milestonesAwarded = [3, 100];
    const res = validateProgress(cheat, storedSnapshot(), NOW);
    expectOk(res);
    assert.deepEqual((res.data as { streak: { milestonesAwarded: number[] } }).streak.milestonesAwarded, [3]);
  });

  it('keeps the stored live rating when a client claims a higher rating without new games', () => {
    const cheat = storedSnapshot();
    cheat.ratings.categories.puzzles.elo = 1700; // same played count, +300 Elo
    cheat.ratings.categories.puzzles.eloPeak = 1700;
    const res = validateProgress(cheat, storedSnapshot(), NOW);
    expectOk(res);
    assert.equal(puzzlesOf(res.data).elo, 1400);
    assert.ok(res.adjustments.some((a) => a.includes('without more games')));
  });

  it('drops junk map entries instead of failing the sync', () => {
    const messy = storedSnapshot();
    (messy.gamify.days as Record<string, unknown>)['not-a-day'] = { xp: 50, activities: 1 };
    const res = validateProgress(messy, storedSnapshot(), NOW);
    expectOk(res);
    assert.ok(!('not-a-day' in (res.data as { gamify: { days: Record<string, unknown> } }).gamify.days));
    assert.ok(res.adjustments.some((a) => a.includes('invalid day')));
  });
});
