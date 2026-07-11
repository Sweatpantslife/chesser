/**
 * "Your week in chess" — PURE weekly aggregation over the local stores.
 *
 * Everything here is deterministic over its inputs: `now` is ALWAYS a
 * parameter (no Date.now() / new Date() without an argument inside the
 * aggregation), matching the archiveStats/weakness convention, so the whole
 * report is unit-testable with fixture data and a pinned clock.
 *
 * Week convention: weeks start on LOCAL Monday 00:00 (the same local-calendar
 * convention lib/clock's todayStr uses for streaks/quests), so the recap
 * flips at the same midnight everything else does.
 *
 * Consumers: components/WeeklyReport.tsx gathers the store snapshots, calls
 * {@link buildWeeklyReport}, renders the stats, and shows
 * {@link buildWeeklyNarrative}'s template prose — upgraded to LLM wording via
 * {@link buildWeeklyReportFacts} + lib/coachApi when a key is available.
 */
import type { CoachWeeklyReportFacts } from '@chesser/shared';
import i18n from '../i18n';
import { WEAKNESS_META, type WeaknessKind } from './weakness';

// ---------------------------------------------------------------------------
// Week key / range (deterministic given `now`)
// ---------------------------------------------------------------------------

const DAY_NAMES_IN_WEEK = 7;

/** Local `YYYY-MM-DD` for a Date (same format as lib/clock todayStr). */
function dayKeyOf(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Fallback month names for environments where Intl rejects the active locale.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jul 6"-style short label in the active UI language ('en' ⇒ byte-identical
 *  to the old hand-rolled format, which remains the fallback). */
function shortDayLabel(d: Date): string {
  // The ACTIVE language, not resolvedLanguage: Intl needs no loaded resources,
  // and resolvedLanguage lags on the English fallback until the active
  // locale's lazy chunks land (it only updates when changeLanguage settles).
  const lang = i18n.language || i18n.resolvedLanguage || 'en';
  try {
    return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(d);
  } catch {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
}

export interface WeekRange {
  /** Local Monday 00:00 of the week containing `now` (epoch ms). */
  startMs: number;
  /** Local Monday 00:00 of the NEXT week (exclusive bound, epoch ms). */
  endMs: number;
  /** Monday's local day key — the deterministic week key. */
  startKey: string;
  /** Sunday's local day key (inclusive). */
  endKey: string;
  /** Human label, e.g. "Jul 6 – Jul 12". */
  label: string;
}

/** The local Monday-to-Sunday week containing `now`. */
export function weekRangeOf(now: number): WeekRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday … 6 = Saturday → distance back to Monday.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + DAY_NAMES_IN_WEEK);
  const sunday = new Date(start);
  sunday.setDate(start.getDate() + 6);
  const label = `${shortDayLabel(start)} – ${shortDayLabel(sunday)}`;
  return { startMs: start.getTime(), endMs: end.getTime(), startKey: dayKeyOf(start), endKey: dayKeyOf(sunday), label };
}

/** Deterministic week key (the Monday's local day key) for `now`. */
export function weekKeyOf(now: number): string {
  return weekRangeOf(now).startKey;
}

// ---------------------------------------------------------------------------
// Inputs — minimal structural shapes so fixtures stay small
// ---------------------------------------------------------------------------

