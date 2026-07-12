import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../store/auth';
import { useSocial } from '../store/social';
import { apiFetchBoard, type BoardId, type BoardResponse, type BoardScope } from '../lib/socialApi';
import { IconTrophy } from '../components/icons';

/**
 * Async leaderboards: puzzle rating, bot rating and Puzzle Rush best — global
 * (all-time) and per ISO week. Opt-in only; scores are validated server-side
 * against the account's synced progress, never trusted from the client.
 */

const BOARD_TABS: { id: BoardId; icon: string }[] = [
  { id: 'puzzles', icon: '🧩' },
  { id: 'bots', icon: '♟️' },
  { id: 'rush', icon: '🏃' },
];

const SCOPES: BoardScope[] = ['global', 'weekly'];

const MEDALS = ['🥇', '🥈', '🥉'];

function valueHeading(board: BoardId, t: TFunction<'leaders'>): string {
  return t(board === 'rush' ? 'value.best' : 'value.rating');
}

/** "2026-W28" → "Week 28, 2026". */
function weekLabel(weekKey: string, t: TFunction<'leaders'>): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  return m ? t('week', { week: Number(m[2]), year: m[1] }) : weekKey;
}

function JoinCard({ signedIn, onJoined }: { signedIn: boolean; onJoined: () => void }) {
  const { t } = useTranslation('leaders');
  const save = useSocial((s) => s.save);
  const busy = useSocial((s) => s.busy);
  const error = useSocial((s) => s.error);
  return (
    <div className="rounded-2xl bg-panel p-5 text-center shadow-soft">
      <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600/20 text-brand-300">
        <IconTrophy size={24} />
      </div>
      <h3 className="font-display text-sm font-semibold text-ink">{t('join.title')}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs text-neutral-400">
        {signedIn ? t('join.signedIn') : t('join.signedOut')}
      </p>
      {signedIn && (
        <button
          onClick={() =>
            void save({ leaderboards: true }).then((ok) => {
              // Refetch once the server holds the opt-in (and the first scores).
              if (ok) onJoined();
            })
          }
          disabled={busy}
          className="btn-press mt-3 rounded-full bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? t('join.joining') : t('join.cta')}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function LeaderboardsPage({ onViewProfile }: { onViewProfile: (username: string) => void }) {
  const { t } = useTranslation('leaders');
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username);
  const prefs = useSocial((s) => s.prefs);
  const prefsError = useSocial((s) => s.error);
  const loadPrefs = useSocial((s) => s.load);
  const submitScores = useSocial((s) => s.submitScores);

  const [board, setBoard] = useState<BoardId>('puzzles');
  const [scope, setScope] = useState<BoardScope>('global');
  const [data, setData] = useState<BoardResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const optedIn = prefs?.leaderboards === true;

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      // Push our latest scores first so the ranking the player sees includes
      // them (server-side validation still decides what counts).
      if (token && useSocial.getState().prefs?.leaderboards) await submitScores();
      const res = await apiFetchBoard(board, scope, token, 25);
      setData(res);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [board, scope, token, submitScores]);

  useEffect(() => {
    void refresh();
  }, [refresh, optedIn]);

  const meOutsideTop =
    data?.me && data.me.rank !== null && !data.entries.some((e) => e.username === username) ? data.me : null;

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">{t('title')}</h1>
          <p className="text-xs text-neutral-400">{t('subtitle')}</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-full border border-neutral-700 text-xs" role="group" aria-label={t('scopeAria')}>
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={`btn-press min-h-11 px-3 py-1.5 font-semibold sm:min-h-0 ${
                scope === s ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {t(`scopes.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <nav aria-label={t('navAria')} className="flex gap-1 overflow-x-auto">
        {BOARD_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setBoard(tab.id)}
            title={t(`tabs.${tab.id}.hint`)}
            aria-current={board === tab.id ? 'true' : undefined}
            className={`btn-press flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold sm:min-h-9 ${
              board === tab.id
                ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-ink'
            }`}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {t(`tabs.${tab.id}.label`)}
          </button>
        ))}
      </nav>

      {/* Only render the join CTA once the signed-in prefs have loaded — an
          opted-in player must not see it flash while prefs are in flight. */}
      {(!token || prefs !== null) && !optedIn && <JoinCard signedIn={!!token} onJoined={() => void refresh()} />}

      {/* A failed prefs fetch must not be silent: with prefs still null the
          join CTA above never mounts, so surface the error + retry here. */}
      {token && prefs === null && prefsError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-panel p-4 shadow-soft">
          <p className="text-sm text-rose-400">{t('prefsError', { error: prefsError })}</p>
          <button
            onClick={() => void loadPrefs()}
            className="btn-press rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink"
          >
            {t('retry')}
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-panel p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-ink">
            {t(`tabs.${board}.hint`)}
            {scope === 'weekly' && data && <span className="ml-2 font-normal text-neutral-400">· {weekLabel(data.weekKey, t)}</span>}
          </h3>
          <button
            onClick={() => void refresh()}
            className="btn-press rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink"
          >
            {t('refresh')}
          </button>
        </div>

        {state === 'loading' && (
          <p role="status" className="py-8 text-center text-sm text-neutral-400">
            {t('loading')}
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="py-8 text-center text-sm text-rose-400">
            {t('error')}
          </p>
        )}
        {state === 'ready' && data && data.entries.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">
            {scope === 'weekly' ? t('empty.weekly') : t('empty.global')}
          </p>
        )}

        {state === 'ready' && data && data.entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {t('caption', {
                  count: data.total,
                  heading: valueHeading(board, t),
                  scope: scope === 'weekly' ? weekLabel(data.weekKey, t) : t('allTime'),
                })}
              </caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th scope="col" className="w-14 px-2 py-2">
                    {t('columns.rank')}
                  </th>
                  <th scope="col" className="px-2 py-2">
                    {t('columns.player')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    {valueHeading(board, t)}
                  </th>
                  {board !== 'rush' && (
                    <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell">
                      {t('columns.games')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => {
                  const isMe = e.username === username;
                  return (
                    <tr
                      key={e.username}
                      className={`border-t border-neutral-800/70 ${isMe ? 'bg-brand-600/10' : ''}`}
                    >
                      <td className="px-2 py-2 font-semibold text-neutral-300">
                        {e.rank <= 3 ? (
                          <span aria-hidden="true" className="mr-1">
                            {MEDALS[e.rank - 1]}
                          </span>
                        ) : null}
                        <span className={e.rank <= 3 ? 'sr-only' : undefined}>{e.rank}</span>
                      </td>
                      <td className="px-2 py-1">
                        {/* ≥44px touch target — the row's whole interactive area. */}
                        <button
                          onClick={() => onViewProfile(e.username)}
                          className="btn-press inline-flex min-h-11 items-center font-semibold text-brand-300 hover:text-brand-200 hover:underline"
                          title={t('viewProfile', { username: e.username })}
                        >
                          {e.username}
                        </button>
                        {isMe && (
                          <span className="ml-2 rounded-full bg-brand-600/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-200">
                            {t('you')}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-display font-bold text-ink">{e.value}</td>
                      {board !== 'rush' && (
                        <td className="hidden px-2 py-2 text-right text-neutral-400 sm:table-cell">{e.played ?? '—'}</td>
                      )}
                    </tr>
                  );
                })}
                {meOutsideTop && (
                  <tr className="border-t-2 border-dashed border-neutral-700 bg-brand-600/10">
                    <td className="px-2 py-2 font-semibold text-neutral-300">{meOutsideTop.rank}</td>
                    <td className="px-2 py-2">
                      <span className="font-semibold text-ink">{username}</span>
                      <span className="ml-2 rounded-full bg-brand-600/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-200">
                        {t('you')}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-display font-bold text-ink">{meOutsideTop.value}</td>
                    {board !== 'rush' && <td className="hidden px-2 py-2 sm:table-cell" />}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {state === 'ready' && data && optedIn && data.me?.rank === null && (
          <p className="mt-3 text-center text-xs text-neutral-400">
            {board === 'rush' ? t('hint.rush') : t('hint.other')}
          </p>
        )}
      </div>

      <p className="text-center text-xs text-neutral-400">
        {t('footer')}
      </p>
    </div>
  );
}
