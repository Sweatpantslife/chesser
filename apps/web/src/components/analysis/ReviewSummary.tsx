/**
 * ReviewSummary — the game-report header card. Props-only (no store imports):
 * PlayPage wires report + reviewing + callbacks in.
 *
 * Renders per-player accuracy / ACPL / estimated performance rating, the
 * classification-count table (click a count to filter the move list), the
 * opening line with the theory-departure point, the per-phase accuracy table
 * (click a phase to jump to its first ply) and the clickable critical-moments
 * list. Shows a skeleton while a re-review is running.
 */
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { CLASSIFICATION_META } from '../../lib/coach';
import { CLASSIFICATION_GLYPH } from '../../lib/analytics/types';
import type {
  AnalysisReport,
  Classification,
  CriticalMomentKind,
  PhaseStats,
  PlayerSummary,
  Side,
} from '../../lib/analytics/types';

export interface ReviewSummaryProps {
  report: AnalysisReport;
  /** Show a skeleton while a re-review runs (useGame.reviewing, via PlayPage). */
  reviewing: boolean;
  /** Critical-moment rows and phase rows jump the board here. */
  onSelectPly(ply: number): void;
  /** Optional: clicking a classification count filters the move list. */
  onFilterClass?(cls: Classification): void;
  /** Omit to hide the export button. */
  onExportPgn?(): void;
}

/** Display order for the classification-count table. */
const CLASS_ORDER: Classification[] = [
  'brilliant',
  'great',
  'best',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'blunder',
  'miss',
];

/**
 * Classes whose counts click through to the mistake list — only those the
 * MistakeReviewPanel can actually filter to (no dead buttons on best/good).
 */
const FILTERABLE: ReadonlySet<Classification> = new Set<Classification>(['inaccuracy', 'mistake', 'blunder', 'miss']);

const KIND_META: Record<CriticalMomentKind, { icon: string; text: string }> = {
  blunder: { icon: '??', text: 'text-rose-300' },
  'missed-win': { icon: '✗', text: 'text-rose-300' },
  turnaround: { icon: '⇄', text: 'text-blue-300' },
  brilliant: { icon: '!!', text: 'text-cyan-300' },
  mate: { icon: '#', text: 'text-emerald-300' },
};

/**
 * Theory-departure line for the opening card. `leftTheoryAtPly` is the last
 * mainline ply still in book; the first out-of-book ply is the next one, so
 * its move number is ceil((leftTheoryAtPly + 1) / 2). Empty games get ''.
 */
export function theoryText(leftTheoryAtPly: number, totalPlies: number): string {
  // Plain function (called from tests too) — resolve t at call time so the
  // string follows the active language.
  const t = i18n.getFixedT(null, 'analysis');
  if (totalPlies === 0) return '';
  if (leftTheoryAtPly >= totalPlies) return t('report.theoryThroughout');
  return t('report.theoryLeftAt', { move: Math.ceil((Math.max(0, leftTheoryAtPly) + 1) / 2) });
}

function PlayerCard({ side, summary, rating, isYou }: { side: Side; summary: PlayerSummary; rating: number; isYou: boolean }) {
  const { t } = useTranslation('analysis');
  return (
    <div className="rounded-xl bg-neutral-800/60 p-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-neutral-600 ${side === 'white' ? 'bg-chess-white' : 'bg-chess-black'}`}
        />
        <span className="text-xs font-semibold capitalize text-neutral-300">{t(`side.${side}`)}</span>
        {isYou && (
          <span className="rounded-full bg-brand-500/20 px-1.5 text-[10px] font-semibold text-brand-300">{t('report.you')}</span>
        )}
      </div>
      <div className="mt-1.5 font-display text-2xl font-bold leading-none text-emerald-300">
        {summary.accuracy}
        <span className="text-sm font-semibold">%</span>
      </div>
      <div className="mt-1.5 text-[11px] leading-tight text-neutral-400">
        <div title={t('report.acplTitle')}>{t('report.acpl', { value: summary.acpl })}</div>
        <div title={t('report.estRatingTitle')}>{t('report.estRating', { rating })}</div>
      </div>
    </div>
  );
}

function CountCell({ side, cls, count, onFilterClass }: { side: Side; cls: Classification; count: number; onFilterClass?: (cls: Classification) => void }) {
  const { t } = useTranslation('analysis');
  if (!onFilterClass) return <span className="text-neutral-300">{count}</span>;
  return (
    <button
      data-count={`${side}-${cls}`}
      onClick={() => onFilterClass(cls)}
      disabled={count === 0}
      title={count > 0 ? t('report.showMoves', { label: CLASSIFICATION_META[cls].label.toLowerCase() }) : undefined}
      className="btn-press w-full rounded px-1 py-0.5 text-neutral-300 enabled:hover:bg-neutral-700 enabled:hover:text-ink disabled:text-neutral-600"
    >
      {count}
    </button>
  );
}

