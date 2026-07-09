import { useGamify, GOAL_PRESETS } from '../store/gamify';

/** SVG ring showing today's XP against the daily goal, with the streak inside. */
function GoalRing({ value, goal, streak }: { value: number; goal: number; streak: number }) {
  const pct = Math.min(1, value / goal);
  const R = 34;
  const C = 2 * Math.PI * R;
  const met = value >= goal;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx={40} cy={40} r={R} fill="none" stroke="#2a2f3a" strokeWidth={7} />
        <circle
          cx={40}
          cy={40}
          r={R}
          fill="none"
          stroke={met ? '#34d399' : '#fbbf24'}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-ink">🔥{streak}</span>
        <span className="text-xs uppercase tracking-wide text-neutral-400">streak</span>
      </div>
    </div>
  );
}

/** The daily-goal card: ring + today's progress + goal presets. */
export function DailyGoal() {
  const todayXp = useGamify((s) => s.todayXp());
  const goalXp = useGamify((s) => s.goalXp);
  const streak = useGamify((s) => s.activeStreak());
  const bestStreak = useGamify((s) => s.bestStreak);
  const setGoalXp = useGamify((s) => s.setGoalXp);
  const met = todayXp >= goalXp;

  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Daily goal</h3>
        <span className="text-xs text-neutral-400">best 🔥{bestStreak}</span>
      </div>
      <div className="flex items-center gap-4">
        <GoalRing value={todayXp} goal={goalXp} streak={streak} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-neutral-200">
            <span className="font-bold text-emerald-300">{todayXp}</span>
            <span className="text-neutral-400"> / {goalXp} XP today</span>
          </div>
          <p className={`mt-0.5 text-xs ${met ? 'text-emerald-400' : 'text-neutral-400'}`}>
            {met ? '✓ Goal met — streak safe!' : `${goalXp - todayXp} XP to keep your streak`}
          </p>
          <div className="mt-2">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Goal</div>
            <div className="flex gap-1">
              {GOAL_PRESETS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGoalXp(g)}
                  className={`flex-1 rounded px-1.5 py-1 text-xs ${
                    goalXp === g ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
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
