import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WEAKNESS_META } from '../lib/weakness';
import { planProgress, type PlanItem, type PlanItemKind } from '../lib/studyPlan';
import { planItemPath } from '../lib/decks';
import { initPlanTracking, usePlan } from '../store/plan';
import { bootstrapFromReportCache } from '../store/coach';
import { todayStr } from '../lib/clock';
import { playSound } from '../lib/sound';
import { IconArrowRight, IconCoach, IconSparkles } from '../components/icons';

/**
 * The weekly study plan page (`#/train/plan`): the generated plan grouped by
 * kind, per-item progress with WHY it was picked, jump links into the existing
 * trainer views, manual logging, and a regenerate control (the plan re-reads
 * the latest weakness profile/rating, so it adapts as you improve).
 *
 * The coach's full weakness→drills view lives here too, behind a disclosure —
 * the Train hub strip only surfaces the suggestion. Coach-served puzzle items
 * open that panel (training there is what auto-credits them).
 */

const CoachPage = lazy(() => import('./CoachPage').then((m) => ({ default: m.CoachPage })));

const KIND_ORDER: PlanItemKind[] = ['puzzle', 'lesson', 'opening', 'master'];

/** Icons per plan-item kind; headings/blurbs/CTAs live in the `plan` namespace (kinds.<kind>.*). */
const KIND_ICONS: Record<PlanItemKind, string> = { puzzle: '🧩', lesson: '🎓', opening: '📖', master: '👑' };

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((Math.min(value, max) / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
    >
      <div
        className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500/80' : 'bg-gradient-to-r from-brand-600 to-accent-400'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ItemRow({ item, onCoach }: { item: PlanItem; onCoach: () => void }) {
  const { t } = useTranslation('plan');
  const done = usePlan((s) => Math.min(s.progress[item.id] ?? 0, item.target));
  const doneToday = usePlan((s) => (item.kind === 'puzzle' ? s.daily[item.id]?.[todayStr()] ?? 0 : 0));
  const complete = done >= item.target;
  const quotaMetToday = item.kind === 'puzzle' && doneToday >= item.perDay;
  const viaCoach = item.kind === 'puzzle' && item.viaCoach;

  const ctaClass =
    'btn-press flex min-h-11 items-center gap-1 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700 sm:min-h-9';

  return (
    <li className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg">
              {KIND_ICONS[item.kind]}
            </span>
            <h4 className={`text-sm font-semibold ${complete ? 'text-neutral-400 line-through' : 'text-ink'}`}>
              {item.title}
            </h4>
            {complete && (
              <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs font-semibold text-emerald-300">{t('item.done')}</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">{item.why}</p>
          <div className="mt-2 flex items-center gap-2">
            <Bar value={done} max={item.target} label={t('item.progressAria', { title: item.title })} />
            <span className="shrink-0 text-xs tabular-nums text-neutral-400">
              {done}/{item.target}
              {item.kind === 'puzzle' && (
                <span className={quotaMetToday ? 'text-emerald-400' : ''}>
                  {' · '}
                  {t('item.today', { done: Math.min(doneToday, item.perDay), target: item.perDay })}
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {viaCoach ? (
            // Coach-served quota: training happens in the coach panel below
            // (that flow is what auto-credits this item) — open it in place.
            <button
              onClick={() => {
                playSound('uiClick');
                onCoach();
              }}
              className={ctaClass}
            >
              {t(`kinds.${item.kind}.cta`)}
              <IconArrowRight size={14} />
            </button>
          ) : (
            <Link to={planItemPath(item)} onClick={() => playSound('uiClick')} className={ctaClass}>
              {t(`kinds.${item.kind}.cta`)}
              <IconArrowRight size={14} />
            </Link>
          )}
          {item.kind === 'puzzle' ? (
            <button
              onClick={() => usePlan.getState().logItem(item.id)}
              disabled={complete || quotaMetToday}
              aria-label={t('item.logOneAria', { title: item.title })}
              className="btn-press min-h-11 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-9"
            >
              {t('item.logOne')}
            </button>
          ) : (
            <button
              onClick={() => usePlan.getState().completeItem(item.id)}
              disabled={complete}
              aria-label={t('item.markDoneAria', { title: item.title })}
              className="btn-press min-h-11 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-9"
            >
              {t('item.markDone')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function StudyPlanPage() {
  const { t } = useTranslation(['plan', 'insights']);
  const navigate = useNavigate();
  const plan = usePlan((s) => s.plan);
  const progress = usePlan((s) => s.progress);
  const [coachOpen, setCoachOpen] = useState(false);
  const coachTrigger = useRef<HTMLButtonElement>(null);
  const openCoach = () => {
    setCoachOpen(true);
    coachTrigger.current?.focus();
  };

  useEffect(() => {
    // Back-fill digests from reviews cached before the coach existed, wire the
    // automatic credit subscriptions, then make sure this week's plan exists.
    bootstrapFromReportCache();
    initPlanTracking();
    usePlan.getState().ensurePlan();
  }, []);

  if (!plan) return null;
  const summary = planProgress(plan, progress);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-brand-800/60 via-panel to-panel p-4 shadow-soft sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <IconSparkles size={20} className="text-gold-400" />
          <h2 className="font-display text-xl font-bold text-ink">{t('page.title')}</h2>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300">{plan.weekId}</span>
          <span className="text-xs text-neutral-400">{plan.weekLabel}</span>
          <button
            onClick={() => {
              playSound('uiClick');
              usePlan.getState().regenerate();
            }}
            className="btn-press ml-auto min-h-11 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 sm:min-h-0"
          >
            {t('page.regenerate')}
          </button>
        </div>
        <p className="mt-2 text-sm text-neutral-300">
          {plan.personalized ? (
            <>
              {t('page.personalizedIntro')}{' '}
              {plan.focus.map((k, i) => (
                <span key={k} className="font-semibold text-ink">
                  {i > 0 && ' · '}
                  {WEAKNESS_META[k].icon} {t(`insights:weaknesses.${k}.label`, { defaultValue: WEAKNESS_META[k].label })}
                </span>
              ))}
              {t('page.personalizedOutro')}
            </>
          ) : (
            <>{t('page.starter', { level: t(`difficulty.${plan.band}`) })}</>
          )}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Bar value={summary.done} max={summary.target} label={t('page.weekProgressAria')} />
          <span className="shrink-0 text-xs tabular-nums text-neutral-400">
            {t('page.progressSummary', { pct: summary.pct, done: summary.itemsDone, total: summary.itemsTotal })}
          </span>
        </div>
      </div>

      {/* Coach: the full weakness→drills view, folded behind a disclosure. */}
      <section
        className="rounded-2xl bg-panel p-4 shadow-soft"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && coachOpen) {
            e.stopPropagation();
            setCoachOpen(false);
            coachTrigger.current?.focus();
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-ink">{t('coach.title')}</h3>
            <p className="text-xs text-neutral-400">{t('coach.hint')}</p>
          </div>
          <button
            ref={coachTrigger}
            onClick={() => {
              playSound('uiClick');
              setCoachOpen((o) => !o);
            }}
            aria-expanded={coachOpen}
            aria-controls="plan-coach"
            className="btn-press flex min-h-11 items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink sm:min-h-9"
          >
            <IconCoach size={16} className="text-neutral-400" />
            {t('coach.toggle')}
            <span aria-hidden="true">{coachOpen ? '▴' : '▾'}</span>
          </button>
        </div>
        <div id="plan-coach" hidden={!coachOpen} className="mt-4">
          {coachOpen && (
            <Suspense fallback={null}>
              <CoachPage goPlay={() => navigate('/play')} />
            </Suspense>
          )}
        </div>
      </section>

      {KIND_ORDER.map((kind) => {
        const items = plan.items.filter((i) => i.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-label={t(`kinds.${kind}.heading`)}>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="font-display text-sm font-semibold text-ink">{t(`kinds.${kind}.heading`)}</h3>
              <span className="text-xs text-neutral-400">{t(`kinds.${kind}.blurb`)}</span>
            </div>
            <ul className="space-y-3">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} onCoach={openCoach} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
