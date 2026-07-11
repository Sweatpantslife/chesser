import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { planProgress, remainingToday } from '../lib/studyPlan';
import { initPlanTracking, usePlan } from '../store/plan';
import { todayStr } from '../lib/clock';
import { playSound } from '../lib/sound';
import { IconArrowRight } from '../components/icons';

/**
 * Compact "This week's plan" card for the Today page: today's remaining plan
 * items (daily quotas + unfinished one-shots) and the week's overall
 * progress, linking to the full Study Plan page.
 */
export function PlanCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('plan');
  const plan = usePlan((s) => s.plan);
  const progress = usePlan((s) => s.progress);
  const daily = usePlan((s) => s.daily);

  useEffect(() => {
    initPlanTracking();
    usePlan.getState().ensurePlan();
  }, []);

  if (!plan) return null;
  const summary = planProgress(plan, progress);
  const left = remainingToday(plan, progress, daily, todayStr());

  return (
    <div className="card-lift rounded-2xl bg-panel p-4 shadow-soft">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-2xl">
          🗓️
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{t('card.title')}</div>
          <div className="truncate text-xs text-neutral-400">
            {t('card.subtitle', { weekLabel: plan.weekLabel, done: summary.itemsDone, total: summary.itemsTotal })}
          </div>
        </div>
        <button
          onClick={() => {
            playSound('uiClick');
            onOpen();
          }}
          className="btn-press flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          {t('card.open')}
          <IconArrowRight size={14} />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summary.target}
          aria-valuenow={summary.done}
          aria-label={t('card.progressAria')}
          className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
        >
          <div
            className={`h-full rounded-full ${summary.pct >= 100 ? 'bg-emerald-500/80' : 'bg-gradient-to-r from-brand-600 to-accent-400'}`}
            style={{ width: `${summary.pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-neutral-400">{summary.pct}%</span>
      </div>
      {left.length === 0 ? (
        <p className="mt-2 text-xs text-emerald-400">{t('card.allCaughtUp')}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs text-neutral-300">
          {left.slice(0, 3).map(({ item, remaining }) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span className="truncate">
                {item.title}
                {item.kind === 'puzzle' && <span className="text-neutral-400"> — {t('card.leftToday', { count: remaining })}</span>}
              </span>
            </li>
          ))}
          {left.length > 3 && <li className="text-neutral-400">{t('card.more', { count: left.length - 3 })}</li>}
        </ul>
      )}
    </div>
  );
}
