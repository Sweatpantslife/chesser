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

function toastFor(e: GamifyEvent): Toast {
  switch (e.kind) {
    case 'achievement':
      return {
        id: nextId++,
        icon: e.icon,
        title: 'Achievement unlocked',
        body: e.xp > 0 ? `${e.name} · +${e.xp} XP` : e.name,
        accent: 'border-amber-400/60',
      };
    case 'level':
      return { id: nextId++, icon: '⭐', title: 'Level up!', body: `You reached level ${e.level}`, accent: 'border-emerald-400/60' };
    case 'goal':
      return {
        id: nextId++,
        icon: '🔥',
        title: 'Daily goal complete',
        body: `${e.streak}-day streak — keep it going!`,
        accent: 'border-orange-400/60',
      };
  }
}

/** Mounted once at the app root; turns gamify events into transient toasts. */
export function GamifyToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timeouts = new Set<number>();
    const unsub = onGamifyEvent((e) => {
      const t = toastFor(e);
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
          className={`gamify-toast pointer-events-auto flex items-center gap-3 rounded-lg border bg-panel/95 p-3 shadow-2xl backdrop-blur ${t.accent}`}
        >
          <span className="text-2xl">{t.icon}</span>
          <div className="min-w-0">
            <div className="truncate text-xs uppercase tracking-wide text-neutral-400">{t.title}</div>
            <div className="truncate text-sm font-semibold text-ink">{t.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
