/**
 * Game insights — the trend widgets that used to be the Archive page's
 * "Insights" tab, consolidated onto Profile → Progress (stats plan C3):
 * W/D/L split, rating & accuracy trends, most-played openings and the
 * coach-digest strengths & weaknesses, all over the same Result/Color/Period
 * slice the Archive list offers.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRatings } from '../store/ratings';
import { useSettings } from '../store/settings';
import { bootstrapFromReportCache, useCoach } from '../store/coach';
import {
  accuracyPoints,
  averageAccuracy,
  bucketTrend,
  DEFAULT_FILTER,
  filterGames,
  openingCounts,
  periodStart,
  pickBucketSize,
  ratingSeries,
  wdlCounts,
  type ArchiveFilter,
  type TrendPoint,
  type WdlCounts,
} from '../lib/archiveStats';
import { buildWeaknessProfile } from '../lib/weakness';
import { useArchiveGames, useVisibleNow } from '../lib/useArchiveGames';
import { ArchiveFilters, ArchiveLoadingRows } from './ArchiveFilters';
import { StatCard } from './Charts';
import { EmptyStatsArt } from './icons';

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {aside && <span className="text-right text-xs text-neutral-400">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** Win/draw/loss split: counts as text (never color alone) + a stacked bar. */
function WdlBar({ counts, label }: { counts: WdlCounts; label: string }) {
  const { t } = useTranslation('stats');
  const decided = counts.wins + counts.draws + counts.losses;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-400">
          <span className="font-semibold text-emerald-300">{t('archive.wdl.winsShort', { count: counts.wins })}</span>
          {' · '}
          <span className="text-neutral-300">{t('archive.wdl.drawsShort', { count: counts.draws })}</span>
          {' · '}
          <span className="font-semibold text-rose-300">{t('archive.wdl.lossesShort', { count: counts.losses })}</span>
          {counts.winRate != null && <span> · {t('archive.wdl.winRate', { rate: counts.winRate })}</span>}
        </span>
      </div>
      {decided > 0 ? (
        <div
          className="flex h-2.5 w-full gap-0.5"
          role="img"
          aria-label={t('archive.wdl.splitAria', { wins: counts.wins, draws: counts.draws, losses: counts.losses })}
        >
          {counts.wins > 0 && (
            <div title={t('archive.wdl.winsTitle', { count: counts.wins })} className="rounded-full bg-emerald-600" style={{ flexGrow: counts.wins, flexBasis: 0 }} />
          )}
          {counts.draws > 0 && (
            <div title={t('archive.wdl.drawsTitle', { count: counts.draws })} className="rounded-full bg-neutral-500" style={{ flexGrow: counts.draws, flexBasis: 0 }} />
          )}
          {counts.losses > 0 && (
            <div title={t('archive.wdl.lossesTitle', { count: counts.losses })} className="rounded-full bg-rose-600" style={{ flexGrow: counts.losses, flexBasis: 0 }} />
          )}
        </div>
      ) : (
        <div className="h-2.5 w-full rounded-full bg-neutral-800" />
      )}
    </div>
  );
}

interface ChartSeries {
  label: string;
  /** A theme-aware CSS color (var(--c-…)) — both themes keep it AA vs panel. */
  color: string;
  points: TrendPoint[];
  /** Formats a value for tooltips/labels (e.g. adds '%'). */
  format: (v: number) => string;
}

/** Chart timestamps are UTC bucket starts (see lib/archiveStats bucketStart) /
 *  UTC-midnight rating days — format them in UTC so the label matches the
 *  bucket's ISO date instead of drifting a day west of Greenwich. */
const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Minimal theme-token line chart (one y-axis, 1–2 series). Identity is never
 * color-alone: every series is named in the legend with its latest value, and
 * each dot carries a native tooltip.
 */
