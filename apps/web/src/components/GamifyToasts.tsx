import { useEffect, useState } from 'react';
import { onGamifyEvent, type GamifyEvent } from '../lib/gamify';

interface Toast {
  id: number;
  icon: string;
  title: string;
  body: string;
  accent: string;
}

let nextId = 0;

function toastFor(e: GamifyEvent): Toast | null {
  switch (e.kind) {
    case 'achievement-unlocked':
      return {
        id: nextId++,
        icon: e.icon,
        title: 'Achievement unlocked',
        body: e.xp > 0 ? `${e.name} · +${e.xp} XP` : e.name,
        accent: 'border-gold-400/70 shadow-glow-gold',
      };
    case 'level-up':
      return { id: nextId++, icon: '⭐', title: 'Level up!', body: `You reached level ${e.level}`, accent: 'border-brand-400/70 shadow-glow' };
    case 'streak-milestone':
      return {
        id: nextId++,
        icon: '🔥',
        title: `${e.days}-day streak!`,
        body: e.rewardXp > 0 ? `Milestone reached · +${e.rewardXp} XP` : 'Milestone reached',
        accent: 'border-gold-400/70 shadow-glow-gold',
      };
    case 'streak-freeze-used':
      return {
        id: nextId++,
        icon: '🧊',
        title: 'Streak freeze used',
        body: `Your ${e.streak}-day streak survived · ${e.freezesLeft} freeze${e.freezesLeft === 1 ? '' : 's'} left`,
        accent: 'border-brand-400/70 shadow-glow',
      };
    case 'goal':
      return {
        id: nextId++,
        icon: '🔥',
        title: 'Daily goal complete',
        body: e.streak > 0 ? `${e.streak}-day streak — keep it going!` : 'Nice work — come back tomorrow!',
        accent: 'border-accent-400/70 shadow-glow',
      };
    case 'quest-complete':
      return {
        id: nextId++,
        icon: e.icon,
        title: 'Quest complete',
        body: e.xp > 0 ? `${e.name} · +${e.xp} XP` : e.name,
        accent: 'border-brand-400/70 shadow-glow',
      };
    case 'quests-all-done':
      return {
        id: nextId++,
        icon: '🏅',
        title: 'All quests done!',
        body: `Daily slate cleared · +${e.bonusXp} XP bonus`,
        accent: 'border-gold-400/70 shadow-glow-gold',
      };
    default:
      return null; // 'xp-awarded' is too chatty for a toast
  }
}

/** Mounted once at the app root; turns gamify events into transient toasts. */
export function GamifyToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timeouts = new Set<number>();
    const unsub = onGamifyEvent((e) => {
      const t = toastFor(e);
      if (!t) return;
      setToasts((cur) => [...cur, t].slice(-4));
      const id = window.setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== t.id));
        timeouts.delete(id);
      }, 4500);
      timeouts.add(id);
    });
    return () => {
      unsub();
      for (const id of timeouts) window.clearTimeout(id);
    };
  }, []);

  // The container stays mounted (even when empty) so screen readers treat it
  // as a stable live region and announce toasts as they arrive.
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`gamify-toast pointer-events-auto flex items-center gap-3 rounded-2xl border bg-panel/95 p-3 backdrop-blur ${t.accent}`}
        >
          <span className="pop-in text-2xl">{t.icon}</span>
          <div className="min-w-0">
            <div className="truncate text-xs uppercase tracking-wide text-neutral-400">{t.title}</div>
            <div className="truncate text-sm font-semibold text-ink">{t.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
