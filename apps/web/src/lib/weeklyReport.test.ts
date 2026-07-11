import { describe, expect, it } from 'vitest';
import {
  buildWeeklyNarrative,
  buildWeeklyReport,
  buildWeeklyReportFacts,
  weekKeyOf,
  weekRangeOf,
  type WeeklyInputs,
} from './weeklyReport';

// All fixture times are built with the LOCAL Date constructor so the tests
// pass in any timezone — the aggregation keys weeks on the local calendar.
// 2026-07-06 is a Monday; NOW is Wednesday 2026-07-08 15:00 local.
const local = (y: number, m1: number, d: number, h = 12) => new Date(y, m1 - 1, d, h).getTime();
const NOW = local(2026, 7, 8, 15);

const emptyInputs = (): WeeklyInputs => ({
  days: {},
  streak: 0,
  lessons: {},
  games: [],
  training: [],
  rushBests: [],
  stormBest: { score: 0, at: 0 },
  puzzleHistory: {},
});

describe('weekRangeOf / weekKeyOf', () => {
  it('anchors the week on the local Monday', () => {
    const r = weekRangeOf(NOW);
    expect(r.startKey).toBe('2026-07-06');
    expect(r.endKey).toBe('2026-07-12');
    expect(r.label).toBe('Jul 6 – Jul 12');
  });

  it('is deterministic across the whole week and flips exactly at Monday midnight', () => {
    expect(weekKeyOf(local(2026, 7, 6, 0))).toBe('2026-07-06'); // Monday 00:00 — first instant
    expect(weekKeyOf(local(2026, 7, 12, 23))).toBe('2026-07-06'); // Sunday night — last day
    expect(weekKeyOf(local(2026, 7, 13, 0))).toBe('2026-07-13'); // next Monday — new week
    expect(weekKeyOf(local(2026, 7, 5, 23))).toBe('2026-06-29'); // Sunday before — previous week
  });

  it('labels weeks that span a month boundary with both months', () => {
    expect(weekRangeOf(local(2026, 7, 1)).label).toBe('Jun 29 – Jul 5');
  });
});

