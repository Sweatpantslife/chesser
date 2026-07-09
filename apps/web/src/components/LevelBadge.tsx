import { useGamify, levelProgress } from '../store/gamify';
import { StreakFlame } from './icons';

/** Compact level + streak chip for the header; clicking opens the Profile. */
export function LevelBadge({ onClick }: { onClick: () => void }) {
  const xp = useGamify((s) => s.xp);
  const streak = useGamify((s) => s.activeStreak());
  const { level, pct } = levelProgress(xp);

  return (
    <button
      onClick={onClick}
      title="Your profile — level, ratings & badges"
      aria-label={`Your profile — level ${level}${streak > 0 ? `, ${streak}-day streak` : ''}`}
      className="btn-press flex min-h-11 items-center gap-2 rounded-full bg-neutral-800 py-1 pl-1 pr-2.5 text-xs text-neutral-200 hover:bg-neutral-700 sm:min-h-0"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-xs font-bold text-white">
        {level}
      </span>
      <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-neutral-700 sm:block">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-accent-400 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
      {streak > 0 && (
        <span className="flex items-center gap-0.5 font-bold text-gold-400">
          <StreakFlame size={14} />
          {streak}
        </span>
      )}
    </button>
  );
}
