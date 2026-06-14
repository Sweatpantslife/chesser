import { useMemo } from 'react';
import { useProgress, type Deck } from '../store/progress';

/** Compact spaced-repetition stats for a deck: progress, due count, streak. */
export function ReviewStats({ deck, ids }: { deck: Deck; ids: string[] }) {
  const cards = useProgress((s) => s.cards);
  const streak = useProgress((s) => s.streak);

  const { seen, due } = useMemo(() => {
    const now = Date.now();
    let seen = 0;
    let due = 0;
    for (const id of ids) {
      const c = cards[`${deck}:${id}`];
      if (c?.last) {
        seen++;
        if (c.due <= now) due++;
      }
    }
    return { seen, due };
  }, [cards, ids, deck]);

  return (
    <div className="flex items-center gap-3 text-xs text-neutral-400">
      <span>
        <span className="text-neutral-200">{seen}</span>/{ids.length} learned
      </span>
      <span className={due > 0 ? 'text-amber-300' : 'text-neutral-500'}>{due} due</span>
      {streak > 0 && <span title="Daily streak">🔥 {streak}</span>}
    </div>
  );
}
