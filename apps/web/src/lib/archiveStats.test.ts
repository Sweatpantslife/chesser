import { describe, expect, it } from 'vitest';
import type { ArchiveResult } from './archive';
import {
  accuracyPoints,
  averageAccuracy,
  bucketStart,
  bucketTrend,
  DEFAULT_FILTER,
  filterGames,
  openingCounts,
  periodStart,
  pickBucketSize,
  ratingSeries,
  wdlCounts,
  type TrendPoint,
} from './archiveStats';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0); // 2026-07-10T12:00Z

const g = (result: ArchiveResult, userColor: 'white' | 'black' | null = 'white', playedAt = NOW) => ({
  result,
  userColor,
  playedAt,
});

// ---------------------------------------------------------------------------
// wdlCounts
// ---------------------------------------------------------------------------

describe('wdlCounts', () => {
  it('returns zeros and a null win rate for zero games', () => {
    expect(wdlCounts([])).toEqual({ total: 0, wins: 0, draws: 0, losses: 0, unknown: 0, winRate: null });
  });

  it('counts each result bucket', () => {
    const counts = wdlCounts([g('win'), g('win'), g('loss'), g('draw'), g('unknown')]);
    expect(counts).toMatchObject({ total: 5, wins: 2, draws: 1, losses: 1, unknown: 1 });
  });

  it('computes win rate over decided+drawn games only (unknown excluded)', () => {
    const counts = wdlCounts([g('win'), g('loss'), g('draw'), g('unknown'), g('unknown')]);
    expect(counts.winRate).toBeCloseTo(33.3, 1);
  });

  it('win rate is null when every game is unknown', () => {
    expect(wdlCounts([g('unknown'), g('unknown')]).winRate).toBeNull();
  });

  it('rounds win rate to one decimal', () => {
    // 2/3 = 66.666… → 66.7
    expect(wdlCounts([g('win'), g('win'), g('loss')]).winRate).toBe(66.7);
  });
});

// ---------------------------------------------------------------------------
// filterGames
// ---------------------------------------------------------------------------

