import { useGamify, levelProgress } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useLessons } from '../store/lessons';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useSprints } from '../store/sprints';
import { isDue } from '../lib/srs';
import { now } from '../lib/clock';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { LESSON_META } from '../learn/meta';
import { DailyQuests } from '../components/DailyQuests';
import { DailyGoal } from '../components/DailyGoal';
// Lazy: the plan card drags in the study-plan generator and its whole
// catalogue (annotated master games + the opening catalog). It already
// renders null until the plan store hydrates on mount, so deferring the
// chunk adds no extra layout shift.
const PlanCard = lazy(() => import('../components/PlanCard').then((m) => ({ default: m.PlanCard })));
import { WeeklyReportCard } from '../components/WeeklyReport';
import { StreakFlame, IconArrowRight } from '../components/icons';
import mascotUrl from '../assets/img/mascot.svg';

/**
 * The "Today" page — the daily landing spot. Pulls the whole retention loop
 * into one glance: streak + freezes, level/XP, the daily quest slate, the
 * daily goal ring, and one-tap entries into the daily puzzle, the next
 * lesson, and a game.
 */

export type HomeTarget = 'play' | 'learn' | 'tactics' | 'profile' | 'openings' | 'plan';

function greetingKey(): 'midnight' | 'morning' | 'afternoon' | 'evening' {
  const h = new Date(now()).getHours();
  if (h < 5) return 'midnight';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function Hero({ onProfile }: { onProfile: () => void }) {
  const { t } = useTranslation('home');
  const xp = useGamify((s) => s.xp);
  const streak = useStreak((s) => s.current());
  const freezes = useStreak((s) => s.freezes);
  const atRisk = useStreak((s) => s.atRisk());
  const { level, toNext, pct } = levelProgress(xp);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-800/60 via-panel to-panel p-4 shadow-soft sm:p-5">
      <img src={mascotUrl} alt="" className="float-soft pointer-events-none absolute bottom-1 right-2 hidden h-24 w-24 md:block" />
      <div className="flex flex-wrap items-center gap-4 md:pr-28">
        <div className="flex items-center gap-3">
          <StreakFlame size={44} lit={streak > 0} animate={streak > 0} />
          <div>
            <div className="font-display text-2xl font-bold leading-none text-ink">
              {streak} <span className="text-sm font-semibold text-neutral-400">{t('hero.dayUnit', { count: streak })}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-400" title={t('hero.freezeTitle')}>
              {t('hero.freezesBanked', { count: freezes })}
            </div>
          </div>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-display font-semibold text-ink">{t(`hero.greeting.${greetingKey()}`)}!</span>
            {/* -my keeps the baseline row compact while min-h-8 keeps the tap target ≥24px (WCAG 2.5.8). */}
            <button
              onClick={onProfile}
              className="btn-press -my-1 flex min-h-8 items-center text-xs font-semibold text-brand-300 hover:text-brand-200"
            >
              {t('hero.levelXp', { level, xp: xp.toLocaleString() })}
            </button>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-accent-400 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-neutral-400">
            {t('hero.toNextLevel', { xp: toNext, level: level + 1 })}
          </div>
          <p className={`mt-1 text-xs ${atRisk ? 'text-gold-400' : 'text-neutral-400'}`}>
            {atRisk ? t('hero.streakAtRisk') : streak > 0 ? t('hero.streakKeepAlive') : t('hero.streakStart')}
          </p>
        </div>
      </div>
    </div>
  );
}

function ActionCard(props: { icon: string; title: string; body: string; cta: string; onClick: () => void }) {
  return (
    <div className="card-lift flex items-center gap-3 rounded-2xl bg-panel p-4 shadow-soft">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-2xl">{props.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{props.title}</div>
        <div className="truncate text-xs text-neutral-400">{props.body}</div>
      </div>
      <button
        onClick={props.onClick}
        className="btn-press flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
      >
        {props.cta}
        <IconArrowRight size={14} />
      </button>
    </div>
  );
}

