/**
 * Friends & challenges panel (Friends tab, menu screen).
 *
 * Account-based async social: add friends by username or friend code, answer
 * requests, challenge a friend to a live game, and skim a feed of friends'
 * shared activity. The server is authoritative for all of it — this panel
 * refreshes on mount and on a short poll while the tab is visible.
 *
 * Challenge hand-off: accepting calls the REST endpoint, which creates a
 * normal friend-link room and seats the accepter; the returned seat is saved
 * exactly like a WebSocket-created one, then `onJoinGame` drops into the
 * ordinary OnlineGame flow. The challenger's next poll sees the room code on
 * the accepted challenge and auto-joins the open seat.
 */
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
import type { FriendColor, FriendTimeControl } from '@chesser/shared';
import type { TimeControl } from '../store/game';
import { useAuth } from '../store/auth';
import { useFriends } from '../store/friends';
import type { FeedEvent, IncomingChallenge, OutgoingChallenge } from '../lib/friendsApi';
import { saveSeat } from './friendClient';
import { neutralBtn, primaryBtn, TimeControlPicker } from './bits';

const POLL_MS = 8_000;

const inputCls =
  'w-full rounded-lg bg-panelmute px-2.5 py-1.5 text-sm text-ink placeholder-neutral-500 outline-none focus:ring-2 focus:ring-brand-500';
const labelCls = 'text-xs font-medium uppercase tracking-wide text-neutral-400';
const smallBtn = 'btn-press rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50';
const smallNeutral = `${smallBtn} bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-ink`;
const smallPrimary = `${smallBtn} bg-brand-600 text-white hover:bg-brand-700`;

function ago(t: TFunction, atMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - atMs) / 1000));
  if (s < 60) return t('time.justNow');
  if (s < 3600) return t('time.minutesAgo', { count: Math.floor(s / 60) });
  if (s < 86_400) return t('time.hoursAgo', { count: Math.floor(s / 3600) });
  return t('time.daysAgo', { count: Math.floor(s / 86_400) });
}

function tcLabel(t: TFunction, tc: FriendTimeControl | null): string {
  return tc?.label ?? t('timeControl.unlimitedShort');
}

/** The color YOU would play against a challenger who picked `their`. */
function yourColor(t: TFunction, their: FriendColor | 'random'): string {
  return their === 'white' ? t('colors.inlineBlack') : their === 'black' ? t('colors.inlineWhite') : t('colors.randomColors');
}

function feedLine(t: TFunction, e: FeedEvent): { icon: string; text: string } {
  switch (e.kind) {
    case 'rush':
      return { icon: '🏃', text: t('feed.rush', { value: e.value }) };
    case 'rating':
      return { icon: '📈', text: t(e.board === 'bots' ? 'feed.ratingBots' : 'feed.ratingPuzzle', { value: e.value }) };
    case 'achievement':
      return { icon: '🏅', text: t('feed.achievement', { name: (e.id ?? '').replace(/-/g, ' ') }) };
    case 'streak':
      return { icon: '🔥', text: t('feed.streak', { count: e.count }) };
  }
}

