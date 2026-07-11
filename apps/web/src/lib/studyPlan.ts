/**
 * Personalized weekly study plan — PURE, deterministic generation.
 *
 * {@link buildStudyPlan} turns (weakness profile, rating, recent activity,
 * content catalog, clock) into a prioritized weekly plan:
 *
 *  • daily puzzle quotas targeting the top weakness themes ("3 fork puzzles a
 *    day"), served by the coach's theme-matched trainer;
 *  • specific lessons matched to those weaknesses (curated map below, checked
 *    against the real catalogue by the unit tests);
 *  • opening drills from the user's own repertoire, preferring the openings
 *    their reviewed games score worst in;
 *  • 1–2 annotated master games (data/masterGames) matched by theme and at a
 *    difficulty appropriate to the user's rating band.
 *
 * DETERMINISM CONTRACT (mirrors lib/weakness + lib/weeklyReport):
 *  - the clock is ALWAYS the `now` parameter — never Date.now()/new Date()
 *    without an argument in here — so tests pin the week;
 *  - no randomness, and every ordering has an explicit tie-breaker, so the
 *    same inputs produce a byte-identical plan.
 *
 * Prioritization: items are emitted by weakness severity (the profile's
 * ranking) first, alternating kinds for variety within a rank; repertoire
 * drills and master games close the list. Persistence/adaptation lives in
 * store/plan.ts; presentation in pages/StudyPlanPage.tsx.
 */
import i18n from '../i18n';
import { WEAKNESS_META, type WeaknessKind, type WeaknessProfile } from './weakness';
import { weekRangeOf } from './weeklyReport';
import { type GameDifficulty, type GameTheme, type MasterGame } from '../data/masterGames';

// i18n note: item titles/why sentences resolve through `insights:*` at
// GENERATION time (English output is byte-identical to the old template
// strings). The generated plan — including these strings — is persisted by
// store/plan for the week, so a mid-week language switch shows the old
// language until the next regeneration; ids/kinds stay language-neutral.
// store/plan's initPlanTracking re-bakes an UNTOUCHED week's plan when the
// active locale's strings arrive/change, so a fresh non-English session
// doesn't lock in English fallbacks for the week.
const tIns = () => i18n.getFixedT(null, 'insights');

/** Weakness label in the active language (English catalogue label = fallback). */
const weaknessLabel = (kind: WeaknessKind): string =>
  tIns()(`weaknesses.${kind}.label`, { defaultValue: WEAKNESS_META[kind].label });

// ---------------------------------------------------------------------------
// Week identity
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 86_400_000;

/** Monday 00:00 (local) of the week containing `d` — ISO weeks start Monday. */
function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // getDay(): 0 = Sunday
  return m;
}

/**
 * ISO-8601 week id for the injected clock, e.g. `2026-W28`. Uses the LOCAL
 * calendar (same convention as lib/clock todayStr and lib/weeklyReport), so
 * the plan rolls over at the same local Monday midnight as the weekly report.
 */
