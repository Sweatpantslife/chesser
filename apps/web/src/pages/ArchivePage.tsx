/**
 * Profile → Archive (`#/profile/archive`) — the past-games list: server-saved
 * games (signed in) merged with this device's casual games, filterable by
 * result / color / period. Opening a game replays it on `#/play/analysis`
 * (PGN into the game store, then navigate — the `goPlay` prop).
 *
 * Trend/insight widgets deliberately do NOT live here anymore — they moved to
 * Profile → Progress (components/GameInsights) in the stats consolidation.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { useGame } from '../store/game';
import { useAnalysisReport } from '../store/analysisReport';
import { type ArchiveGame, type ArchiveResult } from '../lib/archive';
import { DEFAULT_FILTER, filterGames, type ArchiveFilter } from '../lib/archiveStats';
import { useArchiveGames, useVisibleNow } from '../lib/useArchiveGames';
import { ArchiveFilters, ArchiveLoadingRows } from '../components/ArchiveFilters';
import { playSound } from '../lib/sound';
import { EmptyBoardArt } from '../components/icons';

const RESULT_CHIP_CLS: Record<ArchiveResult, string> = {
  win: 'bg-emerald-900/60 text-emerald-300',
  draw: 'bg-neutral-800 text-neutral-300',
  loss: 'bg-rose-900/60 text-rose-300',
  unknown: 'bg-neutral-800 text-neutral-400',
};

function ResultChip({ result }: { result: ArchiveResult }) {
  const { t } = useTranslation('stats');
  const title = t(`archive.result.${result}Title`);
  return (
    <span title={title} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${RESULT_CHIP_CLS[result]}`}>
      {t(`archive.result.${result}`)}
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** "You played white/black" swatch — chess.* tokens, never the neutral ramp. */
function ColorDot({ color }: { color: 'white' | 'black' }) {
  const { t } = useTranslation('stats');
  return (
    <span
      title={t(`archive.youPlayed.${color}`)}
      className={`h-3 w-3 shrink-0 rounded-[4px] ring-1 ring-neutral-600 ${color === 'white' ? 'bg-chess-white' : 'bg-chess-black'}`}
    />
  );
}

function GameRow({ game, onOpen }: { game: ArchiveGame; onOpen: (g: ArchiveGame) => void }) {
  const { t } = useTranslation('stats');
  const title = game.userColor && game.opponent
    ? t('archive.row.youVs', { opponent: game.opponent })
    : t('archive.row.whiteVsBlack', { white: game.white, black: game.black });
  const subtitle = [
    t(`archive.kind.${game.kind}`),
    game.moves > 0 ? t('archive.row.moves', { count: game.moves }) : null,
    game.opening?.name ?? null,
    game.resultRaw !== '*' ? game.resultRaw : t('archive.row.unfinished'),
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <>
      <ResultChip result={game.result} />
      {game.userColor && <ColorDot color={game.userColor} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-neutral-200">{title}</span>
        <span className="block truncate text-xs text-neutral-400">{subtitle}</span>
      </span>
      {game.accuracy != null && (
        <span title={t('archive.row.accuracyTitle')} className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-brand-300">
          {t('percent', { value: game.accuracy.toFixed(1) })}
        </span>
      )}
      {/* Deliberately LOCAL time (unlike the UTC-bucketed charts): the list
          answers "when did I play this?" in the user's own timezone. A game
          played late evening west of UTC may therefore sit in the next day's
          chart bucket — the tooltip carries the exact time. */}
      <span title={new Date(game.playedAt).toLocaleString()} className="shrink-0 text-xs text-neutral-400">
        {new Date(game.playedAt).toLocaleDateString()}
      </span>
    </>
  );

  // Not openable: casual games never store moves; a saved game without a
  // gameKey has a PGN that didn't parse (or holds no moves) — a clickable row
  // would silently no-op, since openGame only navigates when loadPgn succeeds.
  if (!game.pgn || !game.gameKey) {
    return (
      <div
        title={!game.pgn ? t('archive.row.casualNoMoves') : t('archive.row.unreadablePgn')}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
      >
        {body}
      </div>
    );
  }
  return (
    <button
      onClick={() => onOpen(game)}
      title={t('archive.row.openTitle')}
      className="btn-press flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-neutral-800"
    >
      {body}
    </button>
  );
}

const LIST_PREVIEW = 30;

export function ArchivePage({ goPlay }: { goPlay: () => void }) {
  const { t } = useTranslation('stats');
  const token = useAuth((s) => s.token);

  const { games, loading, loadError, retry } = useArchiveGames();
  const [filter, setFilter] = useState<ArchiveFilter>(DEFAULT_FILTER);
  const now = useVisibleNow();
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => filterGames(games, filter, now), [games, filter, now]);
  const filterActive = filter.result !== 'all' || filter.color !== 'all' || filter.period !== 'all';

  const openGame = (g: ArchiveGame) => {
    if (!g.pgn) return;
    playSound('uiClick');
    if (useGame.getState().loadPgn(g.pgn)) {
      // Re-light a cached review instantly (same path the Play page uses);
      // without one, the Review button there runs the engine as usual.
      useAnalysisReport.getState().tryHydrateFromCache();
      goPlay();
    }
  };

  const visible = showAll ? filtered : filtered.slice(0, LIST_PREVIEW);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">{t('archive.title')}</h1>
          <p className="text-xs text-neutral-400">{t('archive.subtitle')}</p>
        </div>
        <ArchiveFilters value={filter} onChange={setFilter} />
      </div>

      {loadError && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-xl bg-panel px-3 py-2 text-sm text-amber-300">
          {t('archive.loadError')}
          <button onClick={retry} className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-200 hover:bg-neutral-700">
            {t('archive.retry')}
          </button>
        </p>
      )}

      <div className="rounded-2xl bg-panel p-3 shadow-soft">
        {loading ? (
          <ArchiveLoadingRows />
        ) : games.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center text-sm text-neutral-400 sm:flex-row sm:text-left">
            <EmptyBoardArt width={150} height={112} className="shrink-0" />
            <div>
              <div className="mb-1 font-display text-base font-semibold text-ink">{t('archive.empty.title')}</div>
              {t('archive.empty.body')}
              {!token && <> {t('archive.empty.signIn')}</>}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-neutral-400">
            {t('archive.noMatch')}
            <button
              onClick={() => setFilter(DEFAULT_FILTER)}
              className="rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
            >
              {t('archive.filters.clear')}
            </button>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between px-1 text-xs text-neutral-400">
              <span>
                {t('archive.count', { count: filtered.length })}
                {filterActive ? ` ${t('archive.filteredSuffix')}` : ''}
              </span>
              {!token && <span>{t('archive.signInHint')}</span>}
            </div>
            <ul className="space-y-0.5">
              {visible.map((g) => (
                <li key={g.id}>
                  <GameRow game={g} onOpen={openGame} />
                </li>
              ))}
            </ul>
            {filtered.length > LIST_PREVIEW && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 min-h-11 w-full rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700 sm:min-h-0"
              >
                {showAll ? t('archive.showFewer') : t('archive.showAll', { count: filtered.length })}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
