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

function ago(atMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - atMs) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function tcLabel(tc: FriendTimeControl | null): string {
  return tc?.label ?? 'unlimited';
}

/** The color YOU would play against a challenger who picked `their`. */
function yourColor(their: FriendColor | 'random'): string {
  return their === 'white' ? 'Black' : their === 'black' ? 'White' : 'random colors';
}

function feedLine(e: FeedEvent): { icon: string; text: string } {
  switch (e.kind) {
    case 'rush':
      return { icon: '🏃', text: `hit a Puzzle Rush best of ${e.value}` };
    case 'rating':
      return { icon: '📈', text: `${e.board === 'bots' ? 'bot-game' : 'puzzle'} rating is now ${e.value}` };
    case 'achievement':
      return { icon: '🏅', text: `unlocked “${(e.id ?? '').replace(/-/g, ' ')}”` };
    case 'streak':
      return { icon: '🔥', text: `is on a ${e.count}-day streak` };
  }
}

export function FriendsPanel({ active, onJoinGame }: { active: boolean; onJoinGame: (code: string, name: string) => void }) {
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
        <h3 className="font-semibold text-ink">👥 Friends</h3>
        <p className="mt-1 text-sm text-neutral-400">
          Sign in (top right) to add friends, challenge them to games, and see what they've been up to. Sharing is opt-in — only
          your display name is ever shown.
        </p>
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
    <section className="space-y-3" aria-label="Friends and challenges">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* --- left: your people ------------------------------------------- */}
        <div className="space-y-3 rounded-2xl bg-panel p-4 shadow-soft" data-testid="card-friends">
          <div>
            <h3 className="font-semibold text-ink">👥 Friends</h3>
            <p className="text-xs text-neutral-400">Add friends by username, or swap friend codes — no public profile needed.</p>
          </div>

          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addFriend();
            }}
          >
            <label className="flex-1 space-y-1">
              <span className={labelCls}>Username or friend code</span>
              <input
                className={inputCls}
                placeholder="e.g. magnus, or Q2ZKM7PW"
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                data-testid="add-friend-input"
              />
            </label>
            <button type="submit" className={`${primaryBtn} mt-5 shrink-0`} disabled={addBusy || !addValue.trim()} data-testid="add-friend-submit">
              Add friend
            </button>
          </form>
          {addNotice && (
            <p role={addNotice.ok ? 'status' : 'alert'} className={`text-xs ${addNotice.ok ? 'text-emerald-400' : 'text-rose-400'}`} data-testid="add-friend-notice">
              {addNotice.message}
            </p>
          )}

          {data && (
            <p className="text-xs text-neutral-400">
              Your friend code:{' '}
              <code className="rounded bg-panelmute px-1.5 py-0.5 font-mono text-neutral-300" data-testid="friend-code">
                {data.code}
              </code>{' '}
              <button className={`${smallNeutral} ml-1`} onClick={() => void copyCode()} aria-label="Copy your friend code">
                {codeCopied ? '✓ Copied' : 'Copy'}
              </button>
            </p>
          )}

          {incoming.length > 0 && (
            <div data-testid="incoming-requests">
              <h4 className={labelCls}>Friend requests</h4>
              <ul className="mt-1 space-y-1.5">
                {incoming.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                    <span className="font-semibold text-ink">{r.username}</span>
                    <span className="text-xs text-neutral-400">{ago(r.at)}</span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        className={smallPrimary}
                        onClick={() => void useFriends.getState().respondRequest(r.id, true)}
                        aria-label={`Accept friend request from ${r.username}`}
                      >
                        Accept
                      </button>
                      <button
                        className={smallNeutral}
                        onClick={() => void useFriends.getState().respondRequest(r.id, false)}
                        aria-label={`Decline friend request from ${r.username}`}
                      >
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outgoing.length > 0 && (
            <div data-testid="outgoing-requests">
              <h4 className={labelCls}>Sent requests</h4>
              <ul className="mt-1 space-y-1.5">
                {outgoing.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
                    <span>{r.username}</span>
                    <span className="text-xs">· waiting</span>
                    <button
                      className={`${smallNeutral} ml-auto`}
                      onClick={() => void useFriends.getState().cancelRequest(r.id)}
                      aria-label={`Cancel friend request to ${r.username}`}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className={labelCls}>Your friends {friends.length > 0 && `(${friends.length})`}</h4>
            {friends.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-400" data-testid="friends-empty">
                No friends yet — send a request above.
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
                          aria-label={`Challenge ${f.username} to a game`}
                          data-testid={`challenge-${f.username}`}
                        >
                          ⚔ Challenge
                        </button>
                        {removing === f.username ? (
                          <>
                            <button
                              className={`${smallBtn} bg-rose-600 text-white hover:bg-rose-500`}
                              onClick={() => {
                                setRemoving(null);
                                void useFriends.getState().removeFriend(f.username);
                              }}
                              aria-label={`Confirm removing ${f.username}`}
                            >
                              Confirm
                            </button>
                            <button className={smallNeutral} onClick={() => setRemoving(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button className={smallNeutral} onClick={() => setRemoving(f.username)} aria-label={`Remove ${f.username} from your friends`}>
                            Remove
                          </button>
                        )}
                      </span>
                    </div>
                    {challenging === f.username && (
                      <div className="space-y-2 rounded-xl bg-panelmute/60 p-2.5" data-testid="challenge-form">
                        <div className="space-y-1">
                          <span className={labelCls}>Time control</span>
                          <TimeControlPicker value={chTc} onChange={setChTc} label={`Time control for the challenge to ${f.username}`} />
                        </div>
                        <div className="space-y-1">
                          <span className={labelCls}>You play</span>
                          <div className="flex gap-1 rounded-lg bg-panelmute p-1" role="group" aria-label="Your color">
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
                                {c === 'random' ? '⚄ Random' : c === 'white' ? '□ White' : '■ Black'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className={primaryBtn} onClick={() => void sendChallenge(f.username)} data-testid="send-challenge">
                            Send challenge
                          </button>
                          <button className={neutralBtn} onClick={() => setChallenging(null)}>
                            Cancel
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
            <h3 className="font-semibold text-ink">⚔ Challenges</h3>
            <p className="text-xs text-neutral-400">Accepting a challenge starts a live, unrated friend game.</p>
          </div>

          {challengesIn.length === 0 && visibleOut.length === 0 && (
            <p className="text-sm text-neutral-400" data-testid="challenges-empty">
              No open challenges. Pick a friend and hit ⚔ Challenge.
            </p>
          )}

          {challengesIn.length > 0 && (
            <ul className="space-y-2" data-testid="incoming-challenges">
              {challengesIn.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-panelmute/60 p-2.5 text-sm text-neutral-300">
                  <span>
                    <span className="font-semibold text-ink">{c.from}</span> challenges you — {tcLabel(c.timeControl)}, you play{' '}
                    {yourColor(c.color)}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <button className={smallPrimary} onClick={() => void acceptChallenge(c)} aria-label={`Accept challenge from ${c.from}`} data-testid="accept-challenge">
                      Accept & play
                    </button>
                    <button
                      className={smallNeutral}
                      onClick={() => void useFriends.getState().respondChallenge(c.id, false)}
                      aria-label={`Decline challenge from ${c.from}`}
                    >
                      Decline
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
                        Join game
                      </button>
                    )}
                    <button
                      className={smallNeutral}
                      onClick={() => void useFriends.getState().cancelChallenge(c.id)}
                      aria-label={c.status === 'pending' ? `Cancel challenge to ${c.to}` : `Dismiss challenge to ${c.to}`}
                    >
                      {c.status === 'pending' ? 'Cancel' : 'Dismiss'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <h4 className={labelCls}>Friend activity</h4>
            {feed.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-400" data-testid="feed-empty">
                Nothing yet — activity your friends share (scores, streaks, badges) shows up here.
              </p>
            ) : (
              <ul className="mt-1 space-y-1.5" data-testid="friend-feed">
                {feed.map((e, i) => {
                  const line = feedLine(e);
                  return (
                    <li key={`${e.username}-${e.kind}-${e.at}-${i}`} className="flex items-baseline gap-2 text-sm text-neutral-300">
                      <span aria-hidden="true">{line.icon}</span>
                      <span>
                        <span className="font-semibold text-ink">{e.username}</span> {line.text}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-neutral-400">{ago(e.at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-neutral-500">Only what each friend chose to share (leaderboards / profile settings) appears here.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function OutgoingChallengeLine({ c }: { c: OutgoingChallenge }) {
  const detail = `${tcLabel(c.timeControl)}, you play ${c.color === 'random' ? 'random colors' : c.color}`;
  const text =
    c.status === 'pending'
      ? `waiting for ${c.to}… (${detail})`
      : c.status === 'accepted'
        ? `${c.to} accepted your challenge!`
        : c.status === 'declined'
          ? `${c.to} declined your challenge`
          : c.status === 'expired'
            ? `your challenge to ${c.to} expired`
            : `challenge to ${c.to} cancelled`;
  return (
    <span data-testid={`challenge-status-${c.status}`}>
      {c.status === 'accepted' ? <span className="font-semibold text-emerald-400">{text}</span> : text}
    </span>
  );
}
