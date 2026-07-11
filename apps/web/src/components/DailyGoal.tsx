import { Trans, useTranslation } from 'react-i18next';
import { useGamify, GOAL_PRESETS } from '../store/gamify';
import { useStreak } from '../store/streak';
import { StreakFlame } from './icons';

/** SVG ring showing today's XP against the daily goal, with the streak inside. */
function GoalRing({ value, goal, streak }: { value: number; goal: number; streak: number }) {
  const { t } = useTranslation('home');
  const pct = Math.min(1, value / goal);
  const R = 34;
  const C = 2 * Math.PI * R;
  const met = value >= goal;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <defs>
          <linearGradient id="goal-ring-g" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--c-brand-400)" />
            <stop offset="1" stopColor="var(--c-accent-400)" />
          </linearGradient>
        </defs>
        <circle cx={40} cy={40} r={R} fill="none" stroke="var(--c-line)" strokeWidth={7} />
        <circle
          cx={40}
          cy={40}
          r={R}
          fill="none"
          stroke={met ? 'var(--c-mint-400)' : 'url(#goal-ring-g)'}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="flex items-center gap-0.5 font-display text-lg font-bold text-ink">
          <StreakFlame size={18} lit={streak > 0} animate={streak > 0} />
          {streak}
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-400">{t('goal.streakLabel')}</span>
      </div>
    </div>
  );
}

/** The daily-goal card: ring + today's progress + goal presets. */
export function DailyGoal() {
  const { t } = useTranslation('home');
  const todayXp = useGamify((s) => s.todayXp());
  const goalXp = useGamify((s) => s.goalXp);
  const setGoalXp = useGamify((s) => s.setGoalXp);
  const streak = useStreak((s) => s.current());
  const bestStreak = useStreak((s) => s.best);
  const legacyBest = useGamify((s) => s.bestStreak);
  const freezes = useStreak((s) => s.freezes);
  const atRisk = useStreak((s) => s.atRisk());
  const met = todayXp >= goalXp;

  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{t('goal.title')}</h3>
        <span className="flex items-center gap-2 text-xs text-neutral-400">
          <span title={t('goal.freezesTitle', { count: freezes })}>
            🧊 {freezes}
          </span>
          <span className="flex items-center gap-1">
            {t('goal.best')} <StreakFlame size={12} /> {Math.max(bestStreak, legacyBest)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <GoalRing value={todayXp} goal={goalXp} streak={streak} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-neutral-200">
            <Trans
              t={t}
              i18nKey="goal.todayLine"
              values={{ today: todayXp, goal: goalXp }}
              components={{ today: <span className="font-bold text-brand-300" />, rest: <span className="text-neutral-400" /> }}
            />
          </div>
          <p className={`mt-0.5 text-xs ${met ? 'text-emerald-400' : atRisk ? 'text-gold-400' : 'text-neutral-400'}`}>
            {met ? t('goal.met') : atRisk ? t('goal.atRisk') : t('goal.toGo', { xp: goalXp - todayXp })}
          </p>
          <div className="mt-2">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('goal.presetsLabel')}</div>
            <div className="flex gap-1">
              {GOAL_PRESETS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGoalXp(g)}
                  aria-pressed={goalXp === g}
                  className={`btn-press flex-1 rounded-full px-1.5 py-1 text-xs font-semibold ${
                    goalXp === g ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
