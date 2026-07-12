import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { remainingToday, type PlanItem } from '../lib/studyPlan';
import { initPlanTracking, usePlan } from '../store/plan';
import { useReviewSummary } from '../lib/decks';
import { todayStr } from '../lib/clock';
import { viewPath } from '../app/paths';
import { playSound } from '../lib/sound';
import { IconArrowRight } from './icons';

/**
 * The Home hero CTA — the page's SINGLE accent-colored action ("what should I
 * do right now"): the next item of this week's study plan, or the daily
 * puzzle when there is no plan / nothing left today. Deep-links into Train
 * (or the item's own trainer) via the same view-id mapping the Study Plan
 * page uses.
 *
 * Lazily loaded from HomePage: store/plan statically drags in the plan
 * generator and its whole content catalogue (same reason PlanCard is lazy),
 * and lib/decks drags in every trainer's item registry.
 */

const KIND_ICONS: Record<PlanItem['kind'], string> = { puzzle: '🧩', lesson: '🎓', opening: '📖', master: '👑' };

/** Where the hero jumps for a plan item (mirrors StudyPlanPage's jumpTarget). */
function heroPath(item: PlanItem): string {
  switch (item.kind) {
    case 'puzzle':
      return viewPath(item.viaCoach ? 'coach' : 'tactics');
    case 'lesson':
      return viewPath('learn');
    case 'opening':
      return viewPath('openings');
    case 'master':
      return viewPath('masters');
  }
}

export function HomeHero(): JSX.Element {
  const { t } = useTranslation(['home', 'plan']);
  const plan = usePlan((s) => s.plan);
  const progress = usePlan((s) => s.progress);
  const daily = usePlan((s) => s.daily);

  useEffect(() => {
    initPlanTracking();
    usePlan.getState().ensurePlan();
  }, []);

  const next = plan ? (remainingToday(plan, progress, daily, todayStr())[0] ?? null) : null;

  const to = next ? heroPath(next.item) : '/train/tactics?daily=1';
  const icon = next ? KIND_ICONS[next.item.kind] : '🧩';
  const title = next ? next.item.title : t('home:daily.title');
  const body = next
    ? next.item.kind === 'puzzle'
      ? t('plan:card.leftToday', { count: next.remaining })
      : next.item.why
    : t('home:daily.body');
  const cta = next ? t(`plan:kinds.${next.item.kind}.cta`) : t('home:daily.cta');

  return (
    <Link
      to={to}
      data-testid="home-hero"
      onClick={() => playSound('uiClick')}
      className="btn-press card-lift group block rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 p-4 text-white shadow-glow sm:p-5"
    >
      <span className="flex items-center gap-3.5">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-white">{t('home:heroCard.kicker')}</span>
          <span className="line-clamp-2 font-display text-lg font-bold">{title}</span>
          <span className="block truncate text-xs text-white/90">{body}</span>
        </span>
        <span className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-white/15 px-4 py-1.5 text-sm font-bold group-hover:bg-white/25">
          {cta}
          <IconArrowRight size={14} />
        </span>
      </span>
    </Link>
  );
}

/**
 * Review-due count for the Home summary strip — reads the same
 * {@link useReviewSummary} aggregate as Profile Progress and the Train cards
 * (the single SRS source), which is why it lives in this lazy module.
 */
export function ReviewDueCount(): JSX.Element {
  const { t } = useTranslation('home');
  const { totalDue } = useReviewSummary();
  return <span data-testid="home-due-count">{t('strip.due', { count: totalDue })}</span>;
}