export function ReviewSummary({ report, reviewing, onSelectPly, onFilterClass, onExportPgn }: ReviewSummaryProps): JSX.Element {
  const { t } = useTranslation('analysis');
  const { white, black, opening, phases, criticalMoments, estimatedPerformanceRating: rating, meta } = report;
  const theory = theoryText(opening.leftTheoryAtPly, report.moves.length);
  const phaseEmpty = (p: PhaseStats) => p.endPly < p.startPly || p.white.moves + p.black.moves === 0;

  return (
    <div className="rounded-2xl bg-panel p-3 shadow-soft">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{t('report.title')}</h3>
        {onExportPgn && (
          <button
            onClick={onExportPgn}
            className="btn-press rounded-lg px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            {t('report.exportPgn')}
          </button>
        )}
      </div>

      {reviewing ? (
        <div className="mt-2 animate-pulse space-y-2" data-skeleton>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-20 rounded-xl bg-neutral-800" />
            <div className="h-20 rounded-xl bg-neutral-800" />
          </div>
          <div className="h-28 rounded-xl bg-neutral-800" />
          <div className="h-16 rounded-xl bg-neutral-800" />
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <PlayerCard side="white" summary={white} rating={rating.white} isYou={meta.playerColor === 'white'} />
            <PlayerCard side="black" summary={black} rating={rating.black} isYou={meta.playerColor === 'black'} />
          </div>

          <table className="w-full text-xs">
            <tbody>
              {CLASS_ORDER.map((cls) => (
                <tr key={cls}>
                  <td className="w-10 text-center">
                    <CountCell side="white" cls={cls} count={white.counts[cls]} onFilterClass={FILTERABLE.has(cls) ? onFilterClass : undefined} />
                  </td>
                  <td className="py-0.5 text-center">
                    <span className={`mr-1.5 inline-block w-5 text-right font-semibold ${CLASSIFICATION_META[cls].text}`}>
                      {CLASSIFICATION_GLYPH[cls]}
                    </span>
                    <span className="text-neutral-400">{CLASSIFICATION_META[cls].label}</span>
                  </td>
                  <td className="w-10 text-center">
                    <CountCell side="black" cls={cls} count={black.counts[cls]} onFilterClass={FILTERABLE.has(cls) ? onFilterClass : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-neutral-800 pt-2">
            {opening.name ? (
              <>
                <div className="flex items-baseline gap-2">
                  {opening.eco && (
                    <span className="rounded bg-neutral-700 px-1.5 py-0.5 font-mono text-[11px] text-neutral-200">{opening.eco}</span>
                  )}
                  <span className="min-w-0 flex-1 text-xs leading-tight text-neutral-200">{opening.name}</span>
                </div>
                {theory && <p className="mt-1 text-[11px] text-neutral-400">{theory}</p>}
              </>
            ) : (
              <p className="text-xs text-neutral-400">{t('report.noBookOpening')}</p>
            )}
          </div>

          <div className="border-t border-neutral-800 pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-400">
                  <th className="text-left font-normal">{t('report.header.phase')}</th>
                  <th className="w-14 text-center font-normal">{t('report.header.white')}</th>
                  <th className="w-14 text-center font-normal">{t('report.header.black')}</th>
                </tr>
              </thead>
              <tbody className="text-neutral-300">
                {phases.map((p) => {
                  const empty = phaseEmpty(p);
                  return (
                    <tr key={p.phase}>
                      <td className="py-0.5">
                        {empty ? (
                          <span className="text-neutral-400">{t(`phase.${p.phase}`)}</span>
                        ) : (
                          <button
                            data-phase={p.phase}
                            onClick={() => onSelectPly(p.startPly)}
                            title={t('report.phaseJumpTitle')}
                            className="text-left text-neutral-300 hover:text-ink hover:underline"
                          >
                            {t(`phase.${p.phase}`)}
                          </button>
                        )}
                      </td>
                      <td className="text-center">{empty ? '—' : t('percent', { value: p.white.accuracy })}</td>
                      <td className="text-center">{empty ? '—' : t('percent', { value: p.black.accuracy })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {criticalMoments.length > 0 && (
            <div className="border-t border-neutral-800 pt-2">
              <h4 className="text-[11px] uppercase tracking-wide text-neutral-400">{t('report.keyMoments')}</h4>
              <div className="mt-1 space-y-0.5">
                {criticalMoments.map((c) => (
                  <button
                    key={c.ply}
                    data-moment-ply={c.ply}
                    onClick={() => onSelectPly(c.ply)}
                    className="btn-press flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-neutral-700/60"
                  >
                    <span className={`w-5 shrink-0 text-center font-semibold ${KIND_META[c.kind].text}`}>{KIND_META[c.kind].icon}</span>
                    <span className="min-w-0 flex-1 leading-tight text-neutral-300">{c.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
