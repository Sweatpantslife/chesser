import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DECK_META, useReviewSummary } from '../lib/decks';
import { deckPath } from '../app/paths';

/**
 * Unified spaced-repetition summary across every deck (openings, tactics,
 * checkmates, anti-blunder). Shows the total due and a per-deck breakdown;
 * each chip is a plain link (DeckTarget → URL via deckPath) straight to that
 * trainer — middle-click, copy-link and a11y work for free.
 */
export function ReviewSummary() {
  const { t } = useTranslation('analysis');
  const { decks, totalDue, totalSeen, totalCards } = useReviewSummary();

  return (
    <div className="rounded-2xl bg-panel shadow-soft p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{t('queue.title')}</h3>
        <span className="text-xs text-neutral-400">{t('queue.learned', { seen: totalSeen, total: totalCards })}</span>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${totalDue > 0 ? 'text-amber-300' : 'text-neutral-300'}`}>{totalDue}</span>
        <span className="text-sm text-neutral-400">{t('queue.cardsDue', { count: totalDue })}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {decks.map((d) => {
          const meta = DECK_META[d.deck];
          const hasDue = d.due > 0;
          return (
            <Link
              key={d.deck}
              to={deckPath(meta.target)}
              className={`block min-h-11 rounded-lg border px-3 py-2 text-left transition-colors ${
                hasDue
                  ? 'border-amber-500/40 bg-amber-950/30 hover:bg-amber-950/50'
                  : 'border-neutral-700 bg-neutral-800/40 hover:bg-neutral-800'
              }`}
            >
              <div className={`text-xs font-semibold ${meta.accent}`}>{meta.label}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className={`text-lg font-bold ${hasDue ? 'text-amber-300' : 'text-neutral-400'}`}>{d.due}</span>
                <span className="text-xs text-neutral-400">{t('queue.dueLabel', { count: d.due })}</span>
              </div>
              <div className="text-xs text-neutral-400">{t('queue.learned', { seen: d.seen, total: d.total })}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