function TrendChart({ series }: { series: ChartSeries[] }) {
  const { t } = useTranslation('stats');
  const drawn = series.filter((s) => s.points.length > 0);
  const all = drawn.flatMap((s) => s.points);
  if (all.length === 0) return null; // callers render their own empty state
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  let v0 = Math.min(...all.map((p) => p.value));
  let v1 = Math.max(...all.map((p) => p.value));
  if (v1 - v0 < 1) {
    v0 -= 1;
    v1 += 1;
  }
  const pad = (v1 - v0) * 0.1;
  const lo = v0 - pad;
  const hi = v1 + pad;
  const H = 100;
  const x = (t: number) => (t1 === t0 ? 50 : ((t - t0) / (t1 - t0)) * 100);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const fmt = drawn[0]!.format;

  return (
    <div>
      <div className="flex items-stretch gap-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 min-w-0 flex-1" role="img" aria-label={t('archive.trend.chartAria')}>
          <line x1={0} y1={y((v0 + v1) / 2)} x2={100} y2={y((v0 + v1) / 2)} stroke="var(--c-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {drawn.map((s) => (
            <g key={s.label}>
              {s.points.length > 1 && (
                <polyline
                  points={s.points.map((p) => `${x(p.t)},${y(p.value)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {s.points.length <= 60 &&
                s.points.map((p) => (
                  <circle key={p.t} cx={x(p.t)} cy={y(p.value)} r={1.6} fill={s.color}>
                    <title>{t('archive.trend.pointTitle', { label: s.label, date: shortDate(p.t), value: s.format(p.value) })}</title>
                  </circle>
                ))}
            </g>
          ))}
        </svg>
        <div className="flex shrink-0 flex-col justify-between py-0.5 text-right text-xs text-neutral-400">
          <span>{fmt(v1)}</span>
          <span>{fmt(v0)}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span>
          {shortDate(t0)}
          {t1 !== t0 && <> – {shortDate(t1)}</>}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          {drawn.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="font-semibold text-neutral-300">{s.format(s.points[s.points.length - 1]!.value)}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function EmptyChartNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-24 items-center justify-center rounded-xl border border-dashed border-neutral-700 px-3 text-center text-sm text-neutral-400">
      {children}
    </p>
  );
}

export function GameInsights() {
  const { t } = useTranslation('stats');
  const { games, loading, loadError, retry } = useArchiveGames();
  const [filter, setFilter] = useState<ArchiveFilter>(DEFAULT_FILTER);
  const now = useVisibleNow();

  // Coach digests back-fill from the report cache (same as the Coach tab).
  useEffect(() => {
    bootstrapFromReportCache();
  }, []);

  const filtered = useMemo(() => filterGames(games, filter, now), [games, filter, now]);
  const filterActive = filter.result !== 'all' || filter.color !== 'all' || filter.period !== 'all';

  const meter = useSettings((s) => s.ratingMeter);
  const botsHistory = useRatings((s) => s.categories.bots.history);
  const blitzHistory = useRatings((s) => s.categories.blitz.history);
  const coachGames = useCoach((s) => s.games);

  const wdl = useMemo(() => wdlCounts(filtered), [filtered]);
  const wdlWhite = useMemo(() => wdlCounts(filtered.filter((g) => g.userColor === 'white')), [filtered]);
  const wdlBlack = useMemo(() => wdlCounts(filtered.filter((g) => g.userColor === 'black')), [filtered]);
  const avgAcc = useMemo(() => averageAccuracy(filtered), [filtered]);
  const reviewed = useMemo(() => filtered.filter((g) => g.accuracy != null).length, [filtered]);
  const accTrend = useMemo(() => {
    const pts = accuracyPoints(filtered);
    return bucketTrend(pts, pickBucketSize(pts)).map((b) => ({ t: b.start, value: b.value }));
  }, [filtered]);
  const openingsTop = useMemo(() => openingCounts(filtered, 6), [filtered]);
  const ratingLines = useMemo(() => {
    const from = periodStart(filter.period, now);
    const pct = (v: number) => `${Math.round(v)}`;
    return [
      { label: t('archive.series.bots'), color: 'var(--c-brand-400)', points: ratingSeries(botsHistory, meter).filter((p) => p.t >= from), format: pct },
      { label: t('archive.series.blitz'), color: 'var(--c-gold-400)', points: ratingSeries(blitzHistory, meter).filter((p) => p.t >= from), format: pct },
    ].filter((l) => l.points.length > 0);
  }, [botsHistory, blitzHistory, meter, filter.period, now, t]);
  // Coach digests carry the review's result / player colour / timestamp, so
  // the strengths & weaknesses card can honour the same Result/Color/Period
  // slice as every sibling insights section (digest createdAt plays the role
  // of playedAt — the same "when it entered the archive" semantics saved
  // games use).
  const digestCount = useMemo(() => Object.keys(coachGames).length, [coachGames]);
  const profile = useMemo(() => {
    const sliced = filterGames(
      Object.values(coachGames).map((d) => ({ digest: d, result: d.result, userColor: d.playerColor, playedAt: d.createdAt })),
      filter,
      now,
    );
    return buildWeaknessProfile(sliced.map((s) => s.digest));
  }, [coachGames, filter, now]);
  const strengths = useMemo(() => {
    const out: string[] = [];
    const phases = profile.phases.filter((p) => p.moves > 0).sort((a, b) => b.accuracy - a.accuracy);
    if (phases[0]) {
      out.push(t('archive.strengths.phase', { phase: t(`archive.phaseNames.${phases[0].phase}`), accuracy: phases[0].accuracy }));
    }
    const w = profile.colors.white;
    const b = profile.colors.black;
    if (w.games > 0 && b.games > 0 && w.accuracy !== b.accuracy) {
      const better = w.accuracy > b.accuracy ? ('white' as const) : ('black' as const);
      const bt = better === 'white' ? w : b;
      const ot = better === 'white' ? b : w;
      out.push(t('archive.strengths.color', { side: t(`archive.sides.${better}`), better: bt.accuracy, other: ot.accuracy }));
    }
    for (const entry of profile.weaknesses) {
      // entry.meta.label comes from lib/weakness (stores group) — passed through untranslated.
      if (entry.trend != null && entry.trend < 0) out.push(t('archive.strengths.improving', { label: entry.meta.label.toLowerCase() }));
    }
    return out;
  }, [profile, t]);

  // Rating history lives in the ratings store, not the archive — the trend can
  // (and should) render even when no archived game matches the current slice.
  const ratingSection = (
    <Section title={t('archive.sections.ratingTrend')} aside={t('archive.sections.ratingTrendAside', { meter })}>
      {ratingLines.length > 0 ? (
        <TrendChart series={ratingLines} />
      ) : (
        <EmptyChartNote>{t('archive.sections.ratingTrendEmpty')}</EmptyChartNote>
      )}
    </Section>
  );

  if (loading) {
    return (
      <div className="rounded-2xl bg-panel p-3 shadow-soft">
        <ArchiveLoadingRows />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ArchiveFilters value={filter} onChange={setFilter} />

      {loadError && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-xl bg-panel px-3 py-2 text-sm text-amber-300">
          {t('archive.loadError')}
          <button onClick={retry} className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-200 hover:bg-neutral-700">
            {t('archive.retry')}
          </button>
        </p>
      )}

      {filtered.length === 0 ? (
        <>
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-700 bg-panel/60 p-6 text-center text-sm text-neutral-400 sm:flex-row sm:text-left">
            <EmptyStatsArt width={150} height={112} className="shrink-0" />
            <div>
              <div className="mb-1 font-display text-base font-semibold text-ink">
                {games.length === 0 ? t('archive.insightsEmpty.noGamesTitle') : t('archive.insightsEmpty.noSliceTitle')}
              </div>
              {games.length === 0 ? t('archive.insightsEmpty.noGamesBody') : t('archive.insightsEmpty.noSliceBody')}
            </div>
          </div>
          {ratingLines.length > 0 && ratingSection}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('archive.stats.games')} value={wdl.total} hint={filterActive ? t('archive.stats.inSlice') : t('archive.stats.allTime')} />
            <StatCard label={t('archive.stats.record')} value={`${wdl.wins}-${wdl.draws}-${wdl.losses}`} hint={t('archive.stats.recordHint')} />
            <StatCard
              label={t('archive.stats.winRate')}
              value={wdl.winRate != null ? t('percent', { value: wdl.winRate }) : '—'}
              hint={wdl.unknown > 0 ? t('archive.stats.noResult', { count: wdl.unknown }) : t('archive.stats.withResult')}
            />
            <StatCard
              label={t('archive.stats.accuracy')}
              value={avgAcc != null ? t('percent', { value: avgAcc }) : '—'}
              hint={reviewed > 0 ? t('archive.stats.avgReviews', { count: reviewed }) : t('archive.stats.noReviews')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title={t('archive.sections.wdl')}>
              <div className="space-y-3">
                <WdlBar counts={wdl} label={t('archive.wdl.allGames')} />
                <WdlBar counts={wdlWhite} label={t('archive.wdl.asWhite')} />
                <WdlBar counts={wdlBlack} label={t('archive.wdl.asBlack')} />
              </div>
            </Section>

            {ratingSection}

            <Section title={t('archive.sections.accuracyTrend')} aside={t('archive.sections.accuracyTrendAside')}>
              {accTrend.length > 0 ? (
                <TrendChart series={[{ label: t('archive.series.accuracy'), color: 'var(--c-brand-400)', points: accTrend, format: (v) => `${v}%` }]} />
              ) : (
                <EmptyChartNote>{t('archive.sections.accuracyTrendEmpty')}</EmptyChartNote>
              )}
            </Section>

            <Section title={t('archive.sections.openings')}>
              {openingsTop.length > 0 ? (
                <ul className="space-y-2">
                  {openingsTop.map((o) => (
                    <li key={o.name} className="flex items-center gap-2">
                      {o.eco && <span className="w-9 shrink-0 rounded bg-neutral-800 px-1 py-0.5 text-center font-mono text-xs text-neutral-300">{o.eco}</span>}
                      <span className="min-w-0 flex-1 truncate text-sm text-neutral-200" title={o.name}>
                        {o.name}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400">
                        {t('archive.count', { count: o.games })} ·{' '}
                        <span className="font-semibold text-emerald-300">{t('archive.wdl.winsShort', { count: o.wins })}</span>{' '}
                        <span className="text-neutral-300">{t('archive.wdl.drawsShort', { count: o.draws })}</span>{' '}
                        <span className="font-semibold text-rose-300">{t('archive.wdl.lossesShort', { count: o.losses })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyChartNote>{t('archive.sections.openingsEmpty')}</EmptyChartNote>
              )}
            </Section>
          </div>

          <Section title={t('archive.sections.sw')} aside={t('archive.sections.swAside')}>
            {profile.games === 0 ? (
              <EmptyChartNote>
                {digestCount > 0 ? t('archive.profileEmpty.filtered') : t('archive.profileEmpty.none')}
              </EmptyChartNote>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">{t('archive.strengths.title')}</h4>
                  {strengths.length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-neutral-200">
                      {strengths.map((s) => (
                        <li key={s} className="flex items-start gap-2">
                          <span aria-hidden className="mt-0.5 text-emerald-400">✓</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-neutral-400">{t('archive.strengths.empty')}</p>
                  )}
                </div>
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-300">{t('archive.weaknesses.title')}</h4>
                  {profile.weaknesses.length > 0 ? (
                    <ul className="space-y-2">
                      {profile.weaknesses.slice(0, 3).map((w) => (
                        <li key={w.kind} className="text-sm text-neutral-200">
                          <span className="mr-1.5" aria-hidden>
                            {w.meta.icon}
                          </span>
                          {w.meta.label}
                          <span className="ml-1.5 text-xs text-neutral-400">
                            {t('archive.weaknesses.occurrences', { times: w.count, count: w.games })}
                            {w.trend != null && (w.trend < 0 ? t('archive.weaknesses.improving') : w.trend > 0 ? t('archive.weaknesses.rising') : '')}
                          </span>
                          <span className="block text-xs text-neutral-400">{w.meta.summary}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-neutral-400">{t('archive.weaknesses.empty')}</p>
                  )}
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
