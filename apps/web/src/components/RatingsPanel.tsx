/**
 * THE shared ratings display (stats consolidation C3): the three category
 * meters (bots · blitz · puzzles) plus the Elo/Glicko-2 meter toggle, rendered
 * as one unit. Profile → Overview is the canonical mount; render it at most
 * once per hub — other surfaces (Home's summary strip, boards) should link
 * here rather than repeat the meters.
 */
import { useTranslation } from 'react-i18next';
import { RATING_CATEGORIES } from '../store/ratings';
import { useSettings } from '../store/settings';
import { RatingMeter } from './RatingMeter';

/** Elo ↔ Glicko-2 display toggle (persisted in settings.ratingMeter). */
export function MeterToggle() {
  const meter = useSettings((s) => s.ratingMeter);
  const setMeter = useSettings((s) => s.setRatingMeter);
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-neutral-700 text-xs">
      {(['elo', 'glicko'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMeter(m)}
          aria-pressed={meter === m}
          className={`btn-press min-h-11 px-2.5 py-1 font-semibold capitalize sm:min-h-0 ${meter === m ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
        >
          {m === 'glicko' ? 'Glicko-2' : 'Elo'}
        </button>
      ))}
    </div>
  );
}

export function RatingsPanel() {
  const { t } = useTranslation('profile');
  return (
    <section aria-label={t('ratings.title')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">{t('ratings.title')}</h3>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{t('meterLabel')}</span>
          <MeterToggle />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {RATING_CATEGORIES.map((cat) => (
          <RatingMeter key={cat} category={cat} />
        ))}
      </div>
    </section>
  );
}
