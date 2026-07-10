import { useEffect } from 'react';
import { useQuests } from '../store/quests';
import { ALL_QUESTS_BONUS_XP, type QuestDef } from '../lib/quests';

/**
 * Today's quest slate: three rotating objectives with live progress bars.
 * Progress is fed automatically by lib/gamify.ts — this card only reads.
 */

function QuestRow({ q, value, done }: { q: QuestDef; value: number; done: boolean }) {
  const shown = Math.min(value, q.target);
  const pct = Math.min(100, Math.round((shown / q.target) * 100));
  return (
    <li
      className={`rounded-2xl border p-3 transition-colors ${
        done ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-neutral-800 bg-panel/60'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-2xl ${done ? 'pop-in' : ''}`} aria-hidden="true">
          {q.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm font-semibold ${done ? 'text-emerald-300' : 'text-ink'}`}>{q.name}</span>
            <span className={`shrink-0 text-xs font-semibold ${done ? 'text-emerald-400' : 'text-gold-400/90'}`}>
              {done ? '✓ done' : `+${q.xp} XP`}
            </span>
          </div>
          <div className="truncate text-xs text-neutral-400">{q.desc}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${
                  done ? 'bg-emerald-400' : 'bg-gradient-to-r from-brand-500 to-accent-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-neutral-400">
              {shown} / {q.target}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

export function DailyQuests() {
  useQuests((s) => s.day); // re-render on rollover so the slate below stays fresh
  const progress = useQuests((s) => s.progress);
  const done = useQuests((s) => s.done);
  const rollover = useQuests((s) => s.rollover);

  // Refresh the slate when the card mounts (covers sessions that span midnight).
  useEffect(() => {
    rollover();
  }, [rollover]);

  // Outside the selector: todaysQuests() builds a fresh array per call, which
  // useSyncExternalStore would treat as an ever-changing snapshot.
  const quests = useQuests.getState().todaysQuests();
  const doneCount = quests.filter((q) => q.id in done).length;
  const allDone = doneCount === quests.length;

  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">Daily quests</h3>
        <span className="text-xs text-neutral-400">
          {doneCount} / {quests.length} done
        </span>
      </div>
      <ul className="space-y-2">
        {quests.map((q) => (
          <QuestRow key={q.id} q={q} value={progress[q.id] ?? 0} done={q.id in done} />
        ))}
      </ul>
      <p className={`mt-3 text-xs ${allDone ? 'text-gold-400' : 'text-neutral-400'}`}>
        {allDone
          ? `🏅 All quests complete — +${ALL_QUESTS_BONUS_XP} XP bonus earned. New quests tomorrow!`
          : `Finish all ${quests.length} for a +${ALL_QUESTS_BONUS_XP} XP bonus. Fresh quests every day.`}
      </p>
    </div>
  );
}
