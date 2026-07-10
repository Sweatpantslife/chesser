/**
 * Deterministic week keys for the weekly leaderboards.
 *
 * ISO-8601 week numbering over UTC: weeks run Monday→Sunday and week 1 is the
 * week containing the year's first Thursday. UTC (not server-local time) keeps
 * the key canonical — every instance, test and client sees the same bucket for
 * the same instant. Pure functions of an epoch-ms input; callers inject time
 * (see ./clock.ts), so no bare Date.now() lives in shared logic.
 */

const DAY_MS = 86_400_000;

/** ISO week-year and week number (UTC) for an epoch-ms instant. */
export function isoWeek(ms: number): { year: number; week: number } {
  // Algorithm: shift to the Thursday of this week, whose calendar year is the
  // ISO week-year; week number = 1 + whole weeks since that year's first Thursday.
  const d = new Date(ms);
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (4 - day) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday - jan1) / DAY_MS / 7) + 1;
  return { year, week };
}

/** Canonical week bucket key, e.g. "2026-W28". Sorts lexicographically. */
export function isoWeekKey(ms: number): string {
  const { year, week } = isoWeek(ms);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** True when `key` looks like a week key this module could have produced. */
export function isWeekKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-W\d{2}$/.test(v);
}
