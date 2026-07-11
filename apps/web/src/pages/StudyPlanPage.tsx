import { useEffect } from 'react';
import { WEAKNESS_META } from '../lib/weakness';
import { DIFFICULTY_LABELS } from '../data/masterGames';
import { planProgress, type PlanItem, type PlanItemKind } from '../lib/studyPlan';
import { initPlanTracking, usePlan } from '../store/plan';
import { bootstrapFromReportCache } from '../store/coach';
import { todayStr } from '../lib/clock';
import { playSound } from '../lib/sound';
import { IconArrowRight, IconSparkles } from '../components/icons';

/**
 * The weekly study plan page: the generated plan grouped by kind, per-item
 * progress with WHY it was picked, jump buttons into the existing trainer
 * views, manual logging, and a regenerate control (the plan re-reads the
 * latest weakness profile/rating, so it adapts as you improve).
 */

export type PlanTarget = 'coach' | 'tactics' | 'learn' | 'openings' | 'masters';

const KIND_ORDER: PlanItemKind[] = ['puzzle', 'lesson', 'opening', 'master'];

const KIND_META: Record<PlanItemKind, { heading: string; blurb: string; icon: string; cta: string }> = {
  puzzle: { heading: 'Daily puzzles', blurb: 'quota resets each day — solved coach drills count automatically', icon: '🧩', cta: 'Train' },
  lesson: { heading: 'Lessons', blurb: 'finishing the lesson checks it off automatically', icon: '🎓', cta: 'Learn' },
  opening: { heading: 'Opening drills', blurb: 'recall reps from your own repertoire', icon: '📖', cta: 'Drill' },
  master: { heading: 'Master games', blurb: 'annotated classics matched to your focus', icon: '👑', cta: 'Watch' },
};

/** Where an item's Jump button lands (view-level, like the SRS deck targets). */
function jumpTarget(item: PlanItem): PlanTarget {
  switch (item.kind) {
    case 'puzzle':
      return item.viaCoach ? 'coach' : 'tactics';
    case 'lesson':
      return 'learn';
    case 'opening':
      return 'openings';
    case 'master':
      return 'masters';
  }
}

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

function ItemRow({ item, go }: { item: PlanItem; go: (v: PlanTarget) => void }) {
  const done = usePlan((s) => Math.min(s.progress[item.id] ?? 0, item.target));
  const doneToday = usePlan((s) => (item.kind === 'puzzle' ? s.daily[item.id]?.[todayStr()] ?? 0 : 0));
  const complete = done >= item.target;
  const quotaMetToday = item.kind === 'puzzle' && doneToday >= item.perDay;

  return (
    <li className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg">
              {KIND_META[item.kind].icon}
            </span>
            <h4 className={`text-sm font-semibold ${complete ? 'text-neutral-400 line-through' : 'text-ink'}`}>
              {item.title}
            </h4>
            {complete && (
              <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs font-semibold text-emerald-300">✓ done</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">{item.why}</p>
          <div className="mt-2 flex items-center gap-2">
            <Bar value={done} max={item.target} label={`${item.title} — weekly progress`} />
            <span className="shrink-0 text-xs tabular-nums text-neutral-400">
              {done}/{item.target}
              {item.kind === 'puzzle' && (
                <span className={quotaMetToday ? 'text-emerald-400' : ''}> · today {Math.min(doneToday, item.perDay)}/{item.perDay}</span>
              )}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => {
              playSound('uiClick');
              go(jumpTarget(item));
            }}
            className="btn-press flex min-h-11 items-center gap-1 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700 sm:min-h-0"
          >
            {KIND_META[item.kind].cta}
            <IconArrowRight size={14} />
          </button>
          {item.kind === 'puzzle' ? (
            <button
              onClick={() => usePlan.getState().logItem(item.id)}
              disabled={complete || quotaMetToday}
              aria-label={`Log one solved puzzle toward "${item.title}"`}
              className="btn-press min-h-11 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-0"
            >
              +1 today
            </button>
          ) : (
            <button
              onClick={() => usePlan.getState().completeItem(item.id)}
              disabled={complete}
              aria-label={`Mark "${item.title}" as done`}
              className="btn-press min-h-11 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-0"
            >
              Mark done
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function StudyPlanPage({ go }: { go: (v: PlanTarget) => void }) {
  const plan = usePlan((s) => s.plan);
  const progress = usePlan((s) => s.progress);

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
          <h2 className="font-display text-xl font-bold text-ink">This week's study plan</h2>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300">{plan.weekId}</span>
          <span className="text-xs text-neutral-400">{plan.weekLabel}</span>
          <button
            onClick={() => {
              playSound('uiClick');
              usePlan.getState().regenerate();
            }}
            className="btn-press ml-auto min-h-11 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 sm:min-h-0"
          >
            ↻ Regenerate
          </button>
        </div>
        <p className="mt-2 text-sm text-neutral-300">
          {plan.personalized ? (
            <>
              Built from your reviewed games — this week's focus:{' '}
              {plan.focus.map((k, i) => (
                <span key={k} className="font-semibold text-ink">
                  {i > 0 && ' · '}
                  {WEAKNESS_META[k].icon} {WEAKNESS_META[k].label}
                </span>
              ))}
              . Regenerate any time — the plan re-reads your latest profile and rating.
            </>
          ) : (
            <>
              A starter week at {DIFFICULTY_LABELS[plan.band].toLowerCase()} level. Play and review games on the Play tab
              and the plan will re-target your actual weaknesses.
            </>
          )}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Bar value={summary.done} max={summary.target} label="Week progress" />
          <span className="shrink-0 text-xs tabular-nums text-neutral-400">
            {summary.pct}% · {summary.itemsDone}/{summary.itemsTotal} items
          </span>
        </div>
      </div>

      {KIND_ORDER.map((kind) => {
        const items = plan.items.filter((i) => i.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-label={KIND_META[kind].heading}>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="font-display text-sm font-semibold text-ink">{KIND_META[kind].heading}</h3>
              <span className="text-xs text-neutral-400">{KIND_META[kind].blurb}</span>
            </div>
            <ul className="space-y-3">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} go={go} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
