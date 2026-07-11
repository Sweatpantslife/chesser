import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRatings, ratingValue, ratingPeak, type RatingCategory } from '../store/ratings';
import { useSettings } from '../store/settings';
import { ratingInterval } from '../lib/glicko';
import { RatingSparkline } from './Charts';

const ICONS: Record<RatingCategory, string> = { bots: '♟️', blitz: '⚡', puzzles: '🧩' };

/**
 * One category's dual meter. The headline number follows the player's chosen
 * meter (Elo by default); the other meter is shown small underneath, with the
 * Glicko side carrying its ± confidence band.
 */
export function RatingMeter({ category }: { category: RatingCategory }) {
  const { t } = useTranslation('play');
  const c = useRatings((s) => s.categories[category]);
  const meter = useSettings((s) => s.ratingMeter);

  const primary = ratingValue(c, meter);
  const peak = ratingPeak(c, meter);
  const secondaryLabel = meter === 'elo' ? 'Glicko' : 'Elo';
  const secondary = meter === 'elo' ? Math.round(c.glicko.rating) : Math.round(c.elo);
  const band = ratingInterval(c.glicko.rd);

  const series = useMemo(() => {
    const days = Object.keys(c.history).sort();
    return days.map((d) => (meter === 'elo' ? c.history[d]!.elo : c.history[d]!.glicko));
  }, [c.history, meter]);

  const record =
    category === 'puzzles'
      ? t('meter.recordPuzzles', { solved: c.won, missed: c.lost })
      : t('meter.recordGames', { won: c.won, drawn: c.drawn, lost: c.lost });

  return (
    <div className="card-lift rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{ICONS[category]}</span>
          <span className="font-display text-sm font-semibold text-ink">{t(`meter.category.${category}`)}</span>
        </div>
        <span className="text-xs uppercase tracking-wide text-neutral-400">{t('meter.peak', { value: peak })}</span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="font-display text-3xl font-bold text-brand-300">{primary}</div>
          <div className="mt-0.5 text-xs text-neutral-400">
            {secondaryLabel} {secondary}
            {meter === 'glicko' ? '' : ` ± ${band}`}
          </div>
        </div>
        <div className="text-right text-xs text-neutral-400">{record}</div>
      </div>

      {series.length >= 2 ? (
        <div className="mt-3">
          <RatingSparkline data={series} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-400">{c.played === 0 ? t('meter.emptyNoGames') : t('meter.emptyTrend')}</p>
      )}
    </div>
  );
}
