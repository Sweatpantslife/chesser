import { useEffect, useMemo, useState } from 'react';
import { useProgress, type Deck } from '../store/progress';

/** Compact spaced-repetition stats for a deck: progress, due count, streak. */
export function ReviewStats({ deck, ids }: { deck: Deck; ids: string[] }) {
  const cards = useProgress((s) => s.cards);
  const streak = useProgress((s) => s.streak);

  // Re-evaluate "due" periodically: the memo below only re-runs when cards
  // change, so cards becoming due while the page sits open never showed here
  // (while the per-item chips, re-rendered for other reasons, did).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { seen, due } = useMemo(() => {
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
  }, [cards, ids, deck, now]);

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
