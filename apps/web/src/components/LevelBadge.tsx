import { useGamify, levelProgress } from '../store/gamify';

/** Compact level + streak chip for the header; clicking opens the Profile. */
export function LevelBadge({ onClick }: { onClick: () => void }) {
  const xp = useGamify((s) => s.xp);
  const streak = useGamify((s) => s.activeStreak());
  const { level, pct } = levelProgress(xp);

  return (
    <button
      onClick={onClick}
      title="Your profile — level, ratings & badges"
      className="flex items-center gap-2 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
        {level}
      </span>
      <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-neutral-700 sm:block">
        <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
      </span>
      {streak > 0 && <span className="text-orange-300">🔥{streak}</span>}
    </button>
  );
}