describe('buildWeeklyReport', () => {
  it('reports an empty week as inactive', () => {
    const r = buildWeeklyReport(emptyInputs(), NOW);
    expect(r.hasActivity).toBe(false);
    expect(r.weekKey).toBe('2026-07-06');
    expect(r.games).toEqual({ played: 0, wins: 0, losses: 0, draws: 0, bestAccuracy: null });
    expect(r.puzzles.delta).toBeNull();
  });

  it('aggregates only entries inside the local week', () => {
    const inputs: WeeklyInputs = {
      days: {
        '2026-07-05': { xp: 500, activities: 9 }, // Sunday before — excluded
        '2026-07-06': { xp: 40, activities: 3 },
        '2026-07-08': { xp: 25, activities: 2 },
        '2026-07-12': { xp: 10, activities: 1 }, // Sunday of this week — included
        '2026-07-13': { xp: 999, activities: 9 }, // next Monday — excluded
      },
      streak: 4,
      lessons: {
        old: { ts: local(2026, 6, 20), stars: 3 }, // last month — excluded
        a: { ts: local(2026, 7, 7), stars: 3 },
        b: { ts: local(2026, 7, 8), stars: 2 },
      },
      games: [
        { createdAt: local(2026, 7, 6), result: 'win', accuracy: 91.24, mistakes: [{ kinds: ['hangingPieces'] }] },
        {
          createdAt: local(2026, 7, 7),
          result: 'loss',
          accuracy: 74.5,
          mistakes: [{ kinds: ['hangingPieces', 'missedTactics'] }, { kinds: ['hangingPieces'] }],
        },
        { createdAt: local(2026, 7, 8), result: 'draw', accuracy: 82.0, mistakes: [] },
        { createdAt: local(2026, 7, 4), result: 'win', accuracy: 99.9, mistakes: [] }, // last week — excluded
      ],
      training: [
        { at: local(2026, 7, 6), solved: true },
        { at: local(2026, 7, 7), solved: false },
        { at: local(2026, 7, 7, 13), solved: true },
        { at: local(2026, 6, 30), solved: true }, // last week — excluded
      ],
      rushBests: [
        { score: 18, at: local(2026, 7, 7) },
        { score: 12, at: local(2026, 6, 12) }, // old record — excluded
      ],
      stormBest: { score: 44, at: local(2026, 6, 1) }, // old — no new storm record
      puzzleHistory: {
        '2026-06-30': { elo: 1200 },
        '2026-07-04': { elo: 1240 }, // last before the week → start
        '2026-07-07': { elo: 1260 },
        '2026-07-10': { elo: 1290 }, // last inside the week → end
      },
    };

    const r = buildWeeklyReport(inputs, NOW);
    expect(r.hasActivity).toBe(true);
    expect(r.activeDays).toBe(3);
    expect(r.xpEarned).toBe(75);
    expect(r.activities).toBe(6);
    expect(r.streak).toBe(4);
    expect(r.games).toEqual({ played: 3, wins: 1, losses: 1, draws: 1, bestAccuracy: 91.2 });
    expect(r.lessons).toEqual({ completed: 2, stars: 5 });
    expect(r.training).toEqual({ attempts: 3, solved: 2 });
    expect(r.sprints).toEqual({ newRushBest: 18, newStormBest: null });
    expect(r.puzzles).toEqual({ ratingStart: 1240, ratingEnd: 1290, delta: 50 });
    // hangingPieces appeared 3× vs missedTactics 1× → top weakness.
    expect(r.weakness).toEqual({ kind: 'hangingPieces', label: 'Hanging pieces', count: 3 });
  });

  it('leaves the puzzle delta null without a pre-week baseline', () => {
    const inputs = emptyInputs();
    inputs.puzzleHistory = { '2026-07-07': { elo: 1300 } };
    const r = buildWeeklyReport(inputs, NOW);
    expect(r.puzzles).toEqual({ ratingStart: null, ratingEnd: 1300, delta: null });
  });
});

describe('buildWeeklyNarrative', () => {
  it('writes an inviting line for an empty week', () => {
    const text = buildWeeklyNarrative(buildWeeklyReport(emptyInputs(), NOW));
    expect(text).toMatch(/quiet week/i);
  });

  it('mentions the headline numbers for an active week', () => {
    const inputs = emptyInputs();
    inputs.days = { '2026-07-06': { xp: 40, activities: 3 }, '2026-07-07': { xp: 60, activities: 4 } };
    inputs.streak = 9;
    inputs.games = [{ createdAt: local(2026, 7, 7), result: 'win', accuracy: 88.4, mistakes: [] }];
    const text = buildWeeklyNarrative(buildWeeklyReport(inputs, NOW));
    expect(text).toContain('100 XP');
    expect(text).toContain('1W–0L–0D');
    expect(text).toContain('88.4%');
    expect(text).toContain('9 days');
  });
});

describe('buildWeeklyReportFacts', () => {
  it('produces a compact, server-shaped facts payload grounded by the template text', () => {
    const inputs = emptyInputs();
    inputs.days = { '2026-07-08': { xp: 30, activities: 2 } };
    inputs.games = [{ createdAt: local(2026, 7, 8), result: 'win', accuracy: 90, mistakes: [{ kinds: ['missedForks'] }] }];
    const report = buildWeeklyReport(inputs, NOW);
    const facts = buildWeeklyReportFacts(report);
    expect(facts.kind).toBe('weekly_report');
    expect(facts.weekLabel).toBe('Jul 6 – Jul 12');
    expect(facts.gamesPlayed).toBe(1);
    expect(facts.topWeakness).toBe('Missed forks');
    expect(facts.ruleBasedText).toBe(buildWeeklyNarrative(report));
    expect(facts.ruleBasedText!.length).toBeLessThanOrEqual(600);
  });
});