describe('filterGames', () => {
  const games = [
    g('win', 'white', NOW - 1 * DAY),
    g('loss', 'black', NOW - 10 * DAY),
    g('draw', 'white', NOW - 40 * DAY),
    g('win', 'black', NOW - 100 * DAY),
    g('unknown', null, NOW - 400 * DAY),
  ];

  it('passes everything through with the default filter', () => {
    expect(filterGames(games, DEFAULT_FILTER, NOW)).toHaveLength(5);
  });

  it('filters by result', () => {
    expect(filterGames(games, { ...DEFAULT_FILTER, result: 'win' }, NOW)).toHaveLength(2);
    expect(filterGames(games, { ...DEFAULT_FILTER, result: 'draw' }, NOW)).toHaveLength(1);
  });

  it('filters by color and excludes perspective-less games from color filters', () => {
    expect(filterGames(games, { ...DEFAULT_FILTER, color: 'white' }, NOW)).toHaveLength(2);
    expect(filterGames(games, { ...DEFAULT_FILTER, color: 'black' }, NOW)).toHaveLength(2);
    // the null-color game only shows under 'all'
    expect(filterGames(games, { ...DEFAULT_FILTER, color: 'all' }, NOW)).toContainEqual(games[4]);
  });

  it('filters by period with an inclusive boundary', () => {
    expect(filterGames(games, { ...DEFAULT_FILTER, period: '7d' }, NOW)).toHaveLength(1);
    expect(filterGames(games, { ...DEFAULT_FILTER, period: '30d' }, NOW)).toHaveLength(2);
    expect(filterGames(games, { ...DEFAULT_FILTER, period: '90d' }, NOW)).toHaveLength(3);
    expect(filterGames(games, { ...DEFAULT_FILTER, period: '365d' }, NOW)).toHaveLength(4);
    // exactly on the boundary is included
    const edge = [g('win', 'white', periodStart('7d', NOW))];
    expect(filterGames(edge, { ...DEFAULT_FILTER, period: '7d' }, NOW)).toHaveLength(1);
  });

  it('combines result, color and period', () => {
    const got = filterGames(games, { result: 'win', color: 'white', period: '30d' }, NOW);
    expect(got).toEqual([games[0]]);
  });

  it('returns [] for zero games', () => {
    expect(filterGames([], { result: 'win', color: 'white', period: '7d' }, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// openingCounts
// ---------------------------------------------------------------------------

describe('openingCounts', () => {
  const og = (name: string | null, result: ArchiveResult, eco: string | null = 'C50') => ({
    opening: name ? { eco, name } : null,
    result,
  });

  it('returns [] for zero games and for games with no detected opening', () => {
    expect(openingCounts([])).toEqual([]);
    expect(openingCounts([og(null, 'win'), og(null, 'loss')])).toEqual([]);
  });

  it('groups by opening name with per-result counts', () => {
    const got = openingCounts([
      og('Italian Game', 'win'),
      og('Italian Game', 'loss'),
      og('Italian Game', 'draw'),
      og('Italian Game', 'unknown'),
      og('Sicilian Defense', 'win', 'B20'),
    ]);
    expect(got).toEqual([
      { name: 'Italian Game', eco: 'C50', games: 4, wins: 1, draws: 1, losses: 1 },
      { name: 'Sicilian Defense', eco: 'B20', games: 1, wins: 1, draws: 0, losses: 0 },
    ]);
  });

  it('sorts by games desc, then wins desc, then name asc', () => {
    const got = openingCounts([
      og('B Opening', 'loss'),
      og('B Opening', 'loss'),
      og('A Opening', 'win'),
      og('A Opening', 'loss'),
      og('C Opening', 'loss'),
      og('C Opening', 'loss'),
    ]);
    expect(got.map((o) => o.name)).toEqual(['A Opening', 'B Opening', 'C Opening']);
  });

  it('applies the limit after sorting', () => {
    const games = [og('One', 'win'), og('One', 'win'), og('Two', 'win'), og('Three', 'loss')];
    const got = openingCounts(games, 2);
    expect(got).toHaveLength(2);
    expect(got[0]!.name).toBe('One');
  });
});

// ---------------------------------------------------------------------------
// trend bucketing
// ---------------------------------------------------------------------------

describe('bucketStart', () => {
  const t = Date.UTC(2026, 6, 10, 15, 30); // Friday 2026-07-10

  it('floors to the UTC day', () => {
    expect(bucketStart(t, 'day')).toBe(Date.UTC(2026, 6, 10));
  });

  it('floors to the ISO-week Monday', () => {
    expect(bucketStart(t, 'week')).toBe(Date.UTC(2026, 6, 6)); // Monday 2026-07-06
    // a Monday stays put, a Sunday snaps back six days
    expect(bucketStart(Date.UTC(2026, 6, 6, 1), 'week')).toBe(Date.UTC(2026, 6, 6));
    expect(bucketStart(Date.UTC(2026, 6, 12, 23), 'week')).toBe(Date.UTC(2026, 6, 6));
  });

  it('floors to the first of the month', () => {
    expect(bucketStart(t, 'month')).toBe(Date.UTC(2026, 6, 1));
  });
});

describe('bucketTrend', () => {
  it('returns [] for zero points', () => {
    expect(bucketTrend([], 'day')).toEqual([]);
  });

  it('averages points that share a bucket and keeps buckets chronological', () => {
    const monday = Date.UTC(2026, 6, 6);
    const points: TrendPoint[] = [
      { t: Date.UTC(2026, 6, 13), value: 90 }, // next week — listed first on purpose
      { t: monday + 2 * DAY, value: 80 },
      { t: monday, value: 60 },
    ];
    const got = bucketTrend(points, 'week');
    expect(got).toEqual([
      { start: monday, label: '2026-07-06', value: 70, count: 2 },
      { start: Date.UTC(2026, 6, 13), label: '2026-07-13', value: 90, count: 1 },
    ]);
  });

  it('rounds bucket means to one decimal', () => {
    const day = Date.UTC(2026, 6, 10);
    const got = bucketTrend(
      [
        { t: day, value: 90 },
        { t: day + 1000, value: 90 },
        { t: day + 2000, value: 91 },
      ],
      'day',
    );
    expect(got[0]!.value).toBeCloseTo(90.3, 5);
  });

  it('labels month buckets as YYYY-MM', () => {
    const got = bucketTrend([{ t: Date.UTC(2026, 6, 10), value: 50 }], 'month');
    expect(got[0]!.label).toBe('2026-07');
  });

  it('skips non-finite values and timestamps', () => {
    const got = bucketTrend(
      [
        { t: Date.UTC(2026, 6, 10), value: NaN },
        { t: NaN, value: 50 },
        { t: Date.UTC(2026, 6, 10), value: 75 },
      ],
      'day',
    );
    expect(got).toEqual([{ start: Date.UTC(2026, 6, 10), label: '2026-07-10', value: 75, count: 1 }]);
  });
});

describe('pickBucketSize', () => {
  it('defaults to day for empty and short spans', () => {
    expect(pickBucketSize([])).toBe('day');
    expect(pickBucketSize([{ t: NOW, value: 1 }])).toBe('day');
    expect(
      pickBucketSize([
        { t: NOW - 30 * DAY, value: 1 },
        { t: NOW, value: 1 },
      ]),
    ).toBe('day');
  });

  it('uses weeks for medium spans and months for long spans', () => {
    expect(
      pickBucketSize([
        { t: NOW - 200 * DAY, value: 1 },
        { t: NOW, value: 1 },
      ]),
    ).toBe('week');
    expect(
      pickBucketSize([
        { t: NOW - 500 * DAY, value: 1 },
        { t: NOW, value: 1 },
      ]),
    ).toBe('month');
  });
});

// ---------------------------------------------------------------------------
// accuracy + rating series
// ---------------------------------------------------------------------------

describe('accuracyPoints', () => {
  it('returns [] when no game has a review', () => {
    expect(accuracyPoints([])).toEqual([]);
    expect(accuracyPoints([{ playedAt: NOW, accuracy: null }])).toEqual([]);
  });

  it('keeps only reviewed games, sorted chronologically', () => {
    const got = accuracyPoints([
      { playedAt: NOW, accuracy: 92 },
      { playedAt: NOW - DAY, accuracy: null },
      { playedAt: NOW - 2 * DAY, accuracy: 85.5 },
    ]);
    expect(got).toEqual([
      { t: NOW - 2 * DAY, value: 85.5 },
      { t: NOW, value: 92 },
    ]);
  });
});

describe('averageAccuracy', () => {
  it('is null with zero games or zero reviews', () => {
    expect(averageAccuracy([])).toBeNull();
    expect(averageAccuracy([{ accuracy: null }, { accuracy: null }])).toBeNull();
  });

  it('averages reviewed games only, one decimal', () => {
    expect(averageAccuracy([{ accuracy: 90 }, { accuracy: null }, { accuracy: 85 }])).toBe(87.5);
    expect(averageAccuracy([{ accuracy: 90 }, { accuracy: 90 }, { accuracy: 91 }])).toBeCloseTo(90.3, 5);
  });
});

describe('ratingSeries', () => {
  it('handles a missing or empty history', () => {
    expect(ratingSeries(undefined, 'elo')).toEqual([]);
    expect(ratingSeries(null, 'glicko')).toEqual([]);
    expect(ratingSeries({}, 'elo')).toEqual([]);
  });

  it('extracts the chosen meter sorted by day', () => {
    const history = {
      '2026-07-02': { elo: 1520, glicko: 1540 },
      '2026-07-01': { elo: 1500, glicko: 1510 },
    };
    expect(ratingSeries(history, 'elo')).toEqual([
      { t: Date.UTC(2026, 6, 1), value: 1500 },
      { t: Date.UTC(2026, 6, 2), value: 1520 },
    ]);
    expect(ratingSeries(history, 'glicko').map((p) => p.value)).toEqual([1510, 1540]);
  });

  it('skips malformed days and snapshots', () => {
    const history = {
      'not-a-date': { elo: 1500, glicko: 1500 },
      '2026-07-01': { elo: Number.NaN, glicko: 1510 },
      '2026-07-02': { glicko: 1540 } as unknown as { elo: number; glicko: number },
      '2026-07-03': { elo: 1530, glicko: 1550 },
    };
    expect(ratingSeries(history, 'elo')).toEqual([{ t: Date.UTC(2026, 6, 3), value: 1530 }]);
  });
});
