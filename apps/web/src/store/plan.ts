import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, { FALLBACK_LANGUAGE } from '../i18n';
import { now, todayStr } from '../lib/clock';
import { awardXP } from '../lib/gamify';
import { buildWeaknessProfile } from '../lib/weakness';
import {
  buildStudyPlan,
  isoWeekIdOf,
  type PlanCatalog,
  type PlanOpeningLine,
  type RecentActivity,
  type StudyPlan,
} from '../lib/studyPlan';
import { ALL_LESSONS } from '../learn';
import { MASTER_GAMES } from '../data/masterGames';
import { catalogLine, catalogOpeningOf } from '../trainers/openingCatalog';
import { useCoach } from './coach';
import { useLessons } from './lessons';
import { useRatings } from './ratings';
import { BUILTIN_REPERTOIRE, useRepertoire } from './repertoire';

/**
 * Study-plan store: persists the CURRENT week's plan plus per-item completion
 * (and per-day counts for the daily puzzle quotas). The plan itself comes from
 * lib/studyPlan's pure generator; this store only decides WHEN to regenerate
 * (ISO-week rollover via ensurePlan, or an explicit user regenerate) and
 * gathers the freshest inputs at that moment — so the plan ADAPTS: as the
 * weakness profile and rating move, the next generation shifts emphasis.
 *
 * Reads coach / ratings / lessons / repertoire strictly read-only (snapshot
 * getters at generation time, subscriptions for auto-credit). All time flows
 * through lib/clock so tests pin the week with setClock.
 */

/** XP for finishing one plan item (passive — the underlying activity already
 *  ticked the streak/goal, mirroring the coach-extras convention). */
export const PLAN_ITEM_XP = 15;
/** One-off bonus when every item of the week's plan is complete. */
export const PLAN_WEEK_BONUS_XP = 40;

/** MastersPage's once-per-game viewed log (read-only here). */
const MASTERS_VIEWED_KEY = 'chesser-masters-viewed';

function viewedMasterGameIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(MASTERS_VIEWED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The user's drillable opening lines: catalog picks → custom lines → builtin. */
function gatherOpeningLines(): PlanOpeningLine[] {
  const rep = useRepertoire.getState();
  const lines: PlanOpeningLine[] = [];
  const seen = new Set<string>();
  const push = (l: PlanOpeningLine) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    lines.push(l);
  };
  for (const id of rep.picked) {
    const l = catalogLine(id);
    const o = catalogOpeningOf(id);
    if (l && o) push({ id: l.id, name: `${o.name} — ${l.name}`, side: l.side, eco: l.eco });
  }
  for (const r of rep.user) for (const l of r.lines) push({ id: l.id, name: l.name, side: l.side, eco: l.eco });
  for (const l of BUILTIN_REPERTOIRE.lines) push({ id: l.id, name: l.name, side: l.side, eco: l.eco });
  return lines;
}

/** Snapshot the live stores into the generator's inputs (read-only). */
function gatherInputs(): {
  profile: ReturnType<typeof buildWeaknessProfile>;
  rating: number;
  activity: RecentActivity;
  catalog: PlanCatalog;
} {
  return {
    profile: buildWeaknessProfile(useCoach.getState().digests()),
    rating: useRatings.getState().decisionRating('puzzles'),
    activity: {
      completedLessonIds: Object.keys(useLessons.getState().completed),
      viewedMasterGameIds: viewedMasterGameIds(),
    },
    catalog: { lessons: ALL_LESSONS, openingLines: gatherOpeningLines(), masterGames: MASTER_GAMES },
  };
}

interface PlanData {
  plan: StudyPlan | null;
  /** itemId → units done this week (capped at the item's target). */
  progress: Record<string, number>;
  /** itemId → local day key → units done that day (daily-quota items only). */
  daily: Record<string, Record<string, number>>;
  /** itemId → completion XP already paid this week. */
  rewarded: Record<string, boolean>;
  /** All-items-done bonus already paid this week. */
  weekRewarded: boolean;
  generatedAt: number;
  /** Language the plan's strings actually resolved in at generation time
   *  (lib/studyPlan bakes them in). When this trails the active language and
   *  the week is still untouched, initPlanTracking re-bakes the plan. */
  planLang: string;
}

interface PlanState extends PlanData {
  /** The current week's plan, generating (or regenerating on ISO-week
   *  rollover) from the latest store snapshots when needed. */
  ensurePlan(): StudyPlan;
  /** Force a fresh plan from the latest profile/rating (user tapped 🔄). */
  regenerate(): StudyPlan;
  /** +1 unit on an item (daily-quota items: counts toward TODAY, capped at
   *  the item's perDay). Pays completion XP when the item finishes. */
  logItem(itemId: string): void;
  /** Mark a one-shot item fully done (lesson watched, game studied…). */
  completeItem(itemId: string): void;
  reset(): void;
}

const initialData = (): PlanData => ({
  plan: null,
  progress: {},
  daily: {},
  rewarded: {},
  weekRewarded: false,
  generatedAt: 0,
  planLang: '',
});

/** The language buildStudyPlan's strings will actually resolve in right now:
 *  the active language if its `insights` bundle is loaded (English is bundled
 *  eagerly; other locales stream in), else the English fallback. */
