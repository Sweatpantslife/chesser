import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCategory,
  extractRushBest,
  sanitizeOpenings,
  sanitizePrefs,
  validateSubmission,
  DEFAULT_PREFS,
  LB_LIMITS,
  type BoardEntry,
} from './validation.js';

const T0 = Date.parse('2026-07-10T12:00:00Z');

function blobWith(cat: { elo: number; played: number }, extra: Record<string, unknown> = {}): unknown {
  return {
    ratings: {
      categories: {
        puzzles: { elo: cat.elo, eloPeak: cat.elo, played: cat.played, won: cat.played, drawn: 0, lost: 0 },
      },
    },
    ...extra,
  };
}

describe('validateSubmission — rating boards', () => {
  it('accepts a claim matching the synced blob and ranks the server value', () => {
    const res = validateSubmission('puzzles', 1301, null, blobWith({ elo: 1300.6, played: 10 }), T0);
    assert.ok(res.ok && res.changed);
    assert.equal(res.entry.value, 1301); // Math.round(1300.6)
    assert.equal(res.entry.played, 10);
  });

  it('rejects a claim that does not match the synced rating', () => {
    const res = validateSubmission('puzzles', 1500, null, blobWith({ elo: 1300, played: 10 }), T0);
    assert.ok(!res.ok && res.status === 400);
    assert.match(res.error, /doesn't match/);
  });

  it('rejects out-of-bounds and malformed values before touching state', () => {
    for (const v of [5000, 5, -20, Infinity, NaN, 'high' as unknown]) {
      const res = validateSubmission('puzzles', v, null, blobWith({ elo: 1300, played: 10 }), T0);
      assert.ok(!res.ok, String(v));
    }
  });

  it('rejects when there is no synced progress or no rated games', () => {
    const none = validateSubmission('puzzles', 1300, null, null, T0);
    assert.ok(!none.ok && /synced rating/i.test(none.error));
    const zero = validateSubmission('puzzles', 1200, null, blobWith({ elo: 1200, played: 0 }), T0);
    assert.ok(!zero.ok && /at least one rated/i.test(zero.error));
  });

  it('treats an unchanged value as a duplicate no-op', () => {
    const existing: BoardEntry = { value: 1300, played: 10, updatedAt: T0 - 60_000, weekly: {} };
    const res = validateSubmission('puzzles', 1300, existing, blobWith({ elo: 1300, played: 10 }), T0);
    assert.ok(res.ok && !res.changed);
  });

  it('rejects a rating that moved without new games (defense in depth)', () => {
    const existing: BoardEntry = { value: 1300, played: 10, updatedAt: T0 - 60_000, weekly: {} };
    const res = validateSubmission('puzzles', 1340, existing, blobWith({ elo: 1340, played: 10 }), T0);
    assert.ok(!res.ok && /without any new games/i.test(res.error));
  });

  it('rejects a jump beyond the per-game bound', () => {
    const existing: BoardEntry = { value: 1300, played: 10, updatedAt: T0 - 60_000, weekly: {} };
    const res = validateSubmission('puzzles', 1400, existing, blobWith({ elo: 1400, played: 11 }), T0);
    assert.ok(!res.ok && /implausible/i.test(res.error));
  });

  it('rate-limits accepted changes', () => {
    const existing: BoardEntry = { value: 1300, played: 10, updatedAt: T0 - 1_000, weekly: {} };
    const soon = validateSubmission('puzzles', 1320, existing, blobWith({ elo: 1320, played: 11 }), T0);
    assert.ok(!soon.ok && soon.status === 429);
    const later = validateSubmission(
      'puzzles',
      1320,
      existing,
      blobWith({ elo: 1320, played: 11 }),
      T0 + LB_LIMITS.submitIntervalMs,
    );
    assert.ok(later.ok && later.changed);
  });

  it('keeps a best-of weekly bucket and prunes old weeks', () => {
    let entry: BoardEntry | null = null;
    let t = T0;
    let elo = 1300;
    let played = 10;
    for (let i = 0; i < LB_LIMITS.weeklyKeep + 3; i++) {
      const res = validateSubmission('puzzles', elo, entry, blobWith({ elo, played }), t);
      assert.ok(res.ok && res.changed);
      entry = res.entry;
      t += 7 * 86_400_000; // next ISO week
      elo += 10;
      played += 1;
    }
    assert.ok(entry);
    assert.equal(Object.keys(entry.weekly).length, LB_LIMITS.weeklyKeep);
  });
});

describe('validateSubmission — puzzle rush', () => {
  it('accepts a first plausible score', () => {
    const res = validateSubmission('rush', 17, null, null, T0);
    assert.ok(res.ok && res.changed && res.entry.value === 17);
  });

  it('rejects scores outside 0..cap and a first score of 0', () => {
    assert.ok(!validateSubmission('rush', LB_LIMITS.rushCap + 1, null, null, T0).ok);
    assert.ok(!validateSubmission('rush', -1, null, null, T0).ok);
    assert.ok(!validateSubmission('rush', 0, null, null, T0).ok);
  });

  it('is monotonic: lower or equal resubmissions are no-ops', () => {
    const existing: BoardEntry = { value: 20, updatedAt: T0 - 60_000, weekly: {} };
    const lower = validateSubmission('rush', 12, existing, null, T0);
    assert.ok(lower.ok && !lower.changed && lower.entry.value === 20);
    const equal = validateSubmission('rush', 20, existing, null, T0);
    assert.ok(equal.ok && !equal.changed);
  });

  it('cross-checks against a synced rush best when the blob carries one', () => {
    const blob = { rush: { best: 15 } };
    const inflated = validateSubmission('rush', 30, null, blob, T0);
    assert.ok(!inflated.ok && /exceeds your synced best/i.test(inflated.error));
    const honest = validateSubmission('rush', 15, null, blob, T0);
    assert.ok(honest.ok && honest.changed);
  });

  it('rate-limits improvements', () => {
    const existing: BoardEntry = { value: 20, updatedAt: T0 - 1_000, weekly: {} };
    const soon = validateSubmission('rush', 25, existing, null, T0);
    assert.ok(!soon.ok && soon.status === 429);
  });
});

describe('blob extraction', () => {
  it('extractRushBest reads the sprints section (best across rush modes)', () => {
    const blob = {
      sprints: {
        puzzleRushBest: {
          timed3: { score: 14, bestStreak: 6, at: 1 },
          survival: { score: 22, bestStreak: 9, at: 2 },
        },
        puzzleStormBest: { score: 90, bestStreak: 30, at: 3 }, // storm is NOT rush
      },
    };
    assert.equal(extractRushBest(blob), 22);
  });

  it('extractRushBest falls back to legacy/transitional locations', () => {
    assert.equal(extractRushBest({ rush: { best: 12 } }), 12);
    assert.equal(extractRushBest({ rush: { highScore: 9 } }), 9);
    assert.equal(extractRushBest({ puzzleRush: { best: 7.9 } }), 7);
    assert.equal(extractRushBest({ puzzleRushBest: 4 }), 4);
    assert.equal(extractRushBest({ something: 'else' }), null);
    assert.equal(extractRushBest(null), null);
  });

  it('extractCategory reads only well-formed categories', () => {
    assert.equal(extractCategory({ ratings: { categories: { puzzles: { elo: 'x' } } } }, 'puzzles'), null);
    const c = extractCategory(blobWith({ elo: 1250, played: 4 }), 'puzzles');
    assert.ok(c && c.elo === 1250 && c.played === 4);
  });
});

describe('prefs + openings sanitizing', () => {
  it('coerces pref patches to booleans and ignores junk keys', () => {
    const p = sanitizePrefs(DEFAULT_PREFS, { leaderboards: 1, profile: true, hax: true });
    assert.equal(p.leaderboards, false); // 1 !== true — strict opt-in
    assert.equal(p.profile, true);
    assert.ok(!('hax' in p));
  });

  it('bounds favorite openings to sane display data', () => {
    const out = sanitizeOpenings([
      { name: '  Italian Game  ', eco: 'C50', games: 12.7, wins: 99 },
      { name: 'x'.repeat(200), eco: 'ZZ9', games: -3, wins: 2 },
      { name: '', eco: 'A00', games: 1, wins: 1 },
      'junk',
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Opening ${i}`, eco: null, games: 1, wins: 0 })),
    ]);
    assert.ok(out.length <= 5);
    assert.equal(out[0]!.name, 'Italian Game');
    assert.equal(out[0]!.games, 12);
    assert.equal(out[0]!.wins, 12); // clamped to games
    assert.equal(out[1]!.name.length, 80);
    assert.equal(out[1]!.eco, null); // ZZ9 is not an ECO code
    assert.equal(out[1]!.games, 0);
  });

  it('caps on VALID openings — junk early in the array cannot crowd out later valid ones', () => {
    const out = sanitizeOpenings([
      'junk',
      null,
      { name: '' },
      { eco: 'C50', games: 3, wins: 1 }, // no name
      42,
      ...Array.from({ length: 6 }, (_, i) => ({ name: `Opening ${i}`, eco: null, games: 1, wins: 0 })),
    ]);
    assert.equal(out.length, 5); // five valid items survive the five junk ones
    assert.deepEqual(
      out.map((o) => o.name),
      ['Opening 0', 'Opening 1', 'Opening 2', 'Opening 3', 'Opening 4'],
    );
  });
});
