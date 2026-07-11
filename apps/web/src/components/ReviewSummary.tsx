import { DECK_META, useReviewSummary, type DeckTarget } from '../lib/decks';

/**
 * Unified spaced-repetition summary across every deck (openings, tactics,
 * checkmates, anti-blunder). Shows the total due and a per-deck breakdown; each
 * chip jumps straight to that trainer.
 */
export function ReviewSummary({ goto }: { goto: (target: DeckTarget) => void }) {
  const { decks, totalDue, totalSeen, totalCards } = useReviewSummary();

  return (
    <div className="rounded-2xl bg-panel shadow-soft p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Review queue</h3>
        <span className="text-xs text-neutral-400">
          {totalSeen}/{totalCards} learned
        </span>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${totalDue > 0 ? 'text-amber-300' : 'text-neutral-300'}`}>{totalDue}</span>
        <span className="text-sm text-neutral-400">
          {totalDue === 1 ? 'card' : 'cards'} due across all decks
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {decks.map((d) => {
          const meta = DECK_META[d.deck];
          const hasDue = d.due > 0;
          return (
            <button
              key={d.deck}
              onClick={() => goto(meta.target)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                hasDue
                  ? 'border-amber-500/40 bg-amber-950/30 hover:bg-amber-950/50'
                  : 'border-neutral-700 bg-neutral-800/40 hover:bg-neutral-800'
              }`}
            >
              <div className={`text-xs font-semibold ${meta.accent}`}>{meta.label}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className={`text-lg font-bold ${hasDue ? 'text-amber-300' : 'text-neutral-400'}`}>{d.due}</span>
                <span className="text-xs text-neutral-400">due</span>
              </div>
              <div className="text-xs text-neutral-400">
                {d.seen}/{d.total} learned
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
