import { useMemo, useState } from 'react';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORY_LABELS,
  achievementProgress,
  type AchievementCategory,
  type Achievement,
} from '../lib/achievements';
import { buildAchievementCtx } from '../lib/gamify';
import { useAchievements } from '../store/achievements';
import { useRatings } from '../store/ratings';
import { useGamify } from '../store/gamify';
import { useLadder } from '../store/ladder';
import { useRepertoire } from '../store/repertoire';
import { useProgress } from '../store/progress';
import { useQuests } from '../store/quests';
import { useCoach } from '../store/coach';

/**
 * The badge gallery: earned badges in full colour with their earn date,
 * locked ones dimmed/greyscale with a live progress bar toward the target.
 */

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function Badge({ a, earnedAt, ctx }: { a: Achievement; earnedAt: number | undefined; ctx: ReturnType<typeof buildAchievementCtx> }) {
  const unlocked = earnedAt !== undefined;
  const { value, target, pct, done } = achievementProgress(a, ctx);
  return (
    <div
      title={a.desc}
      className={`card-lift rounded-2xl border p-3 ${
        unlocked ? 'border-gold-400/50 bg-gold-400/10' : 'border-neutral-800 bg-panel/60'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-2xl ${unlocked ? 'pop-in' : 'opacity-50 grayscale'}`}>{a.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-semibold ${unlocked ? 'text-ink' : 'text-neutral-400'}`}>{a.name}</div>
          <div className="truncate text-xs text-neutral-400">{a.desc}</div>
        </div>
        {unlocked && <span className="text-emerald-400">✓</span>}
      </div>
      {!unlocked && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-neutral-400">
            {Math.min(value, target)} / {target}
            {a.xp > 0 && <span className="ml-2 text-gold-400/90">+{a.xp} XP</span>}
          </div>
        </div>
      )}
      {unlocked && (
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-neutral-400">{earnedAt > 0 ? `Earned ${dateFmt.format(earnedAt)}` : 'Earned'}</span>
          {done && a.xp > 0 && <span className="text-gold-400/90">+{a.xp} XP</span>}
        </div>
      )}
    </div>
  );
}

type Filter = 'all' | 'earned' | 'locked';

/** The full badge wall, grouped by category, locked entries showing progress. */
export function AchievementGrid() {
  const unlocked = useAchievements((s) => s.unlocked);
  const [filter, setFilter] = useState<Filter>('all');
  // Subscribe to every source so progress bars stay live.
  useRatings((s) => s.categories);
  useGamify((s) => s.xp);
  useLadder((s) => s.defeated);
  useRepertoire((s) => s.rushHighScore);
  useProgress((s) => s.history);
  useQuests((s) => s.totalCompleted);
  useCoach((s) => s.trainingLog);

  // Cheap to recompute; the store subscriptions above keep it fresh.
  const ctx = buildAchievementCtx();

  const earned = Object.keys(unlocked).length;
  const grouped = useMemo(() => {
    const m = new Map<AchievementCategory, Achievement[]>();
    for (const a of ACHIEVEMENTS) {
      const list = m.get(a.category) ?? [];
      list.push(a);
      m.set(a.category, list);
    }
    return [...m.entries()];
  }, []);

  const matches = (a: Achievement) => filter === 'all' || (filter === 'earned') === (a.id in unlocked);

  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">Achievements</h3>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-full border border-neutral-700 text-xs">
            {(['all', 'earned', 'locked'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`btn-press px-2.5 py-1 font-semibold capitalize ${
                  filter === f ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="text-xs text-neutral-400">
            {earned} / {ACHIEVEMENTS.length} earned
          </span>
        </div>
      </div>
      <div className="space-y-4">
        {grouped.map(([cat, list]) => {
          const shown = list.filter(matches);
          if (shown.length === 0) return null;
          return (
            <div key={cat}>
              <div className="mb-2 text-xs uppercase tracking-wide text-neutral-400">{ACHIEVEMENT_CATEGORY_LABELS[cat]}</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((a) => (
                  <Badge key={a.id} a={a} earnedAt={unlocked[a.id]} ctx={ctx} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