function bakeLanguage(): string {
  const lng = i18n.language || FALLBACK_LANGUAGE;
  return lng === FALLBACK_LANGUAGE || i18n.hasResourceBundle(lng, 'insights') ? lng : FALLBACK_LANGUAGE;
}

export const usePlan = create<PlanState>()(
  persist(
    (set, get) => {
      /** Pay the per-item (and possibly week) completion bonus exactly once. */
      const payRewards = (itemId: string) => {
        const s = get();
        if (s.rewarded[itemId]) return;
        set({ rewarded: { ...s.rewarded, [itemId]: true } });
        awardXP('coach', PLAN_ITEM_XP, { countsAsActivity: false });
        const after = get();
        if (
          after.plan &&
          !after.weekRewarded &&
          after.plan.items.every((i) => (after.progress[i.id] ?? 0) >= i.target)
        ) {
          set({ weekRewarded: true });
          awardXP('coach', PLAN_WEEK_BONUS_XP, { countsAsActivity: false });
        }
      };

      return {
        ...initialData(),

        ensurePlan() {
          const cur = get().plan;
          if (cur && cur.weekId === isoWeekIdOf(new Date(now()))) return cur;
          return get().regenerate();
        },

        regenerate() {
          const { profile, rating, activity, catalog } = gatherInputs();
          const plan = buildStudyPlan(profile, rating, activity, catalog, new Date(now()));
          set({ ...initialData(), plan, generatedAt: now(), planLang: bakeLanguage() });
          return plan;
        },

        logItem(itemId) {
          const plan = get().ensurePlan();
          const item = plan.items.find((i) => i.id === itemId);
          if (!item) return;
          const cur = get().progress[itemId] ?? 0;
          if (cur >= item.target) return;
          if (item.kind === 'puzzle') {
            const day = todayStr();
            const forItem = get().daily[itemId] ?? {};
            const doneToday = forItem[day] ?? 0;
            if (doneToday >= item.perDay) return; // today's quota already met
            set({ daily: { ...get().daily, [itemId]: { ...forItem, [day]: doneToday + 1 } } });
          }
          const next = Math.min(item.target, cur + 1);
          set({ progress: { ...get().progress, [itemId]: next } });
          if (next >= item.target) payRewards(itemId);
        },

        completeItem(itemId) {
          const plan = get().ensurePlan();
          const item = plan.items.find((i) => i.id === itemId);
          if (!item) return;
          if ((get().progress[itemId] ?? 0) >= item.target) return;
          set({ progress: { ...get().progress, [itemId]: item.target } });
          payRewards(itemId);
        },

        reset() {
          set(initialData());
        },
      };
    },
    { name: 'chesser-plan' },
  ),
);

// ---------------------------------------------------------------------------
// Auto-credit: watch the coach / lessons stores (read-only) so training done
// in the normal flows ticks the plan without any extra taps.
// ---------------------------------------------------------------------------

let wired = false;

/**
 * Wire the plan's automatic progress tracking once per session:
 *  • a SOLVED coach "train this weakness" attempt (store/coach trainingLog)
 *    counts toward the matching daily puzzle-quota item;
 *  • completing a lesson (store/lessons) completes the matching lesson item.
 * Manual logging via the Study Plan page's buttons keeps working regardless.
 */
export function initPlanTracking(): void {
  if (wired) return;
  wired = true;

  // Language re-bake: plan strings are resolved at GENERATION time and
  // persisted (see lib/studyPlan's i18n note). Non-English locales load
  // lazily, so the first ensurePlan of a fresh es/fr session can run before
  // the locale's strings exist and bake English in for the whole week. While
  // the week is UNTOUCHED (no progress) regenerate whenever the active
  // language's strings become available (or the user switches language) —
  // deterministic inputs make this invisible apart from the language. Once
  // progress exists, the documented "old language until the next
  // regeneration" trade-off applies.
  const rebakeForLanguage = () => {
    const s = usePlan.getState();
    if (!s.plan || s.planLang === bakeLanguage()) return;
    if (bakeLanguage() !== (i18n.language || FALLBACK_LANGUAGE)) return; // strings not loaded yet — 'loaded' re-fires
    if (Object.keys(s.progress).length > 0) return;
    s.regenerate();
  };
  i18n.on('languageChanged', rebakeForLanguage);
  i18n.on('loaded', rebakeForLanguage);
  rebakeForLanguage();

  useCoach.subscribe((s, prev) => {
    const added = s.trainingLog.length - prev.trainingLog.length;
    if (added <= 0) return;
    const plan = usePlan.getState().plan;
    if (!plan) return;
    for (const attempt of s.trainingLog.slice(-added)) {
      if (!attempt.solved) continue;
      const item = plan.items.find((i) => i.kind === 'puzzle' && i.weakness === attempt.kind);
      if (item) usePlan.getState().logItem(item.id);
    }
  });

  useLessons.subscribe((s, prev) => {
    if (s.completed === prev.completed) return;
    const plan = usePlan.getState().plan;
    if (!plan) return;
    for (const id of Object.keys(s.completed)) {
      if (prev.completed[id]) continue;
      const item = plan.items.find((i) => i.kind === 'lesson' && i.lessonId === id);
      if (item) usePlan.getState().completeItem(item.id);
    }
  });
}
