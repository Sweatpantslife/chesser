/**
 * Personal game archive — PURE stats aggregation.
 *
 * Every function here is deterministic over its inputs (a `now` timestamp is
 * always a parameter, never read from the clock) so the Archive dashboard's
 * numbers are unit-testable. Inputs use minimal structural shapes rather than
 * the full ArchiveGame so fixtures stay small.
 */
import type { ArchiveResult } from './archive';
import type { Side } from './analytics/types';

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Win / draw / loss
// ---------------------------------------------------------------------------

export interface WdlCounts {
  total: number;
  wins: number;
  draws: number;
  losses: number;
  /** Games with no user perspective or an unfinished result. */
  unknown: number;
  /** Wins as % of decided-or-drawn games (0–100, one decimal); null when none. */
  winRate: number | null;
}

export function wdlCounts(games: ReadonlyArray<{ result: ArchiveResult }>): WdlCounts {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let unknown = 0;
  for (const g of games) {
    if (g.result === 'win') wins++;
    else if (g.result === 'draw') draws++;
    else if (g.result === 'loss') losses++;
    else unknown++;
  }
  const decided = wins + draws + losses;
  return {
    total: games.length,
    wins,
    draws,
    losses,
    unknown,
    winRate: decided > 0 ? round1((wins / decided) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type ResultFilter = 'all' | 'win' | 'draw' | 'loss';
export type ColorFilter = 'all' | Side;
export type PeriodFilter = 'all' | '7d' | '30d' | '90d' | '365d';

export interface ArchiveFilter {
  result: ResultFilter;
  color: ColorFilter;
  period: PeriodFilter;
}

export const DEFAULT_FILTER: ArchiveFilter = { result: 'all', color: 'all', period: 'all' };

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<Exclude<PeriodFilter, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

/** Inclusive lower bound (epoch ms) for a period filter; 0 for 'all'. */
export function periodStart(period: PeriodFilter, now: number): number {
  if (period === 'all') return 0;
  return now - PERIOD_DAYS[period] * DAY_MS;
}

export function filterGames<T extends { result: ArchiveResult; userColor: Side | null; playedAt: number }>(
  games: readonly T[],
  filter: ArchiveFilter,
  now = Date.now(),
): T[] {
  const start = periodStart(filter.period, now);
  return games.filter(
    (g) =>
      (filter.result === 'all' || g.result === filter.result) &&
      (filter.color === 'all' || g.userColor === filter.color) &&
      g.playedAt >= start,
  );
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

export interface OpeningCount {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

/**
 * Most-played openings (games without a detected opening are skipped).
 * Grouped by name; sorted by games desc, then wins desc, then name asc so the
 * ordering is deterministic.
 */
export function openingCounts(
  games: ReadonlyArray<{ opening: { eco: string | null; name: string } | null; result: ArchiveResult }>,
  limit = 8,
): OpeningCount[] {
  const byName = new Map<string, OpeningCount>();
  for (const g of games) {
    if (!g.opening) continue;
    let entry = byName.get(g.opening.name);
    if (!entry) {
      entry = { name: g.opening.name, eco: g.opening.eco, games: 0, wins: 0, draws: 0, losses: 0 };
      byName.set(g.opening.name, entry);
    }
    entry.games++;
    if (g.result === 'win') entry.wins++;
    else if (g.result === 'draw') entry.draws++;
    else if (g.result === 'loss') entry.losses++;
  }
  return [...byName.values()]
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Trends (time-bucketed averages)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** Epoch ms. */
  t: number;
  value: number;
}

export type TrendBucketSize = 'day' | 'week' | 'month';

export interface TrendBucket {
  /** Bucket start, epoch ms (UTC day / ISO-week Monday / first of month). */
  start: number;
  /** 'YYYY-MM-DD' for day/week buckets, 'YYYY-MM' for month buckets. */
  label: string;
  /** Mean of the bucket's values, one decimal. */
  value: number;
  count: number;
}

/** Floor a timestamp to its UTC bucket start. */
export function bucketStart(t: number, size: TrendBucketSize): number {
  const d = new Date(t);
  if (size === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (size === 'day') return day;
  // week: snap back to Monday (ISO weeks).
  const dow = (new Date(day).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return day - dow * DAY_MS;
}

/** Pick a readable bucket size for a point set's time span. */
export function pickBucketSize(points: readonly TrendPoint[]): TrendBucketSize {
  if (points.length === 0) return 'day';
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.t < min) min = p.t;
    if (p.t > max) max = p.t;
  }
  const spanDays = (max - min) / DAY_MS;
  if (spanDays <= 45) return 'day';
  if (spanDays <= 400) return 'week';
  return 'month';
}

/** Average points per time bucket, chronological. Empty input → []. */
export function bucketTrend(points: readonly TrendPoint[], size: TrendBucketSize): TrendBucket[] {
  const sums = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.value) || !Number.isFinite(p.t)) continue;
    const start = bucketStart(p.t, size);
    const acc = sums.get(start) ?? { sum: 0, count: 0 };
    acc.sum += p.value;
    acc.count++;
    sums.set(start, acc);
  }
  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, { sum, count }]) => ({
      start,
      label: size === 'month' ? new Date(start).toISOString().slice(0, 7) : new Date(start).toISOString().slice(0, 10),
      value: round1(sum / count),
      count,
    }));
}

// ---------------------------------------------------------------------------
// Series extraction
// ---------------------------------------------------------------------------

/** Accuracy points (chronological) from games that have a review. */
export function accuracyPoints(games: ReadonlyArray<{ playedAt: number; accuracy: number | null }>): TrendPoint[] {
  return games
    .filter((g): g is { playedAt: number; accuracy: number } => typeof g.accuracy === 'number' && Number.isFinite(g.accuracy))
    .map((g) => ({ t: g.playedAt, value: g.accuracy }))
    .sort((a, b) => a.t - b.t);
}

/** Move-weighted-free mean accuracy over reviewed games; null when none. */
export function averageAccuracy(games: ReadonlyArray<{ accuracy: number | null }>): number | null {
  const vals = games.map((g) => g.accuracy).filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
  if (vals.length === 0) return null;
  return round1(vals.reduce((s, a) => s + a, 0) / vals.length);
}

/**
 * A ratings-store day-snapshot history → chronological TrendPoints under the
 * chosen meter. Malformed days/snapshots (bad date, non-numeric value) are
 * skipped — synced state can carry entries written by older versions.
 */
export function ratingSeries(
  history: Record<string, { elo: number; glicko: number }> | null | undefined,
  meter: 'elo' | 'glicko',
): TrendPoint[] {
  if (!history) return [];
  const out: TrendPoint[] = [];
  for (const [day, snap] of Object.entries(history)) {
    const t = Date.parse(`${day}T00:00:00Z`);
    const value = snap?.[meter];
    if (!Number.isFinite(t) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    out.push({ t, value });
  }
  return out.sort((a, b) => a.t - b.t);
}