export interface WeeklyInputs {
  /** Gamify day logs: local `YYYY-MM-DD` → xp / activity count. */
  days: Record<string, { xp: number; activities: number }>;
  /** Current daily activity streak, as displayed (store/streak current()). */
  streak: number;
  /** Lesson completions: id → first-completion epoch ms + best stars. */
  lessons: Record<string, { ts: number; stars: number }>;
  /** Reviewed-game digests (store/coach): when reviewed, POV result, accuracy, tagged mistakes. */
  games: ReadonlyArray<{
    createdAt: number;
    result: 'win' | 'loss' | 'draw' | 'unknown';
    accuracy: number;
    mistakes: ReadonlyArray<{ kinds: readonly string[] }>;
  }>;
  /** Weakness-training attempts (store/coach trainingLog). */
  training: ReadonlyArray<{ at: number; solved: boolean }>;
  /** Sprint personal bests with the epoch ms each record was set (0 = never). */
  rushBests: ReadonlyArray<{ score: number; at: number }>;
  stormBest: { score: number; at: number };
  /** Puzzle-rating end-of-day snapshots: `YYYY-MM-DD` → elo. */
  puzzleHistory: Record<string, { elo: number }>;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface WeeklyReport {
  weekKey: string;
  label: string;
  activeDays: number;
  xpEarned: number;
  activities: number;
  streak: number;
  games: { played: number; wins: number; losses: number; draws: number; bestAccuracy: number | null };
  lessons: { completed: number; stars: number };
  puzzles: { ratingStart: number | null; ratingEnd: number | null; delta: number | null };
  sprints: { newRushBest: number | null; newStormBest: number | null };
  training: { attempts: number; solved: number };
  weakness: { kind: WeaknessKind | null; label: string | null; count: number };
  /** Anything at all logged this week? (Gates the card's celebratory tone.) */
  hasActivity: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Aggregate one local week (the one containing `now`) from the store snapshots. */
export function buildWeeklyReport(inputs: WeeklyInputs, now: number): WeeklyReport {
  const range = weekRangeOf(now);
  const inWeekMs = (t: number) => t >= range.startMs && t < range.endMs;
  const inWeekKey = (k: string) => k >= range.startKey && k <= range.endKey;

  // Day logs (XP, active days).
  let xpEarned = 0;
  let activities = 0;
  let activeDays = 0;
  for (const [day, log] of Object.entries(inputs.days)) {
    if (!inWeekKey(day)) continue;
    xpEarned += log.xp;
    activities += log.activities;
    if (log.xp > 0 || log.activities > 0) activeDays++;
  }

  // Reviewed games + weakness tally.
  let played = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let bestAccuracy: number | null = null;
  const weaknessCounts = new Map<string, number>();
  for (const g of inputs.games) {
    if (!inWeekMs(g.createdAt)) continue;
    played++;
    if (g.result === 'win') wins++;
    else if (g.result === 'loss') losses++;
    else if (g.result === 'draw') draws++;
    if (bestAccuracy === null || g.accuracy > bestAccuracy) bestAccuracy = round1(g.accuracy);
    for (const m of g.mistakes) {
      for (const kind of m.kinds) weaknessCounts.set(kind, (weaknessCounts.get(kind) ?? 0) + 1);
    }
  }
  // Top weakness: highest count, ties broken by kind for determinism.
  let topKind: string | null = null;
  let topCount = 0;
  for (const [kind, count] of [...weaknessCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    topKind = kind;
    topCount = count;
    break;
  }
  const knownKind = topKind !== null && topKind in WEAKNESS_META ? (topKind as WeaknessKind) : null;

  // Lessons.
  let lessonsCompleted = 0;
  let lessonStars = 0;
  for (const rec of Object.values(inputs.lessons)) {
    if (!inWeekMs(rec.ts)) continue;
    lessonsCompleted++;
    lessonStars += rec.stars;
  }

  // Weakness training.
  let attempts = 0;
  let solved = 0;
  for (const t of inputs.training) {
    if (!inWeekMs(t.at)) continue;
    attempts++;
    if (t.solved) solved++;
  }

  // Sprint records set this week.
  let newRushBest: number | null = null;
  for (const b of inputs.rushBests) {
    if (b.at > 0 && inWeekMs(b.at) && (newRushBest === null || b.score > newRushBest)) newRushBest = b.score;
  }
  const newStormBest = inputs.stormBest.at > 0 && inWeekMs(inputs.stormBest.at) ? inputs.stormBest.score : null;

  // Puzzle rating across the week: last snapshot before the week vs last
  // snapshot inside it. (Snapshot day keys are UTC-based upstream; a one-day
  // skew near midnight is cosmetic — see lib/clock's day-convention note.)
  let ratingStart: number | null = null;
  let ratingEnd: number | null = null;
  for (const day of Object.keys(inputs.puzzleHistory).sort()) {
    const elo = Math.round(inputs.puzzleHistory[day]!.elo);
    if (day < range.startKey) ratingStart = elo;
    else if (day <= range.endKey) ratingEnd = elo;
  }
  const delta = ratingStart !== null && ratingEnd !== null ? ratingEnd - ratingStart : null;

  const hasActivity =
    activeDays > 0 || played > 0 || lessonsCompleted > 0 || attempts > 0 || newRushBest !== null || newStormBest !== null;

  return {
    weekKey: range.startKey,
    label: range.label,
    activeDays,
    xpEarned,
    activities,
    streak: inputs.streak,
    games: { played, wins, losses, draws, bestAccuracy },
    lessons: { completed: lessonsCompleted, stars: lessonStars },
    puzzles: { ratingStart, ratingEnd, delta },
    sprints: { newRushBest, newStormBest },
    training: { attempts, solved },
    // `label` stays the CANONICAL English catalogue label (it feeds the
    // server-validated LLM facts); the narrative below re-resolves the
    // display label from `kind` in the active language.
    weakness: { kind: knownKind, label: knownKind ? WEAKNESS_META[knownKind].label : null, count: topCount },
    hasActivity,
  };
}

// ---------------------------------------------------------------------------
// Rule-based narrative (the report must read well for everyone, key or not)
// ---------------------------------------------------------------------------

/** Template recap prose — 2-4 warm sentences built only from the stats.
 *  Sentences resolve through `insights:weekly.*` at call time (the component
 *  rebuilds the narrative per render, so language switches apply live);
 *  English output is byte-identical to the previous hand-built prose. */
export function buildWeeklyNarrative(r: WeeklyReport): string {
  const t = i18n.getFixedT(null, 'insights');
  if (!r.hasActivity) return t('weekly.quiet');

  const parts: string[] = [];
  const xp = r.xpEarned.toLocaleString();

  if (r.activeDays >= 7) parts.push(t('weekly.allDays', { xp }));
  else if (r.activeDays >= 4) parts.push(t('weekly.mostDays', { days: r.activeDays, xp }));
  else parts.push(t('weekly.someDays', { count: r.activeDays, xp }));

  if (r.games.played > 0) {
    const wdl = t('weekly.wdl', { wins: r.games.wins, losses: r.games.losses, draws: r.games.draws });
    parts.push(
      r.games.bestAccuracy !== null
        ? t('weekly.gamesAccuracy', { count: r.games.played, wdl, accuracy: r.games.bestAccuracy })
        : t('weekly.games', { count: r.games.played, wdl }),
    );
  }

  const puzzleBits: string[] = [];
  if (r.puzzles.delta !== null && r.puzzles.delta !== 0) {
    puzzleBits.push(
      r.puzzles.delta > 0
        ? t('weekly.ratingClimb', { delta: r.puzzles.delta, rating: r.puzzles.ratingEnd })
        : t('weekly.ratingDip', { delta: Math.abs(r.puzzles.delta) }),
    );
  }
  if (r.sprints.newRushBest !== null) puzzleBits.push(t('weekly.newRushBest', { score: r.sprints.newRushBest }));
  if (r.sprints.newStormBest !== null) puzzleBits.push(t('weekly.newStormBest', { score: r.sprints.newStormBest }));
  if (puzzleBits.length > 0) {
    parts.push(t('weekly.puzzleSide', { bits: puzzleBits.join(t('weekly.puzzleJoiner')) }));
  }

  if (r.lessons.completed > 0) {
    parts.push(
      r.lessons.stars > 0
        ? t('weekly.lessonsStars', { count: r.lessons.completed, stars: r.lessons.stars })
        : t('weekly.lessons', { count: r.lessons.completed }),
    );
  }

  if (r.training.attempts > 0) {
    parts.push(t('weekly.training', { solved: r.training.solved, attempts: r.training.attempts }));
  }

  if (r.weakness.kind && r.weakness.count > 0) {
    const label = t(`weaknesses.${r.weakness.kind}.label`).toLowerCase();
    parts.push(t('weekly.watchPattern', { label, count: r.weakness.count }));
  } else if (r.streak > 0) {
    parts.push(t('weekly.streak', { count: r.streak }));
  }

  return parts.slice(0, 5).join(' ');
}

// ---------------------------------------------------------------------------
// LLM facts (BYOK / env-key wording path)
// ---------------------------------------------------------------------------

/** Compact, server-validated facts payload for the coach's wording pass. */
export function buildWeeklyReportFacts(r: WeeklyReport): CoachWeeklyReportFacts {
  return {
    kind: 'weekly_report',
    weekLabel: r.label.slice(0, 40),
    activeDays: Math.min(7, r.activeDays),
    xpEarned: r.xpEarned,
    streak: r.streak,
    gamesPlayed: r.games.played,
    wins: r.games.wins,
    losses: r.games.losses,
    draws: r.games.draws,
    bestAccuracy: r.games.bestAccuracy,
    lessonsCompleted: r.lessons.completed,
    lessonStars: r.lessons.stars,
    puzzleRatingDelta: r.puzzles.delta,
    newRushBest: r.sprints.newRushBest,
    newStormBest: r.sprints.newStormBest,
    trainingAttempts: r.training.attempts,
    trainingSolved: r.training.solved,
    topWeakness: r.weakness.label,
    topWeaknessCount: r.weakness.count,
    ruleBasedText: buildWeeklyNarrative(r).slice(0, 600),
  };
}