export function isoWeekIdOf(now: Date): string {
  const monday = mondayOf(now);
  // The ISO year/week of a Monday is decided by its Thursday.
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const isoYear = thursday.getFullYear();
  // Week 1 is the week containing Jan 4 of the ISO year.
  const week1Monday = mondayOf(new Date(isoYear, 0, 4));
  const week = 1 + Math.round((monday.getTime() - week1Monday.getTime()) / WEEK_MS);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** What the user has already done — used to avoid recommending stale content. */
export interface RecentActivity {
  /** Lesson ids already completed (store/lessons `completed` keys). */
  completedLessonIds: readonly string[];
  /** Master-game ids already watched to the end (MastersPage viewed log). */
  viewedMasterGameIds: readonly string[];
}

/** Minimal lesson shape the generator needs (learn/types Lesson satisfies it). */
export interface PlanLessonInfo {
  id: string;
  title: string;
  icon: string;
  summary: string;
}

/** Minimal opening-line shape (store/repertoire RepLine satisfies it). */
export interface PlanOpeningLine {
  id: string;
  name: string;
  side: 'white' | 'black';
  eco?: string;
}

/** The content the plan can draw from — injected so tests control it. */
export interface PlanCatalog {
  lessons: readonly PlanLessonInfo[];
  /** The user's drillable lines, repertoire order (picks → custom → builtin). */
  openingLines: readonly PlanOpeningLine[];
  masterGames: readonly MasterGame[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type PlanItemKind = 'puzzle' | 'lesson' | 'opening' | 'master';

interface PlanItemBase {
  /** Stable id within the week (also the progress-map key), e.g. `puzzle:fork`. */
  id: string;
  kind: PlanItemKind;
  title: string;
  /** One-liner: WHY the plan picked this item (tied to the weakness). */
  why: string;
  /** Units to complete over the week (puzzles: perDay × 7; lessons/games: 1). */
  target: number;
}

export interface PuzzlePlanItem extends PlanItemBase {
  kind: 'puzzle';
  weakness: WeaknessKind;
  /** Lichess-style puzzle themes that train the weakness (WEAKNESS_META). */
  themes: readonly string[];
  /** Daily quota — per-day progress is capped here (store/plan `daily`). */
  perDay: number;
  /** True when the weakness came from the profile → jump to the Coach trainer. */
  viaCoach: boolean;
}

export interface LessonPlanItem extends PlanItemBase {
  kind: 'lesson';
  lessonId: string;
}

export interface OpeningPlanItem extends PlanItemBase {
  kind: 'opening';
  lineId: string;
  lineName: string;
  side: 'white' | 'black';
}

export interface MasterGamePlanItem extends PlanItemBase {
  kind: 'master';
  gameId: string;
}

export type PlanItem = PuzzlePlanItem | LessonPlanItem | OpeningPlanItem | MasterGamePlanItem;

export interface StudyPlan {
  /** ISO week id the plan belongs to (regeneration key), e.g. `2026-W28`. */
  weekId: string;
  /** Human label for the week, e.g. `Jul 6 – Jul 12`. */
  weekLabel: string;
  /** Rating the difficulty decisions used (puzzles decision rating). */
  rating: number;
  /** Rating band → content difficulty (aligned with trainers/tactics bands). */
  band: GameDifficulty;
  /** Weakness kinds the plan focuses on, severity order (≤ 2). */
  focus: WeaknessKind[];
  /** True when the focus came from the user's own reviewed games. */
  personalized: boolean;
  /** Prioritized items: severity first, variety within a rank. */
  items: PlanItem[];
}

// ---------------------------------------------------------------------------
// Tuning tables
// ---------------------------------------------------------------------------

/** Rating → content band (same cut-offs as trainers/tactics difficultyForRating). */
export function ratingBandOf(rating: number): GameDifficulty {
  return rating < 1300 ? 'beginner' : rating < 1800 ? 'intermediate' : 'advanced';
}

/**
 * Lessons that train each weakness, easiest first. Every id is checked
 * against the real catalogue by studyPlan.test.ts, so a renamed lesson fails
 * CI instead of silently dropping out of plans.
 */
export const LESSONS_FOR_WEAKNESS: Record<WeaknessKind, readonly string[]> = {
  hangingPieces: ['rules-capturing', 'skill-value'],
  missedMates: ['skill-mate-kq', 'skill-mate-rooks', 'cm2-anastasia', 'cm2-arabian', 'cm2-smothered'],
  missedForks: ['skill-forks', 'tactics-adv-discovered'],
  missedTactics: ['skill-pins', 'skill-skewers', 'tactics-adv-deflection', 'tactics-adv-decoy', 'tactics-adv-xray'],
  openingMistakes: ['skill-opening', 'positional-weak-squares'],
  endgameMistakes: ['skill-endgame-pawns', 'positional-passed-pawns', 'positional-open-files'],
};

/** Master-game theme that best illustrates each weakness done right. */
export const GAME_THEME_FOR_WEAKNESS: Record<WeaknessKind, GameTheme> = {
  hangingPieces: 'tactics',
  missedMates: 'attack',
  missedForks: 'tactics',
  missedTactics: 'tactics',
  openingMistakes: 'positional',
  endgameMistakes: 'endgame',
};

const BAND_ORDER: readonly GameDifficulty[] = ['beginner', 'intermediate', 'advanced'];

/** Weekly caps that keep the plan doable. */
const MAX_PUZZLE_ITEMS = 2;
const MAX_LESSON_ITEMS = 2;
const MAX_OPENING_ITEMS = 2;
const MAX_MASTER_ITEMS = 2;
/** Each repertoire line is drilled this many times over the week. */
const OPENING_DRILLS_PER_LINE = 3;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Build the week's plan. Pure and deterministic: same inputs (including the
 * injected `now`) ⇒ byte-identical plan. Never reads stores or the wall clock.
 */
export function buildStudyPlan(
  profile: WeaknessProfile,
  rating: number,
  activity: RecentActivity,
  catalog: PlanCatalog,
  now: Date,
): StudyPlan {
  const weekId = isoWeekIdOf(now);
  const weekLabel = weekRangeOf(now.getTime()).label;
  const band = ratingBandOf(rating);
  const personalized = profile.weaknesses.length > 0;

  // — Focus: the profile's top weaknesses, or a sensible phase-aware default —
  const focus: WeaknessKind[] = personalized
    ? profile.weaknesses.slice(0, MAX_PUZZLE_ITEMS).map((w) => w.kind)
    : profile.worstPhase === 'opening'
      ? ['openingMistakes', 'missedTactics']
      : profile.worstPhase === 'endgame'
        ? ['endgameMistakes', 'missedTactics']
        : ['missedTactics', 'hangingPieces'];

  // — Daily puzzle quotas (one per focus kind, severity order) —
  const t = tIns();
  const puzzleItems: PuzzlePlanItem[] = focus.map((kind, i) => {
    const entry = profile.weaknesses.find((w) => w.kind === kind);
    const meta = WEAKNESS_META[kind];
    const label = weaknessLabel(kind);
    // Severity-scaled quota: a heavier weakness earns more daily reps.
    const perDay = entry ? clamp(2 + Math.round(entry.score), 2, 5) : i === 0 ? 3 : 2;
    const why = entry
      ? t('plan.puzzleWhyEntry', { label, count: entry.count, games: entry.games, total: profile.games })
      : profile.worstPhase && (kind === 'openingMistakes' || kind === 'endgameMistakes')
        ? t('plan.puzzleWhyPhase', { phase: t(`phases.${profile.worstPhase}`), label: label.toLowerCase() })
        : t('plan.puzzleWhyDefault', { label: label.toLowerCase() });
    return {
      id: `puzzle:${kind}`,
      kind: 'puzzle',
      title: t('plan.puzzleTitle', { label, count: perDay }),
      why,
      target: perDay * 7,
      weakness: kind,
      themes: meta.puzzleThemes,
      perDay,
      viaCoach: !!entry,
    };
  });

  // — Lessons matched to the focus (skip completed; no duplicates) —
  const lessonById = new Map(catalog.lessons.map((l) => [l.id, l] as const));
  const completed = new Set(activity.completedLessonIds);
  const usedLessons = new Set<string>();
  const lessonItems: LessonPlanItem[] = [];
  for (const [i, kind] of focus.entries()) {
    if (lessonItems.length >= MAX_LESSON_ITEMS) break;
    const pick = LESSONS_FOR_WEAKNESS[kind].find(
      (id) => lessonById.has(id) && !completed.has(id) && !usedLessons.has(id),
    );
    if (!pick) continue;
    usedLessons.add(pick);
    const lesson = lessonById.get(pick)!;
    lessonItems.push({
      id: `lesson:${pick}`,
      kind: 'lesson',
      title: t('plan.lessonTitle', { title: lesson.title }),
      why: t('plan.lessonWhy', { rank: i + 1, label: weaknessLabel(kind).toLowerCase() }),
      target: 1,
      lessonId: pick,
    });
  }

  // — Opening drills: shakiest openings from the profile first, then top-up —
  const usedLines = new Set<string>();
  const openingItems: OpeningPlanItem[] = [];
  const pushLine = (line: PlanOpeningLine, why: string) => {
    usedLines.add(line.id);
    openingItems.push({
      id: `opening:${line.id}`,
      kind: 'opening',
      title: t('plan.openingTitle', { name: line.name }),
      why,
      target: OPENING_DRILLS_PER_LINE,
      lineId: line.id,
      lineName: line.name,
      side: line.side,
    });
  };
  for (const tendency of profile.openings) {
    if (openingItems.length >= MAX_OPENING_ITEMS) break;
    const firstWord = tendency.name.split(/[\s,—-]+/)[0]?.toLowerCase() ?? '';
    const match = catalog.openingLines.find(
      (l) =>
        !usedLines.has(l.id) &&
        ((tendency.eco !== null && l.eco === tendency.eco) ||
          (firstWord.length > 2 && l.name.toLowerCase().includes(firstWord))),
    );
    if (match) {
      pushLine(
        match,
        t('plan.openingWhyTendency', { name: tendency.name, accuracy: tendency.accuracy, games: tendency.games }),
      );
    }
  }
  for (const line of catalog.openingLines) {
    if (openingItems.length >= MAX_OPENING_ITEMS) break;
    if (usedLines.has(line.id)) continue;
    pushLine(line, t('plan.openingWhyRepertoire', { count: OPENING_DRILLS_PER_LINE }));
  }

  // — 1–2 master games: theme-matched, difficulty within one band of rating —
  const wantThemes = focus.map((k) => GAME_THEME_FOR_WEAKNESS[k]);
  const bandIdx = BAND_ORDER.indexOf(band);
  const viewed = new Set(activity.viewedMasterGameIds);
  const scored = catalog.masterGames
    .map((g) => {
      const dist = Math.abs(BAND_ORDER.indexOf(g.difficulty) - bandIdx);
      let score = 0;
      // The primary-focus theme outweighs everything else (an endgame-weak
      // player should see THE endgame classic even a band up).
      if (wantThemes[0] && g.themes.includes(wantThemes[0])) score += 5;
      if (wantThemes[1] && wantThemes[1] !== wantThemes[0] && g.themes.includes(wantThemes[1])) score += 2;
      if (dist === 0) score += 2;
      if (!viewed.has(g.id)) score += 1;
      if (profile.openings.some((o) => o.eco !== null && o.eco === g.eco)) score += 1;
      return { g, dist, score };
    })
    // "appropriate to rating": never more than one band away.
    .filter((c) => c.dist <= 1)
    .sort((a, b) => b.score - a.score || (a.g.id < b.g.id ? -1 : 1));
  const masterItems: MasterGamePlanItem[] = scored.slice(0, MAX_MASTER_ITEMS).map(({ g }) => {
    const matchedTheme = wantThemes.find((theme) => g.themes.includes(theme)) ?? g.themes[0]!;
    return {
      id: `master:${g.id}`,
      kind: 'master',
      title: t('plan.masterTitle', { white: g.white, black: g.black, year: g.year }),
      why: t('plan.masterWhy', {
        difficulty: t(`plan.difficulty.${g.difficulty}`),
        theme: t(`plan.gameThemes.${matchedTheme}`),
      }),
      target: 1,
      gameId: g.id,
    };
  });

  // — Assemble: severity first, alternating kinds for variety within a rank —
  const items: PlanItem[] = [];
  for (let i = 0; i < Math.max(puzzleItems.length, lessonItems.length); i++) {
    if (puzzleItems[i]) items.push(puzzleItems[i]!);
    if (lessonItems[i]) items.push(lessonItems[i]!);
  }
  items.push(...openingItems, ...masterItems);

  return { weekId, weekLabel, rating: Math.round(rating), band, focus, personalized, items };
}

// ---------------------------------------------------------------------------
// Progress arithmetic (pure helpers shared by the store, page and Today card)
// ---------------------------------------------------------------------------

/** Total units the item needs over the week. */
export function itemTarget(item: PlanItem): number {
  return item.target;
}

export interface PlanProgressSummary {
  /** Units done (each capped at its item's target). */
  done: number;
  target: number;
  /** 0–100, rounded. */
  pct: number;
  itemsDone: number;
  itemsTotal: number;
}

/** Week-level progress over the per-item progress map. */
export function planProgress(plan: StudyPlan, progress: Record<string, number>): PlanProgressSummary {
  let done = 0;
  let target = 0;
  let itemsDone = 0;
  for (const item of plan.items) {
    const p = Math.min(progress[item.id] ?? 0, item.target);
    done += p;
    target += item.target;
    if (p >= item.target) itemsDone++;
  }
  return {
    done,
    target,
    pct: target > 0 ? Math.round((done / target) * 100) : 0,
    itemsDone,
    itemsTotal: plan.items.length,
  };
}

export interface TodayItem {
  item: PlanItem;
  /** Units still to do today (quota items) / this week (one-shot items). */
  remaining: number;
}

/**
 * What's left today, plan order: for daily-quota items the unmet part of
 * today's quota (never more than the week has left); for one-shot items the
 * remaining weekly units.
 */
export function remainingToday(
  plan: StudyPlan,
  progress: Record<string, number>,
  daily: Record<string, Record<string, number>>,
  dayKey: string,
): TodayItem[] {
  const out: TodayItem[] = [];
  for (const item of plan.items) {
    const doneWeek = Math.min(progress[item.id] ?? 0, item.target);
    const leftWeek = item.target - doneWeek;
    if (leftWeek <= 0) continue;
    if (item.kind === 'puzzle') {
      const doneToday = daily[item.id]?.[dayKey] ?? 0;
      const leftToday = Math.min(Math.max(0, item.perDay - doneToday), leftWeek);
      if (leftToday > 0) out.push({ item, remaining: leftToday });
    } else {
      out.push({ item, remaining: leftWeek });
    }
  }
  return out;
}
