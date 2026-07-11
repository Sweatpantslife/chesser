import { useEffect, useState } from 'react';
import i18n from '../i18n';
import { onGamifyEvent, type GamifyEvent } from '../lib/gamify';

interface Toast {
  id: number;
  icon: string;
  title: string;
  body: string;
  accent: string;
}

let nextId = 0;

// Toasts are built outside React (event stream), so they use the i18n
// instance directly; they are transient, so not re-rendering an on-screen
// toast on a mid-flight language switch is fine.
function toastFor(e: GamifyEvent): Toast | null {
  const t = i18n.getFixedT(null, 'gamify');
  // Achievement/quest events carry the catalogue's canonical ENGLISH name
  // (lib/achievements & lib/quests cannot import i18n — they sit in the
  // node-test import graph), so display names are resolved here by id via
  // the `progress` namespace, falling back to the canonical name.
  switch (e.kind) {
    case 'achievement-unlocked': {
      const name = i18n.t(`progress:achievements.${e.id}.name`, { defaultValue: e.name });
      return {
        id: nextId++,
        icon: e.icon,
        title: t('toasts.achievement.title'),
        body: e.xp > 0 ? t('toasts.achievement.bodyXp', { name, xp: e.xp }) : name,
        accent: 'border-gold-400/70 shadow-glow-gold',
      };
    }
    case 'level-up':
      return {
        id: nextId++,
        icon: '⭐',
        title: t('toasts.levelUp.title'),
        body: t('toasts.levelUp.body', { level: e.level }),
        accent: 'border-brand-400/70 shadow-glow',
      };
    case 'streak-milestone':
      return {
        id: nextId++,
        icon: '🔥',
        title: t('toasts.streakMilestone.title', { count: e.days }),
        body:
          e.rewardXp > 0
            ? t('toasts.streakMilestone.bodyXp', { xp: e.rewardXp })
            : t('toasts.streakMilestone.body'),
        accent: 'border-gold-400/70 shadow-glow-gold',
      };
    case 'streak-freeze-used':
      return {
        id: nextId++,
        icon: '🧊',
        title: t('toasts.freezeUsed.title'),
        body: t('toasts.freezeUsed.body', { streak: e.streak, count: e.freezesLeft }),
        accent: 'border-brand-400/70 shadow-glow',
      };
    case 'goal':
      return {
        id: nextId++,
        icon: '🔥',
        title: t('toasts.goal.title'),
        body: e.streak > 0 ? t('toasts.goal.bodyStreak', { count: e.streak }) : t('toasts.goal.body'),
        accent: 'border-accent-400/70 shadow-glow',
      };
    case 'quest-complete': {
      const name = i18n.t(`progress:quests.${e.id}.name`, { defaultValue: e.name });
      return {
        id: nextId++,
        icon: e.icon,
        title: t('toasts.quest.title'),
        body: e.xp > 0 ? t('toasts.quest.bodyXp', { name, xp: e.xp }) : name,
        accent: 'border-brand-400/70 shadow-glow',
      };
    }
    case 'quests-all-done':
      return {
        id: nextId++,
        icon: '🏅',
        title: t('toasts.allQuests.title'),
        body: t('toasts.allQuests.body', { xp: e.bonusXp }),
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