export function FriendsPanel({ active, onJoinGame }: { active: boolean; onJoinGame: (code: string, name: string) => void }) {
  const { t } = useTranslation('friends');
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username) ?? '';

  const data = useFriends((s) => s.data);
  const challengesIn = useFriends((s) => s.challengesIn);
  const challengesOut = useFriends((s) => s.challengesOut);
  const feed = useFriends((s) => s.feed);
  const loadError = useFriends((s) => s.error);

  // Add-friend form.
  const [addValue, setAddValue] = useState('');
  const [addNotice, setAddNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Challenge form (one friend at a time).
  const [challenging, setChallenging] = useState<string | null>(null);
  const [chTc, setChTc] = useState<TimeControl | null>(null);
  const [chColor, setChColor] = useState<FriendColor | 'random'>('random');
  const [chNotice, setChNotice] = useState<string | null>(null);

  // Two-step friend removal.
  const [removing, setRemoving] = useState<string | null>(null);

  // Load + poll while signed in and the Friends tab is visible.
  useEffect(() => {
    if (!token || !active) return;
    void useFriends.getState().refresh();
    const iv = window.setInterval(() => void useFriends.getState().refresh(), POLL_MS);
    return () => window.clearInterval(iv);
  }, [token, active]);

  // Sign-out wipes the cached (account-scoped) graph.
  useEffect(() => {
    if (!token) useFriends.getState().clear();
  }, [token]);

  // Challenger side of the hand-off: an outgoing challenge turned 'accepted'
  // carries the room code — join it (once) and drop the record.
  const joinedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!active) return;
    const c = challengesOut.find((x) => x.status === 'accepted' && x.roomCode && !joinedRef.current.has(x.id));
    if (!c) return;
    joinedRef.current.add(c.id);
    void useFriends.getState().cancelChallenge(c.id); // dismiss the record
    onJoinGame(c.roomCode!, username);
  }, [challengesOut, active, onJoinGame, username]);

  if (!token) {
    return (
      <section className="rounded-2xl bg-panel p-4 shadow-soft" data-testid="friends-signin-cta">
        <h3 className="font-semibold text-ink">{t('headers.friends')}</h3>
        <p className="mt-1 text-sm text-neutral-400">{t('signedOut.body')}</p>
      </section>
    );
  }

  const addFriend = async () => {
    if (addBusy) return;
    setAddBusy(true);
    setAddNotice(null);
    const res = await useFriends.getState().addFriend(addValue);
    setAddNotice(res);
    if (res.ok) setAddValue('');
    setAddBusy(false);
  };

  const copyCode = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is shown as text anyway */
    }
  };

  const sendChallenge = async (to: string) => {
    setChNotice(null);
    const tc: FriendTimeControl | null = chTc ? { initialMs: chTc.initialMs, incrementMs: chTc.incrementMs, label: chTc.label } : null;
    const err = await useFriends.getState().sendChallenge(to, tc, chColor);
    if (err) {
      setChNotice(err);
    } else {
      setChallenging(null);
    }
  };

  const acceptChallenge = async (c: IncomingChallenge) => {
    const seat = await useFriends.getState().respondChallenge(c.id, true);
    if (!seat) return; // error already surfaced via store state
    // Persist the seat like a WS-created one, then join the room normally.
    saveSeat({ code: seat.roomCode, token: seat.token, color: seat.color });
    onJoinGame(seat.roomCode, username);
  };

  const friends = data?.friends ?? [];
  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];
  const visibleOut = challengesOut.filter((c) => !(c.status === 'accepted' && joinedRef.current.has(c.id)));

  return (
    <section className="space-y-3" aria-label={t('panel.ariaLabel')}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* --- left: your people ------------------------------------------- */}
        <div className="space-y-3 rounded-2xl bg-panel p-4 shadow-soft" data-testid="card-friends">
          <div>
            <h3 className="font-semibold text-ink">{t('headers.friends')}</h3>
            <p className="text-xs text-neutral-400">{t('add.hint')}</p>
          </div>

          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addFriend();
            }}
          >
            <label className="flex-1 space-y-1">
              <span className={labelCls}>{t('add.label')}</span>
              <input
                className={inputCls}
                placeholder={t('add.placeholder')}
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                data-testid="add-friend-input"
              />
            </label>
            <button type="submit" className={`${primaryBtn} mt-5 shrink-0`} disabled={addBusy || !addValue.trim()} data-testid="add-friend-submit">
              {t('add.submit')}
            </button>
          </form>
          {addNotice && (
            <p role={addNotice.ok ? 'status' : 'alert'} className={`text-xs ${addNotice.ok ? 'text-emerald-400' : 'text-rose-400'}`} data-testid="add-friend-notice">
              {addNotice.message}
            </p>
          )}

          {data && (
            <p className="text-xs text-neutral-400">
              {t('code.yours')}{' '}
              <code className="rounded bg-panelmute px-1.5 py-0.5 font-mono text-neutral-300" data-testid="friend-code">
                {data.code}
              </code>{' '}
              <button className={`${smallNeutral} ml-1`} onClick={() => void copyCode()} aria-label={t('code.copyAria')}>
                {codeCopied ? t('code.copied') : t('code.copy')}
              </button>
            </p>
          )}

          {incoming.length > 0 && (
            <div data-testid="incoming-requests">
              <h4 className={labelCls}>{t('requests.incomingTitle')}</h4>
              <ul className="mt-1 space-y-1.5">
                {incoming.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                    <span className="font-semibold text-ink">{r.username}</span>
                    <span className="text-xs text-neutral-400">{ago(t, r.at)}</span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        className={smallPrimary}
                        onClick={() => void useFriends.getState().respondRequest(r.id, true)}
                        aria-label={t('requests.acceptAria', { name: r.username })}
                      >
                        {t('actions.accept')}
                      </button>
                      <button
                        className={smallNeutral}
                        onClick={() => void useFriends.getState().respondRequest(r.id, false)}
                        aria-label={t('requests.declineAria', { name: r.username })}
                      >
                        {t('actions.decline')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outgoing.length > 0 && (
            <div data-testid="outgoing-requests">
              <h4 className={labelCls}>{t('requests.outgoingTitle')}</h4>
              <ul className="mt-1 space-y-1.5">
                {outgoing.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
                    <span>{r.username}</span>
                    <span className="text-xs">{t('requests.waiting')}</span>
                    <button
                      className={`${smallNeutral} ml-auto`}
                      onClick={() => void useFriends.getState().cancelRequest(r.id)}
                      aria-label={t('requests.cancelAria', { name: r.username })}
                    >
                      {t('common:actions.cancel')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className={labelCls}>{t('list.title')} {friends.length > 0 && `(${friends.length})`}</h4>
            {friends.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-400" data-testid="friends-empty">
                {t('list.empty')}
              </p>
            ) : (
              <ul className="mt-1 space-y-1.5" data-testid="friends-list">
                {friends.map((f) => (
                  <li key={f.username} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-ink">{f.username}</span>
                      <span className="ml-auto flex gap-1.5">
                        <button
                          className={smallPrimary}
                          onClick={() => {
                            setChallenging((cur) => (cur === f.username ? null : f.username));
                            setChNotice(null);
                          }}
                          aria-expanded={challenging === f.username}
                          aria-label={t('challenge.buttonAria', { name: f.username })}
                          data-testid={`challenge-${f.username}`}
                        >
                          {t('challenge.button')}
                        </button>
                        {removing === f.username ? (
                          <>
                            <button
                              className={`${smallBtn} bg-rose-600 text-white hover:bg-rose-500`}
                              onClick={() => {
                                setRemoving(null);
                                void useFriends.getState().removeFriend(f.username);
                              }}
                              aria-label={t('remove.confirmAria', { name: f.username })}
                            >
                              {t('remove.confirm')}
                            </button>
                            <button className={smallNeutral} onClick={() => setRemoving(null)}>
                              {t('remove.keep')}
                            </button>
                          </>
                        ) : (
                          <button className={smallNeutral} onClick={() => setRemoving(f.username)} aria-label={t('remove.buttonAria', { name: f.username })}>
                            {t('remove.button')}
                          </button>
                        )}
                      </span>
                    </div>
                    {challenging === f.username && (
                      <div className="space-y-2 rounded-xl bg-panelmute/60 p-2.5" data-testid="challenge-form">
                        <div className="space-y-1">
                          <span className={labelCls}>{t('timeControl.label')}</span>
                          <TimeControlPicker value={chTc} onChange={setChTc} label={t('challenge.timeControlAria', { name: f.username })} />
                        </div>
                        <div className="space-y-1">
                          <span className={labelCls}>{t('challenge.youPlay')}</span>
                          <div className="flex gap-1 rounded-lg bg-panelmute p-1" role="group" aria-label={t('challenge.colorAria')}>
                            {(['white', 'random', 'black'] as const).map((c) => (
                              <button
                                key={c}
                                onClick={() => setChColor(c)}
                                aria-pressed={chColor === c}
                                data-testid={`challenge-color-${c}`}
                                className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold capitalize ${
                                  chColor === c ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
                                }`}
                              >
                                {c === 'random' ? t('colors.pickRandom') : c === 'white' ? t('colors.pickWhite') : t('colors.pickBlack')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className={primaryBtn} onClick={() => void sendChallenge(f.username)} data-testid="send-challenge">
                            {t('challenge.send')}
                          </button>
                          <button className={neutralBtn} onClick={() => setChallenging(null)}>
                            {t('common:actions.cancel')}
                          </button>
                        </div>
                        {chNotice && (
                          <p role="alert" className="text-xs text-rose-400">
                            {chNotice}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {loadError && (
            <p role="alert" className="text-xs text-rose-400">
              {loadError}
            </p>
          )}
        </div>

        {/* --- right: challenges + activity --------------------------------- */}
        <div className="space-y-3 rounded-2xl bg-panel p-4 shadow-soft" data-testid="card-challenges">
          <div>
            <h3 className="font-semibold text-ink">{t('headers.challenges')}</h3>
            <p className="text-xs text-neutral-400">{t('challenge.cardHint')}</p>
          </div>

          {challengesIn.length === 0 && visibleOut.length === 0 && (
            <p className="text-sm text-neutral-400" data-testid="challenges-empty">
              {t('challenge.empty')}
            </p>
          )}

          {challengesIn.length > 0 && (
            <ul className="space-y-2" data-testid="incoming-challenges">
              {challengesIn.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-panelmute/60 p-2.5 text-sm text-neutral-300">
                  <span>
                    <Trans
                      t={t}
                      i18nKey="challenge.incomingLine"
                      values={{ from: c.from, tc: tcLabel(t, c.timeControl), color: yourColor(t, c.color) }}
                      components={{ from: <span className="font-semibold text-ink" /> }}
                    />
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <button className={smallPrimary} onClick={() => void acceptChallenge(c)} aria-label={t('challenge.acceptAria', { name: c.from })} data-testid="accept-challenge">
                      {t('challenge.acceptPlay')}
                    </button>
                    <button
                      className={smallNeutral}
                      onClick={() => void useFriends.getState().respondChallenge(c.id, false)}
                      aria-label={t('challenge.declineAria', { name: c.from })}
                    >
                      {t('actions.decline')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {visibleOut.length > 0 && (
            <ul className="space-y-2" data-testid="outgoing-challenges">
              {visibleOut.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-panelmute/60 p-2.5 text-sm text-neutral-400">
                  <OutgoingChallengeLine c={c} />
                  <span className="ml-auto flex gap-1.5">
                    {c.status === 'accepted' && c.roomCode && (
                      <button
                        className={smallPrimary}
                        onClick={() => {
                          joinedRef.current.add(c.id);
                          void useFriends.getState().cancelChallenge(c.id);
                          onJoinGame(c.roomCode!, username);
                        }}
                        data-testid="join-accepted-challenge"
                      >
                        {t('challenge.join')}
                      </button>
                    )}
                    <button
                      className={smallNeutral}
                      onClick={() => void useFriends.getState().cancelChallenge(c.id)}
                      aria-label={
                        c.status === 'pending' ? t('challenge.cancelAria', { name: c.to }) : t('challenge.dismissAria', { name: c.to })
                      }
                    >
                      {c.status === 'pending' ? t('common:actions.cancel') : t('challenge.dismiss')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <h4 className={labelCls}>{t('feed.title')}</h4>
            {feed.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-400" data-testid="feed-empty">
                {t('feed.empty')}
              </p>
            ) : (
              <ul className="mt-1 space-y-1.5" data-testid="friend-feed">
                {feed.map((e, i) => {
                  const line = feedLine(t, e);
                  return (
                    <li key={`${e.username}-${e.kind}-${e.at}-${i}`} className="flex items-baseline gap-2 text-sm text-neutral-300">
                      <span aria-hidden="true">{line.icon}</span>
                      <span>
                        <span className="font-semibold text-ink">{e.username}</span> {line.text}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-neutral-400">{ago(t, e.at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-neutral-400">{t('feed.note')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function OutgoingChallengeLine({ c }: { c: OutgoingChallenge }) {
  const { t } = useTranslation('friends');
  const detail = t('challenge.outDetail', {
    tc: tcLabel(t, c.timeControl),
    color: c.color === 'random' ? t('colors.randomColors') : c.color === 'white' ? t('colors.whiteLower') : t('colors.blackLower'),
  });
  const text =
    c.status === 'pending'
      ? t('challenge.outPending', { name: c.to, detail })
      : c.status === 'accepted'
        ? t('challenge.outAccepted', { name: c.to })
        : c.status === 'declined'
          ? t('challenge.outDeclined', { name: c.to })
          : c.status === 'expired'
            ? t('challenge.outExpired', { name: c.to })
            : t('challenge.outCancelled', { name: c.to });
  return (
    <span data-testid={`challenge-status-${c.status}`}>
      {c.status === 'accepted' ? <span className="font-semibold text-emerald-400">{text}</span> : text}
    </span>
  );
}