/** Two-CTA entry card for the timed sprint modes, showing current bests. */
function SprintCard({ onSprint }: { onSprint: (mode: 'rush' | 'storm') => void }) {
  const { t } = useTranslation('home');
  const rushBest = useSprints((s) => Math.max(s.puzzleRushBest.timed3.score, s.puzzleRushBest.survival.score));
  const stormBest = useSprints((s) => s.puzzleStormBest.score);
  return (
    <div className="card-lift flex items-center gap-3 rounded-2xl bg-panel p-4 shadow-soft">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-2xl">⚡</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{t('sprints.title')}</div>
        <div className="truncate text-xs text-neutral-400">
          {t('sprints.body')}
          {rushBest > 0 || stormBest > 0
            ? ` ${t('sprints.bests', { rush: rushBest, storm: stormBest })}`
            : ` ${t('sprints.firstRecord')}`}
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={() => onSprint('rush')}
          className="btn-press rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          {t('sprints.rush')}
        </button>
        <button
          onClick={() => onSprint('storm')}
          className="btn-press rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          {t('sprints.storm')}
        </button>
      </div>
    </div>
  );
}

export function HomePage({
  go,
  onDailyPuzzle,
  onSprint,
}: {
  go: (v: HomeTarget) => void;
  onDailyPuzzle: () => void;
  onSprint: (mode: 'rush' | 'storm') => void;
}) {
  const { t } = useTranslation('home');
  const completed = useLessons((s) => s.completed);
  const nextLesson = LESSON_META.find((l) => !(l.id in completed));
  // Opening lines due for spaced-repetition review today (any repertoire).
  const openingsDue = useProgress((s) => {
    const t = now();
    return Object.entries(s.cards).filter(([k, c]) => k.startsWith('openings:') && c.last > 0 && isDue(c, t)).length;
  });
  const pickedCount = useRepertoire((s) => s.picked.length);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <Hero onProfile={() => go('profile')} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DailyQuests />
        <div className="space-y-4">
          <Suspense fallback={null}>
            <PlanCard onOpen={() => go('plan')} />
          </Suspense>
          <DailyGoal />
          <ActionCard
            icon="🧩"
            title={t('daily.title')}
            body={t('daily.body')}
            cta={t('daily.cta')}
            onClick={onDailyPuzzle}
          />
          <SprintCard onSprint={onSprint} />
          <ActionCard
            icon="📖"
            title={
              openingsDue > 0
                ? t('openings.dueTitle', { count: openingsDue })
                : pickedCount > 0
                  ? t('openings.caughtUpTitle')
                  : t('openings.startTitle')
            }
            body={
              openingsDue > 0
                ? t('openings.dueBody')
                : pickedCount > 0
                  ? t('openings.caughtUpBody')
                  : t('openings.startBody')
            }
            cta={openingsDue > 0 ? t('openings.ctaReview') : pickedCount > 0 ? t('openings.ctaTrain') : t('openings.ctaBuild')}
            onClick={() => go('openings')}
          />
        </div>
      </div>

      <WeeklyReportCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {nextLesson ? (
          <ActionCard
            icon={nextLesson.icon}
            title={t('lessons.nextTitle', { title: nextLesson.title })}
            body={nextLesson.summary}
            cta={t('lessons.cta')}
            onClick={() => go('learn')}
          />
        ) : (
          <ActionCard
            icon="🎓"
            title={t('lessons.allDoneTitle')}
            body={t('lessons.allDoneBody')}
            cta={t('lessons.ctaBrowse')}
            onClick={() => go('learn')}
          />
        )}
        <ActionCard icon="♟️" title={t('playCard.title')} body={t('playCard.body')} cta={t('playCard.cta')} onClick={() => go('play')} />
      </div>
    </div>
  );
}
