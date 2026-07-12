import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGamify, levelProgress } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useCoach } from '../store/coach';
import { useGame } from '../store/game';
import { buildWeaknessProfile } from '../lib/weakness';
import { now } from '../lib/clock';
import { playSound } from '../lib/sound';
import { DailyQuests } from '../components/DailyQuests';
import { Disclosure } from '../components/Disclosure';
import { WeeklyReportCard } from '../components/WeeklyReport';
import { StreakFlame, IconArrowRight, IconCoach } from '../components/icons';

// Lazy: the hero needs store/plan (the study-plan generator + its whole
// content catalogue) and the strip's due-count needs lib/decks (every
// trainer's item registry) — both far too heavy for the eager entry chunk.
// They render into already-reserved slots, so the deferred chunk causes no
// more than a text pop-in.
const HomeHero = lazy(() => import('../components/HomeHero').then((m) => ({ default: m.HomeHero })));
const ReviewDueCount = lazy(() => import('../components/HomeHero').then((m) => ({ default: m.ReviewDueCount })));
// Lazy for the same store/plan reason (shares the chunk graph with HomeHero).
const PlanCard = lazy(() => import('../components/PlanCard').then((m) => ({ default: m.PlanCard })));

/**
 * Home (`#/`) — the slim "what should I do right now" dashboard. Exactly:
 * summary strip (→ Profile Progress), the single accent hero CTA, the coach
 * one-liner (hidden when the coach has nothing), daily quests, the weekly-plan
 * preview, the daily puzzle, resume-last-game (hidden without a live game),
 * and the week recap in a collapsed disclosure. Everything else — trainer
 * entries, repertoire, lessons, rating meters — lives in its hub; Home is not
 * a second nav.
 */

function greetingKey(): 'midnight' | 'morning' | 'afternoon' | 'evening' {
  const h = new Date(now()).getHours();
  if (h < 5) return 'midnight';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/**
 * Greeting + streak · level/XP · review-due count, all one link to
 * `#/profile/progress` — the ONLY cross-app stats surface outside Profile.
 */
function SummaryStrip() {
  const { t } = useTranslation('home');
  const xp = useGamify((s) => s.xp);
  const streak = useStreak((s) => s.current());
  const { level } = levelProgress(xp);

  return (
    <Link
      to="/profile/progress"
      data-testid="home-summary"
      onClick={() => playSound('uiClick')}
      className="btn-press flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-panel px-4 py-3 shadow-soft hover:bg-panelmute"
    >
      <h2 className="font-display text-base font-bold text-ink">{t(`strip.greeting.${greetingKey()}`)}!</h2>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-neutral-300">
        <span className="flex items-center gap-1">
          <StreakFlame size={16} lit={streak > 0} />
          {t('strip.streak', { count: streak })}
        </span>
        <span>{t('strip.level', { level, xp: xp.toLocaleString() })}</span>
        <Suspense fallback={null}>
          <ReviewDueCount />
        </Suspense>
        <span className="flex items-center gap-1 text-neutral-400">
          {t('strip.cta')}
          <IconArrowRight size={14} />
        </span>
      </span>
    </Link>
  );
}

/**
 * Compact coach one-liner → Train's Coach & Plan strip. Renders nothing at
 * all when the weakness profile is empty (no reviewed games yet).
 */
function CoachStrip() {
  const { t } = useTranslation(['home', 'insights']);
  const games = useCoach((s) => s.games);
  const top = useMemo(() => buildWeaknessProfile(Object.values(games)).weaknesses[0] ?? null, [games]);
  if (!top) return null;
  const label = t(`insights:weaknesses.${top.kind}.label`, { defaultValue: top.meta.label });

  return (
    <Link
      to="/train"
      data-testid="home-coach"
      onClick={() => playSound('uiClick')}
      className="btn-press flex min-h-11 items-center gap-3 rounded-2xl bg-panel px-4 py-2.5 shadow-soft hover:bg-panelmute"
    >
      <IconCoach size={18} className="shrink-0 text-neutral-400" />
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
        <span className="font-semibold text-ink">{t('home:coach.kicker')}</span> {t('home:coach.tip', { label, count: top.count })}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-neutral-300">
        {t('home:coach.cta')}
        <IconArrowRight size={14} />
      </span>
    </Link>
  );
}

/** Neutral navigational card — a real link, no accent (the hero owns that). */
function ActionLinkCard(props: { to: string; icon: string; title: string; body: string; cta: string; testid?: string }) {
  return (
    <Link
      to={props.to}
      data-testid={props.testid}
      onClick={() => playSound('uiClick')}
      className="btn-press card-lift group flex items-center gap-3 rounded-2xl bg-panel p-4 shadow-soft"
    >
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-2xl">
        {props.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{props.title}</span>
        <span className="block truncate text-xs text-neutral-400">{props.body}</span>
      </span>
      <span className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-neutral-800 px-3.5 py-1.5 text-sm font-bold text-neutral-200 group-hover:bg-neutral-700">
        {props.cta}
        <IconArrowRight size={14} />
      </span>
    </Link>
  );
}

/** "Resume your game" → Play; only exists while a vs-bot game is live. */
function ResumeGameCard() {
  const { t } = useTranslation('home');
  const inProgress = useGame((s) => s.mode === 'play' && !s.isGameOver && s.history.length > 0);
  const opponentName = useGame((s) => s.opponent?.name ?? null);
  if (!inProgress) return null;
  return (
    <ActionLinkCard
      to="/play"
      icon="♟️"
      title={t('resume.title')}
      body={opponentName ? t('resume.body', { name: opponentName }) : t('resume.bodyGeneric')}
      cta={t('resume.cta')}
      testid="home-resume"
    />
  );
}

/** Reserves the hero's height so the lazy chunk doesn't shift the page. */
function HeroSlot({ children }: { children: ReactNode }) {
  return <div className="min-h-[84px]">{children}</div>;
}

export function HomePage() {
  const { t } = useTranslation('home');
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4">
      <SummaryStrip />
      <HeroSlot>
        <Suspense fallback={null}>
          <HomeHero />
        </Suspense>
      </HeroSlot>
      <CoachStrip />
      <DailyQuests />
      <Suspense fallback={null}>
        <PlanCard />
      </Suspense>
      <ActionLinkCard
        to="/train/tactics?daily=1"
        icon="🧩"
        title={t('daily.title')}
        body={t('daily.body')}
        cta={t('daily.cta')}
        testid="home-daily"
      />
      <ResumeGameCard />
      <Disclosure title={t('weekly.title')} hint={t('recap.hint')}>
        <WeeklyReportCard bare />
      </Disclosure>
    </div>
  );
}
