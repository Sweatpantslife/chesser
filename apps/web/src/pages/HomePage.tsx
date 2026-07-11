import { useGamify, levelProgress } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useLessons } from '../store/lessons';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useSprints } from '../store/sprints';
import { isDue } from '../lib/srs';
import { now } from '../lib/clock';
import { ALL_LESSONS } from '../learn';
import { DailyQuests } from '../components/DailyQuests';
import { DailyGoal } from '../components/DailyGoal';
import { WeeklyReportCard } from '../components/WeeklyReport';
import { StreakFlame, IconArrowRight } from '../components/icons';
import mascotUrl from '../assets/img/mascot.svg';

/**
 * The "Today" page — the daily landing spot. Pulls the whole retention loop
 * into one glance: streak + freezes, level/XP, the daily quest slate, the
 * daily goal ring, and one-tap entries into the daily puzzle, the next
 * lesson, and a game.
 */

export type HomeTarget = 'play' | 'learn' | 'tactics' | 'profile' | 'openings';

function greeting(): string {
  const h = new Date(now()).getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Hero({ onProfile }: { onProfile: () => void }) {
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
              {streak} <span className="text-sm font-semibold text-neutral-400">day{streak === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-400" title="A freeze saves your streak when you miss one day">
              🧊 {freezes} freeze{freezes === 1 ? '' : 's'} banked
            </div>
          </div>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-display font-semibold text-ink">{greeting()}!</span>
            {/* -my keeps the baseline row compact while min-h-8 keeps the tap target ≥24px (WCAG 2.5.8). */}
            <button
              onClick={onProfile}
              className="btn-press -my-1 flex min-h-8 items-center text-xs font-semibold text-brand-300 hover:text-brand-200"
            >
              Level {level} · {xp.toLocaleString()} XP
            </button>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-accent-400 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-neutral-400">
            {toNext} XP to level {level + 1}
          </div>
          <p className={`mt-1 text-xs ${atRisk ? 'text-gold-400' : 'text-neutral-400'}`}>
            {atRisk
              ? 'Your streak is on ice — train today to save it (uses a freeze).'
              : streak > 0
                ? 'Keep the flame alive — any activity counts.'
                : 'Do anything today — a puzzle, a lesson, a game — to light your streak.'}
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
  const rushBest = useSprints((s) => Math.max(s.puzzleRushBest.timed3.score, s.puzzleRushBest.survival.score));
  const stormBest = useSprints((s) => s.puzzleStormBest.score);
  return (
    <div className="card-lift flex items-center gap-3 rounded-2xl bg-panel p-4 shadow-soft">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-2xl">⚡</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">Puzzle sprints</div>
        <div className="truncate text-xs text-neutral-400">
          Race the clock, build combos.
          {rushBest > 0 || stormBest > 0 ? ` Bests — Rush ${rushBest} · Storm ${stormBest}` : ' Set your first record.'}
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={() => onSprint('rush')}
          className="btn-press rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          Rush
        </button>
        <button
          onClick={() => onSprint('storm')}
          className="btn-press rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          Storm
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
  const completed = useLessons((s) => s.completed);
  const nextLesson = ALL_LESSONS.find((l) => !(l.id in completed));
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
          <DailyGoal />
          <ActionCard
            icon="🧩"
            title="Daily puzzle"
            body="One hand-picked puzzle — same for everyone, new every day."
            cta="Solve"
            onClick={onDailyPuzzle}
          />
          <SprintCard onSprint={onSprint} />
          <ActionCard
            icon="📖"
            title={
              openingsDue > 0
                ? `${openingsDue} opening line${openingsDue === 1 ? '' : 's'} due today`
                : pickedCount > 0
                  ? 'Openings: all caught up'
                  : 'Learn an opening repertoire'
            }
            body={
              openingsDue > 0
                ? 'Spaced repetition says it’s time — drill them before they fade.'
                : pickedCount > 0
                  ? 'Nothing due right now. Learn a new line to grow your repertoire.'
                  : 'Pick openings for White and Black, drill them move by move.'
            }
            cta={openingsDue > 0 ? 'Review' : pickedCount > 0 ? 'Train' : 'Build'}
            onClick={() => go('openings')}
          />
        </div>
      </div>

      <WeeklyReportCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {nextLesson ? (
          <ActionCard
            icon={nextLesson.icon}
            title={`Next lesson: ${nextLesson.title}`}
            body={nextLesson.summary}
            cta="Learn"
            onClick={() => go('learn')}
          />
        ) : (
          <ActionCard
            icon="🎓"
            title="All lessons complete!"
            body="Replay any lesson to sharpen up — replays still earn XP."
            cta="Browse"
            onClick={() => go('learn')}
          />
        )}
        <ActionCard icon="♟️" title="Play a game" body="Face a bot at your level — wins count toward quests." cta="Play" onClick={() => go('play')} />
      </div>
    </div>
  );
}
