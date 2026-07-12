/**
 * The Train hub's "Coach & Plan" strip: ONE line combining this week's plan
 * progress with the coach's top suggestion, plus the page's single hero
 * "Continue" CTA (the only accent-coloured, `.shadow-glow` element on the
 * landing) deep-linking to the next plan item's trainer.
 *
 * Lazy by design (default export, `React.lazy` in TrainHub): the plan store
 * statically imports the lesson/master-game/opening catalogues, which must
 * stay out of the app-shell chunk. The full weakness→drills coach view lives
 * on `#/train/plan` (see StudyPlanPage); this strip only surfaces the
 * suggestion from the stores. When game review has saved mistake cards the
 * coach also surfaces the Mistakes drill (`#/train/tactics/mistakes`) as a
 * quiet neutral link — spec: "Mistakes is also surfaced by Coach when
 * relevant".
 *
 * Empty state (no plan started AND no coach suggestion): one quiet neutral
 * row — no hero styling, no accent, never a big empty panel.
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buildWeaknessProfile, WEAKNESS_META } from '../lib/weakness';
import { isoWeekIdOf, planProgress, remainingToday, type PlanItem } from '../lib/studyPlan';
import { planItemPath } from '../lib/decks';
import { usePlan } from '../store/plan';
import { useCoach } from '../store/coach';
import { useMistakes } from '../store/mistakes';
import { now, todayStr } from '../lib/clock';
import { playSound } from '../lib/sound';
import { IconSparkles } from '../components/icons';

export default function CoachPlanStrip() {
  const { t } = useTranslation(['nav', 'insights']);
  const plan = usePlan((s) => s.plan);
  const progress = usePlan((s) => s.progress);
  const daily = usePlan((s) => s.daily);
  const games = useCoach((s) => s.games);
  // "Mistakes is also surfaced by Coach when relevant": once game review has
  // saved mistake cards, the coach offers the Mistakes drill as a quiet link.
  const mistakeCount = useMistakes((s) => s.cards.length);

  // Roll a stale (previous-week) plan over, but never create a FIRST plan
  // here — the quiet empty row below stays honest until the user starts one.
  const stale = !!plan && plan.weekId !== isoWeekIdOf(new Date(now()));
  useEffect(() => {
    if (stale) usePlan.getState().ensurePlan();
  }, [stale]);

  const profile = useMemo(() => buildWeaknessProfile(Object.values(games)), [games]);
  const focus = profile.weaknesses[0] ?? null;
  const suggestion = focus
    ? t(`insights:weaknesses.${focus.kind}.label`, { defaultValue: WEAKNESS_META[focus.kind].label })
    : null;

  const activePlan = plan && !stale ? plan : null;
  const summary = activePlan ? planProgress(activePlan, progress) : null;
  // Next up: today's first remaining item, else the week's first open item.
  const next: PlanItem | null = activePlan
    ? remainingToday(activePlan, progress, daily, todayStr())[0]?.item ??
      activePlan.items.find((i) => (progress[i.id] ?? 0) < i.target) ??
      null
    : null;

  if (!activePlan && !suggestion) {
    return (
      <section
        aria-label={t('coachStrip.title')}
        data-testid="coach-plan-strip-empty"
        className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-sm text-neutral-400"
      >
        <span>{t('coachStrip.empty')}</span>
        <Link
          to="/train/plan"
          onClick={() => playSound('uiClick')}
          className="font-semibold text-neutral-300 underline decoration-neutral-600 underline-offset-4 hover:text-ink"
        >
          {t('coachStrip.viewPlan')}
        </Link>
        {mistakeCount > 0 && (
          <Link
            to="/train/tactics/mistakes"
            onClick={() => playSound('uiClick')}
            data-testid="coach-plan-mistakes"
            className="font-semibold text-neutral-300 underline decoration-neutral-600 underline-offset-4 hover:text-ink"
          >
            {t('coachStrip.mistakes', { count: mistakeCount })}
          </Link>
        )}
      </section>
    );
  }

  return (
    <section aria-label={t('coachStrip.title')} data-testid="coach-plan-strip" className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-4">
        <p className="min-w-0 flex-1 basis-60 text-sm text-neutral-300">
          {summary && (
            <span className="font-semibold text-ink">
              {t('coachStrip.progress', { done: summary.itemsDone, total: summary.itemsTotal })}
            </span>
          )}
          {summary && suggestion && <span aria-hidden="true"> · </span>}
          {suggestion && <span>{t('coachStrip.suggests', { focus: suggestion })}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={next ? planItemPath(next) : '/train/plan'}
            onClick={() => playSound('uiClick')}
            data-testid="coach-plan-continue"
            className="btn-press flex min-h-11 items-center gap-1.5 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 px-4 py-1.5 text-sm font-bold text-white shadow-glow sm:min-h-9"
          >
            <IconSparkles size={16} className="text-white/85" />
            {t('coachStrip.continue')}
          </Link>
          <Link
            to="/train/plan"
            onClick={() => playSound('uiClick')}
            className="btn-press flex min-h-11 items-center rounded-full px-3 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-800 hover:text-ink sm:min-h-9"
          >
            {t('coachStrip.viewPlan')}
          </Link>
          {mistakeCount > 0 && (
            <Link
              to="/train/tactics/mistakes"
              onClick={() => playSound('uiClick')}
              data-testid="coach-plan-mistakes"
              className="btn-press flex min-h-11 items-center rounded-full px-3 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-800 hover:text-ink sm:min-h-9"
            >
              {t('coachStrip.mistakes', { count: mistakeCount })}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
