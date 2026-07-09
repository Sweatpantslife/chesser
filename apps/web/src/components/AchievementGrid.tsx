import { useMemo } from 'react';
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

function Badge({ a, unlocked, ctx }: { a: Achievement; unlocked: boolean; ctx: ReturnType<typeof buildAchievementCtx> }) {
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
      {unlocked && done && a.xp > 0 && <div className="mt-2 text-right text-xs text-gold-400/90">+{a.xp} XP</div>}
    </div>
  );
}

/** The full badge wall, grouped by category, locked entries showing progress. */
export function AchievementGrid() {
  const unlocked = useAchievements((s) => s.unlocked);
  // Subscribe to every source so progress bars stay live.
  useRatings((s) => s.categories);
  useGamify((s) => s.xp);
  useLadder((s) => s.defeated);
  useRepertoire((s) => s.rushHighScore);
  useProgress((s) => s.history);

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

  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">Achievements</h3>
        <span className="text-xs text-neutral-400">
          {earned} / {ACHIEVEMENTS.length} earned
        </span>
      </div>
      <div className="space-y-4">
        {grouped.map(([cat, list]) => (
          <div key={cat}>
            <div className="mb-2 text-xs uppercase tracking-wide text-neutral-400">{ACHIEVEMENT_CATEGORY_LABELS[cat]}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <Badge key={a.id} a={a} unlocked={a.id in unlocked} ctx={ctx} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
