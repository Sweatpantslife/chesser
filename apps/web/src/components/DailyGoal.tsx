import { useGamify, GOAL_PRESETS } from '../store/gamify';
import { useStreak } from '../store/streak';
import { StreakFlame } from './icons';

/** SVG ring showing today's XP against the daily goal, with the streak inside. */
function GoalRing({ value, goal, streak }: { value: number; goal: number; streak: number }) {
  const pct = Math.min(1, value / goal);
  const R = 34;
  const C = 2 * Math.PI * R;
  const met = value >= goal;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <defs>
          <linearGradient id="goal-ring-g" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a78bfa" />
            <stop offset="1" stopColor="#f472b6" />
          </linearGradient>
        </defs>
        <circle cx={40} cy={40} r={R} fill="none" stroke="#3a3560" strokeWidth={7} />
        <circle
          cx={40}
          cy={40}
          r={R}
          fill="none"
          stroke={met ? '#34d399' : 'url(#goal-ring-g)'}
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
        <span className="text-xs uppercase tracking-wide text-neutral-400">streak</span>
      </div>
    </div>
  );
}

/** The daily-goal card: ring + today's progress + goal presets. */
export function DailyGoal() {
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
        <h3 className="font-display text-sm font-semibold text-ink">Daily goal</h3>
        <span className="flex items-center gap-2 text-xs text-neutral-400">
          <span title={`${freezes} streak freeze${freezes === 1 ? '' : 's'} banked — a freeze saves your streak when you miss one day`}>
            🧊 {freezes}
          </span>
          <span className="flex items-center gap-1">
            best <StreakFlame size={12} /> {Math.max(bestStreak, legacyBest)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <GoalRing value={todayXp} goal={goalXp} streak={streak} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-neutral-200">
            <span className="font-bold text-brand-300">{todayXp}</span>
            <span className="text-neutral-400"> / {goalXp} XP today</span>
          </div>
          <p className={`mt-0.5 text-xs ${met ? 'text-emerald-400' : atRisk ? 'text-gold-400' : 'text-neutral-400'}`}>
            {met
              ? '✓ Goal met — nice work!'
              : atRisk
                ? 'Train today to save your streak (uses a freeze)'
                : `${goalXp - todayXp} XP to today's goal`}
          </p>
          <div className="mt-2">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Goal</div>
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
