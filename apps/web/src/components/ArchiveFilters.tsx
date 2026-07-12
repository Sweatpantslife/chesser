/**
 * The archive's Result / Color / Period filter row, shared by the Archive
 * games list (`pages/ArchivePage`) and the Progress tab's game insights
 * (`components/GameInsights`) — each keeps its own filter state, this is just
 * the presentational row. The loading skeleton both surfaces show while the
 * saved-games fetch is in flight lives here too.
 */
import { useTranslation } from 'react-i18next';
import type { ArchiveFilter, ColorFilter, PeriodFilter, ResultFilter } from '../lib/archiveStats';

function Pills<T extends string>({
  label,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  ariaLabel: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
      <span className="text-xs text-neutral-400">{label}</span>
      <div className="flex gap-2 rounded-full bg-panelmute p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={value === o.id}
            className={`min-h-11 rounded-full px-3 py-1 text-xs font-semibold sm:min-h-9 ${
              value === o.id ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-700 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ArchiveFilters({ value, onChange }: { value: ArchiveFilter; onChange: (f: ArchiveFilter) => void }) {
  const { t } = useTranslation('stats');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Pills<ResultFilter>
        label={t('archive.filters.resultLabel')}
        ariaLabel={t('archive.filters.resultAria')}
        value={value.result}
        onChange={(result) => onChange({ ...value, result })}
        options={[
          { id: 'all', label: t('archive.filters.all') },
          { id: 'win', label: t('archive.filters.wins') },
          { id: 'draw', label: t('archive.filters.draws') },
          { id: 'loss', label: t('archive.filters.losses') },
        ]}
      />
      <Pills<ColorFilter>
        label={t('archive.filters.colorLabel')}
        ariaLabel={t('archive.filters.colorAria')}
        value={value.color}
        onChange={(color) => onChange({ ...value, color })}
        options={[
          { id: 'all', label: t('archive.filters.any') },
          { id: 'white', label: t('archive.filters.white') },
          { id: 'black', label: t('archive.filters.black') },
        ]}
      />
      <Pills<PeriodFilter>
        label={t('archive.filters.periodLabel')}
        ariaLabel={t('archive.filters.periodAria')}
        value={value.period}
        onChange={(period) => onChange({ ...value, period })}
        options={[
          { id: 'all', label: t('archive.filters.allTime') },
          { id: '7d', label: t('archive.filters.7d') },
          { id: '30d', label: t('archive.filters.30d') },
          { id: '90d', label: t('archive.filters.90d') },
          { id: '365d', label: t('archive.filters.year') },
        ]}
      />
    </div>
  );
}

/** Pulsing placeholder rows while the saved-games fetch is in flight. */
export function ArchiveLoadingRows() {
  const { t } = useTranslation('stats');
  return (
    <div className="space-y-1.5" role="status" aria-label={t('archive.loadingAria')}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-2.5 rounded-xl px-2.5 py-2">
          <span className="h-7 w-7 rounded-full bg-neutral-800" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 rounded bg-neutral-800" />
            <span className="block h-2.5 w-2/3 rounded bg-neutral-800" />
          </span>
          <span className="h-3 w-16 rounded bg-neutral-800" />
        </div>
      ))}
    </div>
  );
}
